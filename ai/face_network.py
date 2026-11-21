"""Optional batch inference. The local gallery and matching stay on Türwache."""
import base64
import json
import math
import os
import urllib.parse
import urllib.request

import cv2 as cv

MODEL = "sface-v1"
LIMIT = 64


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def remote_embeddings(crops):
    url = urllib.parse.urlsplit(os.environ.get("FACE_WORKER_URL", ""))
    token = os.environ.get("FACE_WORKER_TOKEN", "")
    loopback = url.hostname in ("localhost", "127.0.0.1", "::1")
    if not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Face worker URL invalid")
    if url.scheme != "https" and not (url.scheme == "http" and loopback):
        raise ValueError("Face worker requires HTTPS")
    if len(token) < 32 or len(token) > 256 or any(character.isspace() for character in token):
        raise ValueError("Face worker token invalid")
    images = []
    for crop in crops:
        ok, encoded = cv.imencode(".jpg", crop, [cv.IMWRITE_JPEG_QUALITY, 95])
        if not ok:
            raise ValueError("Face crop encoding failed")
        images.append(base64.b64encode(encoded).decode("ascii"))
    body = json.dumps({"model": MODEL, "images": images}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url.geturl().rstrip("/") + "/embed", data=body,
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=8) as response:
        result = json.loads(response.read(1_000_001))
    embeddings = result["embeddings"]
    if result.get("model") != MODEL or len(embeddings) != len(crops):
        raise ValueError("Face worker returned the wrong model or number of results")
    for vector in embeddings:
        if not isinstance(vector, list) or len(vector) != 128 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in vector):
            raise ValueError("Face worker embedding invalid")
        if not 0.9 <= math.sqrt(sum(x*x for x in vector)) <= 1.1:
            raise ValueError("Face worker embedding is not normalized")
    return embeddings
