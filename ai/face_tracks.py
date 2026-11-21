"""Conservative, local identity confirmation. No model or network dependencies."""
import math
from collections import Counter

MIN_FRAMES = 3
MIN_SPAN = 0.4
MAX_GAP = 2.5


def cosine(a, b):
    if not a or len(a) != len(b):
        return -1
    norm = math.sqrt(sum(v * v for v in a) * sum(v * v for v in b))
    score = sum(x * y for x, y in zip(a, b)) / norm if norm else -1
    return score if math.isfinite(score) else -1


def match_identity(feature, known, threshold):
    scores = []
    for person in known:
        templates = person.get("templates") or [{"embedding": person.get("embedding", [])}]
        score = max((cosine(feature, template.get("embedding", [])) for template in templates), default=-1)
        scores.append((score, person))
    scores.sort(key=lambda item: item[0], reverse=True)
    best_score, person = scores[0] if scores else (0, None)
    margin = best_score - scores[1][0] if len(scores) > 1 else 1
    accepted = person and best_score >= threshold and margin >= 0.05
    return (person["id"] if accepted else None), best_score


def association(previous, current):
    a, b = previous["box"], current["box"]
    scale = max(1, (a[2] + a[3] + b[2] + b[3]) / 4)
    distance = math.hypot(a[0] + a[2] / 2 - b[0] - b[2] / 2, a[1] + a[3] / 2 - b[1] - b[3] / 2) / scale
    ratio = b[2] * b[3] / max(1, a[2] * a[3])
    similarity = cosine(previous["embedding"], current["embedding"])
    if similarity < 0.45 or distance > 2 or not 0.4 <= ratio <= 2.5:
        return None
    return similarity - 0.12 * distance


def confirm_faces(samples, known, threshold=0.5):
    tracks = []
    by_id = {person["id"]: person for person in known}
    for sample in samples:
        seconds = sample["seconds"]
        faces = sample["faces"]
        active = [track for track in tracks if 0 < seconds - track["lastSeconds"] <= MAX_GAP]
        pairs = []
        for index, face in enumerate(faces):
            face["_candidate"], face["similarity"] = match_identity(face["embedding"], known, threshold)
            for track in active:
                score = association(track["lastFace"], face)
                if score is not None:
                    pairs.append((score, index, track))
        assigned_faces, assigned_tracks = set(), set()
        matches = {}
        for score, index, track in sorted(pairs, key=lambda item: item[0], reverse=True):
            if index not in assigned_faces and track["id"] not in assigned_tracks:
                matches[index] = track
                assigned_faces.add(index)
                assigned_tracks.add(track["id"])
        for index, face in enumerate(faces):
            track = matches.get(index)
            if track is None:
                track = {"id": f"face-{len(tracks) + 1}", "observations": []}
                tracks.append(track)
            track["lastFace"], track["lastSeconds"] = face, seconds
            track["observations"].append((sample["frameIndex"], seconds, face))
            face["trackId"] = track["id"]

    confirmed = []
    for track in tracks:
        observations = track["observations"]
        votes = Counter(face["_candidate"] for _, _, face in observations if face["_candidate"])
        if not votes:
            continue
        person_id, count = votes.most_common(1)[0]
        supporting = [(frame, seconds, face) for frame, seconds, face in observations if face["_candidate"] == person_id]
        # Never let a single strong frame, duplicate frame or competing identity name a track.
        if len(votes) != 1 or len({frame for frame, _, _ in supporting}) < MIN_FRAMES or count / len(observations) < 0.75 or round(supporting[-1][1] - supporting[0][1], 3) < MIN_SPAN:
            continue
        confirmed.append({"personId": person_id, "name": by_id[person_id]["name"], "trackId": track["id"], "frames": count, "firstSeconds": supporting[0][1], "lastSeconds": supporting[-1][1], "minSimilarity": round(min(face["similarity"] for _, _, face in supporting), 4), "source": "local-multiframe"})

    # Two simultaneously visible faces must not independently claim the same identity.
    ambiguous = set()
    for first in confirmed:
        for second in confirmed:
            if first is not second and first["personId"] == second["personId"] and max(first["firstSeconds"], second["firstSeconds"]) <= min(first["lastSeconds"], second["lastSeconds"]):
                ambiguous.add(first["trackId"])
    confirmed = [item for item in confirmed if item["trackId"] not in ambiguous]
    confirmed_tracks = {item["trackId"]: item for item in confirmed}
    for sample in samples:
        for face in sample["faces"]:
            candidate = face.pop("_candidate")
            face.pop("embedding", None)
            identity = confirmed_tracks.get(face["trackId"])
            accepted = identity is not None and candidate == identity["personId"]
            face.update({"personId": identity["personId"] if accepted else None, "name": identity["name"] if accepted else None, "identityConfirmed": accepted, "identityStatus": "confirmed" if accepted else "unconfirmed" if candidate else "unknown", "similarity": round(face["similarity"], 4)})
    return confirmed
