import sys
from pathlib import Path
from copy import deepcopy
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ai"))
from face_tracks import confirm_faces

A = {"id": "a", "name": "Joscha", "templates": [{"embedding": [1, 0]}]}
B = {"id": "b", "name": "Anna", "templates": [{"embedding": [0.8, 0.6]}]}

def sample(index, feature=(1, 0), second=None, extra=False):
    faces = [{"box": [100 + index * 3, 100, 100, 100], "embedding": list(feature), "score": 0.99}]
    if extra:
        faces.append({"box": [500, 100, 100, 100], "embedding": list(feature), "score": 0.99})
    return {"frameIndex": index, "seconds": index * 0.5 if second is None else second, "faces": faces}

def check():
    frames = [sample(i) for i in range(4)]
    identities = confirm_faces(frames, [A, B])
    assert identities[0]["name"] == "Joscha" and identities[0]["frames"] == 4
    assert all(face["identityConfirmed"] and "embedding" not in face for frame in frames for face in frame["faces"])
    assert not confirm_faces([sample(0)], [A])
    assert not confirm_faces([sample(0), sample(0), sample(0)], [A])
    assert not confirm_faces([sample(i, second=i * 0.1) for i in range(3)], [A])
    assert not confirm_faces([sample(i, second=i * 3) for i in range(3)], [A])
    assert not confirm_faces([sample(0), sample(1, (0.8, 0.6)), sample(2)], [A, B])
    assert not confirm_faces([sample(i, extra=True) for i in range(3)], [A])
    near = {"id": "near", "name": "Andere Person", "embedding": [0.999, 0.001]}
    assert not confirm_faces([sample(i) for i in range(3)], [A, near])
    multi = deepcopy(A); multi["templates"].append({"embedding": [0, 1]})
    assert confirm_faces([sample(i, (0, 1)) for i in range(3)], [multi])[0]["personId"] == "a"
    assert not confirm_faces([sample(i, (0, 1)) for i in range(3)], [A])
    print("Track confirmation: positive, single-frame, duplicate-frame, short-span, gap, contradiction, simultaneous duplicate, ambiguity and multi-template cases passed.")

if __name__ == "__main__":
    check()
