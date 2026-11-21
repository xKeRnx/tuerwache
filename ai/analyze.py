"""YOLOX + YuNet + SFace inference with an optional private face worker.
YOLOX preprocessing/decoding follows OpenCV Zoo (Apache 2.0); see models/licenses.
Input JSON on stdin, one JSON result on stdout. Called in a bounded subprocess.
"""
import json
import sys
import time
import math
import os
import base64
from face_tracks import confirm_faces
from face_network import LIMIT, remote_embeddings
from pathlib import Path
import cv2 as cv
import numpy as np

cv.setNumThreads(2)
MODELS = Path(__file__).resolve().parent / "models"
_CACHE = {}
_LOADS = {}
MIN_FACE_PIXELS = 40


def resource(name):
    if name not in _CACHE:
        if name == "detector":
            _CACHE[name] = cv.FaceDetectorYN.create(str(MODELS / "yunet.onnx"), "", (320, 320), 0.85, 0.3, 1000)
        elif name == "recognizer":
            _CACHE[name] = cv.FaceRecognizerSF.create(str(MODELS / "sface.onnx"), "")
        elif name == "contrast":
            _CACHE[name] = cv.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
        else:
            _CACHE[name] = cv.dnn.readNet(str(MODELS / "yolox.onnx"))
        _LOADS[name] = _LOADS.get(name, 0) + 1
    return _CACHE[name]


def embedding(recognizer, crop):
    feature = recognizer.feature(crop).flatten()
    norm = float(np.linalg.norm(feature))
    if not np.isfinite(feature).all() or norm < 1e-8:
        raise ValueError("Gesichtsvorlage ungültig.")
    return (feature / norm).tolist()


def brighten_dark_crop(crop):
    light = cv.cvtColor(crop, cv.COLOR_BGR2YCrCb)
    luminance = light[:, :, 0]
    average = float(cv.mean(luminance)[0])
    if not 12 <= average < 90 or np.percentile(luminance, 90) >= 175:
        return crop
    gamma = max(0.58, math.log(105 / 255) / math.log(average / 255))
    curve = np.rint(255 * np.power(np.arange(256) / 255, gamma)).astype(np.uint8)
    light[:, :, 0] = cv.LUT(luminance, curve)
    return cv.cvtColor(light, cv.COLOR_YCrCb2BGR)


def face_boxes(image, detector, recover_dark=False):
    h, w = image.shape[:2]
    ratio = min(1.0, 960 / max(h, w))
    small = cv.resize(image, (max(1, round(w * ratio)), max(1, round(h * ratio))), interpolation=cv.INTER_AREA) if ratio < 1 else image
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, found = detector.detect(small)
    if recover_dark and found is None:
        lab = cv.cvtColor(small, cv.COLOR_BGR2LAB)
        luminance = lab[:, :, 0]
        if 12 <= cv.mean(luminance)[0] < 100 and cv.meanStdDev(luminance)[1][0, 0] >= 10:
            lab[:, :, 0] = resource("contrast").apply(luminance)
            _, found = detector.detect(cv.cvtColor(lab, cv.COLOR_LAB2BGR))
    result = []
    for box in ([] if found is None else found[:32]):
        if min(box[2:4]) < 24 or min(box[2:4]) / ratio < MIN_FACE_PIXELS:
            continue
        box[:14] /= ratio
        result.append(box)
    return result


def faces(image, detector, recognizer, defer=False, visitors=(), recover_dark=False):
    found = face_boxes(image, detector, recover_dark)
    if not found:
        height, width = image.shape[:2]
        # Recheck the upper part of a detected person at native scale.
        for visitor in sorted(visitors, key=lambda person: person["score"], reverse=True)[:2]:
            x, y, w, h = visitor["box"]
            left, top = max(0, x - w // 6), max(0, y - h // 8)
            right, bottom = min(width, x + w + w // 6), min(height, y + h * 3 // 5)
            if min(right - left, bottom - top) < MIN_FACE_PIXELS:
                continue
            for box in face_boxes(image[top:bottom, left:right], detector, recover_dark):
                box[[0, 4, 6, 8, 10, 12]] += left
                box[[1, 5, 7, 9, 11, 13]] += top
                found.append(box)
        if len(found) > 1:
            keep = cv.dnn.NMSBoxes([box[:4].tolist() for box in found], [float(box[-1]) for box in found], 0.0, 0.35)
            found = [found[int(index)] for index in keep]
    result = []
    for face in found:
        crop = recognizer.alignCrop(image, face)
        detail = float(cv.Laplacian(cv.cvtColor(crop, cv.COLOR_BGR2GRAY), cv.CV_32F).var())
        crop = brighten_dark_crop(crop)
        item = {"box": [round(float(v)) for v in face[:4]],
                "score": round(float(face[-1]), 4), "detail": round(detail, 2)}
        if defer:
            item["_crop"] = crop
        else:
            try:
                item["embedding"] = embedding(recognizer, crop)
            except ValueError:
                continue
        result.append(item)
    return result


def people(image, net):
    h, w = image.shape[:2]
    ratio = min(640 / h, 640 / w)
    padded = np.full((640, 640, 3), 114, np.float32)
    resized = cv.resize(cv.cvtColor(image, cv.COLOR_BGR2RGB), (int(w * ratio), int(h * ratio)))
    padded[:resized.shape[0], :resized.shape[1]] = resized
    net.setInput(np.transpose(padded, (2, 0, 1))[None])
    dets = net.forward()[0]
    grids, strides = [], []
    for stride in [8, 16, 32]:
        x, y = np.meshgrid(np.arange(640 // stride), np.arange(640 // stride))
        grid = np.stack((x, y), 2).reshape(-1, 2)
        grids.append(grid)
        strides.append(np.full((len(grid), 1), stride))
    stride_values = np.concatenate(strides)
    centers = (dets[:, :2] + np.concatenate(grids)) * stride_values
    sizes = np.exp(dets[:, 2:4]) * stride_values
    scores = dets[:, 4] * dets[:, 5]  # COCO class zero = person
    candidates = np.flatnonzero((scores >= 0.5) & (np.argmax(dets[:, 5:], axis=1) == 0))
    boxes = np.concatenate((centers - sizes / 2, sizes), axis=1)[candidates] / ratio
    confidence = scores[candidates]
    keep = cv.dnn.NMSBoxes(boxes.tolist(), confidence.tolist(), 0.5, 0.45)
    return [{"box": [round(float(v)) for v in boxes[int(i)]], "score": round(float(confidence[int(i)]), 4)} for i in keep]


def main(data):
    started = time.monotonic()
    if data["mode"] == "embed":
        images = data.get("images", [])
        if not isinstance(images, list) or not 1 <= len(images) <= LIMIT:
            raise ValueError("Ungültige Anzahl Gesichtsausschnitte.")
        recognizer = resource("recognizer")
        vectors = []
        for image in images:
            if not isinstance(image, str) or len(image) > 24000:
                raise ValueError("Gesichtsausschnitt ungültig.")
            encoded = base64.b64decode(image, validate=True)
            crop = cv.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv.IMREAD_COLOR)
            if crop is None or crop.shape != (112, 112, 3):
                raise ValueError("Gesichtsausschnitt muss 112 × 112 Pixel haben.")
            vectors.append(embedding(recognizer, crop))
        return {"embeddings": vectors}
    face_enabled = data.get("faceRecognition", True) or data["mode"] == "enroll"
    person_enabled = data.get("personDetection", True)
    detector = resource("detector") if face_enabled else None
    recognizer = resource("recognizer") if face_enabled else None
    if data["mode"] == "enroll":
        image = cv.imread(data["path"])
        if image is None:
            raise ValueError("Bild nicht lesbar.")
        found = faces(image, detector, recognizer, recover_dark=True)
        if len(found) != 1:
            raise ValueError("Ein Foto mit genau einem ausreichend großen, gut sichtbaren Gesicht verwenden.")
        return {"embedding": found[0]["embedding"], "score": found[0]["score"]}
    if not person_enabled and not face_enabled:
        raise ValueError("Keine KI-Funktion für diese Kamera aktiviert.")
    net = resource("people") if person_enabled else None
    capture = cv.VideoCapture(data["path"])
    frames = capture.get(cv.CAP_PROP_FRAME_COUNT)
    fps = capture.get(cv.CAP_PROP_FPS)
    if not math.isfinite(frames) or frames < 1:
        capture.release()
        raise ValueError("Keine Videobilder für die KI lesbar.")
    fps = fps if math.isfinite(fps) and fps > 0 else frames / 12
    duration = frames / fps
    count = min(60, int(frames), max(3, math.ceil(duration) + 1))
    indices = sorted(set(round(i * (int(frames) - 1) / max(1, count - 1)) for i in range(count)))
    samples = []
    network = face_enabled and data.get("faceEngine") == "network" and not data.get("privacyZones")
    backend = "local"

    def sample(frame_index, detect_people, nearby=(), recover_dark=False):
        capture.set(cv.CAP_PROP_POS_FRAMES, frame_index)
        ok, image = capture.read()
        if not ok:
            return
        visitors = people(image, net) if detect_people else []
        found = faces(image, detector, recognizer, defer=network, visitors=visitors or nearby, recover_dark=recover_dark) if face_enabled else []
        samples.append({"fraction": round(frame_index / frames, 6), "frameIndex": frame_index,
                        "seconds": round(frame_index / fps, 3), "people": visitors, "faces": found})

    try:
        for frame_index in indices:
            sample(frame_index, person_enabled, recover_dark=face_enabled and len(samples) < 12)
        if face_enabled:
            step = max(1, round(fps / 5))
            anchors = sorted((item for item in samples if item["faces"] or item["people"]),
                             key=lambda item: max(face["box"][2] * face["box"][3] for face in item["faces"]) if item["faces"] else 0,
                             reverse=True)
            # Reserve samples around visible faces or people, including late in the clip.
            existing = set(indices)
            candidates = {}
            for anchor in anchors[:3]:
                for offset in (-1, 1, -2, 2):
                    candidates.setdefault(anchor["frameIndex"] + offset * step, anchor["people"])
            for index in range(0, min(int(frames), int(3 * fps) + 1), step):
                candidates.setdefault(index, ())
            for anchor in anchors[3:]:
                for offset in (-1, 1):
                    candidates.setdefault(anchor["frameIndex"] + offset * step, anchor["people"])
            remaining = [(index, nearby) for index, nearby in candidates.items() if 0 <= index < int(frames) and index not in existing][:24]
            for frame_index, nearby in sorted(remaining):
                sample(frame_index, False, nearby, recover_dark=True)
    finally:
        capture.release()
    if not samples:
        raise ValueError("Keine Videobilder für die KI lesbar.")
    samples.sort(key=lambda item: item["frameIndex"])
    if network:
        found = [face for item in samples for face in item["faces"]]
        chosen = sorted(found, key=lambda face: face["detail"], reverse=True)[:LIMIT]
        if chosen:
            try:
                vectors = remote_embeddings([face["_crop"] for face in chosen])
                for face, vector in zip(chosen, vectors):
                    face["embedding"] = vector
                backend = "network"
            except (OSError, ValueError, KeyError, TypeError):
                backend = "local-fallback"
        for item in samples:
            valid = []
            for face in item["faces"]:
                crop = face.pop("_crop")
                try:
                    if "embedding" not in face:
                        face["embedding"] = embedding(recognizer, crop)
                except ValueError:
                    continue
                valid.append(face)
            item["faces"] = valid
    identities = confirm_faces(samples, data.get("known", []), data.get("threshold", 0.5))
    return {"identityVersion": 2, "galleryRevision": data.get("galleryRevision"), "confirmedIdentities": identities, "confirmationMinFrames": 3, "status": "ready", "engine": "OpenCV YOLOX + YuNet + SFace", "sampleCount": len(samples),
            "personDetectionEnabled": person_enabled, "faceRecognitionEnabled": face_enabled, "faceEngine": backend,
            "personDetected": any(s["people"] or s["faces"] for s in samples),
            "maxPeople": max(max(len(s["people"]), len(s["faces"])) for s in samples),
            "names": sorted(set(f["name"] for s in samples for f in s["faces"] if f["name"])),
            "unknownFace": any(f["identityStatus"] == "unknown" for s in samples for f in s["faces"]),
            "unconfirmedFace": any(f["identityStatus"] == "unconfirmed" for s in samples for f in s["faces"]),
            "faceVisible": any(s["faces"] for s in samples), "samples": samples,
            "elapsedMs": round((time.monotonic() - started) * 1000)}


def response(data):
    try:
        result = main(data)
        result["worker"] = {"pid": os.getpid(), "modelLoads": dict(_LOADS)}
        return result
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else "Lokale KI nicht verfügbar. Python/OpenCV und Modelle prüfen."
        return {"error": message}


if __name__ == "__main__":
    if "--worker" in sys.argv:
        print(json.dumps({"ready": True, "protocol": 1}), flush=True)
        while True:
            line = sys.stdin.buffer.readline(16_000_001)
            if not line:
                break
            if len(line) > 16_000_000:
                break
            try:
                request = json.loads(line)
                result = response(request["data"])
                print(json.dumps({"id": request["id"], "result": result}), flush=True)
                del request, result, line
            except (ValueError, KeyError, TypeError):
                break
    else:
        result = response(json.load(sys.stdin))
        print(json.dumps(result))
        sys.exit(1 if result.get("error") else 0)
