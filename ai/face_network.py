"""Optional batch inference. The local gallery and matching stay on Türwache."""
import base64
import json
import math
import ipaddress
import socket
import ssl
import time
from http.client import HTTPConnection, HTTPSConnection, HTTPException
import urllib.parse
import urllib.request

import cv2 as cv

MODEL = "sface-v1"
ARC_MODEL = "arcface-w600k-r50-v1"
LIMIT = 64
ARC_BATCH = 8
VECTOR_LENGTH = {MODEL: 128, ARC_MODEL: 512}
LAN_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def is_lan(address):
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback or any(ip in network for network in LAN_NETWORKS)


def lan_request(url, body, headers, timeout):
    host = url.hostname
    secure = url.scheme == "https"
    port = url.port or (443 if secure else 80)
    deadline = time.monotonic() + timeout
    context = ssl.create_default_context() if secure else None
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for family, kind, protocol, _, address in addresses:
        allowed = is_lan(address[0]) if secure else ipaddress.ip_address(address[0]).is_loopback
        if not allowed or time.monotonic() >= deadline:
            continue
        connection = HTTPSConnection(host, port, timeout=timeout, context=context) if secure else HTTPConnection(host, port, timeout=timeout)
        try:
            with socket.socket(family, kind, protocol) as transport:
                transport.settimeout(max(.1, deadline - time.monotonic()))
                transport.connect(address)
                connection.sock = context.wrap_socket(transport, server_hostname=host) if secure else transport
                connection.request("POST", "/embed", body=body, headers=headers)
                response = connection.getresponse()
                if response.status != 200:
                    raise ValueError("Face worker returned an error")
                return response.read(1_000_001)
        except (OSError, HTTPException):
            continue
        finally:
            connection.close()
    raise ValueError("Face worker is not reachable at a private network address")


def remote_embeddings(crops, config, model=MODEL):
    size = VECTOR_LENGTH[model]
    if model == ARC_MODEL and len(crops) > ARC_BATCH:
        return [vector for start in range(0, len(crops), ARC_BATCH)
                for vector in remote_embeddings(crops[start:start + ARC_BATCH], config, model)]
    url = urllib.parse.urlsplit(config["url"])
    token = config["token"]
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
    body = json.dumps({"model": model, "images": images}, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    timeout = 12 if model == ARC_MODEL else 8
    if config.get("localOnly"):
        payload = lan_request(url, body, headers, timeout)
    else:
        request = urllib.request.Request(url.geturl().rstrip("/") + "/embed", data=body, headers=headers)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=timeout) as response:
            payload = response.read(1_000_001)
    if len(payload) > 1_000_000:
        raise ValueError("Face worker response too large")
    result = json.loads(payload)
    embeddings = result["embeddings"]
    if result.get("model") != model or not isinstance(embeddings, list) or len(embeddings) != len(crops):
        raise ValueError("Face worker returned the wrong model or number of results")
    for vector in embeddings:
        if not isinstance(vector, list) or len(vector) != size or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in vector):
            raise ValueError("Face worker embedding invalid")
        if not 0.9 <= math.sqrt(sum(x*x for x in vector)) <= 1.1:
            raise ValueError("Face worker embedding is not normalized")
    return embeddings
