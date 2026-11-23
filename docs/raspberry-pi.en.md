# Raspberry Pi

Server and FFmpeg startup, face enrollment, and recognition with a test face were verified under Linux/ARM64 emulation. Testing with Ring cameras and measuring camera capacity, AI latency, and temperature still require physical Pi hardware.

A possible starting point is Pi 5 with 8 GB RAM, 64-bit OS, active cooling and SSD. This is an estimate, not a measured minimum. [Official Pi 5 specifications](https://www.raspberrypi.com/products/raspberry-pi-5/) confirm the 64-bit platform.

## Suggested split

- Pi: events, short clips, website and notifications.
- OpenCV person/face recognition: test one camera first; monitor latency, temperature and queue growth.
- VLM descriptions: preferably another private-network computer with Ollama/LM Studio/llama.cpp, or an explicitly selected cloud provider.

A large VLM on the Pi is optional. Continuous battery-camera recording is not supported. In **Operations**, the limit for simultaneous camera streams is configurable from 1 to 8, with a default of 4. Start with one stream on the Pi and measure performance before raising the limit.

## Installation and acceptance

Follow [Linux setup](linux.en.md). For this target, `uname -m` should report aarch64. A 32-bit OS is unsupported. FFmpeg and pinned Python binary wheels must be available; stop and investigate otherwise.

Test one camera, separate motion and doorbell events, audio playback, and restart recovery before enabling local AI. Use an encrypted backup to migrate from Windows. The [restore process](operations.en.md) rewrites absolute clip paths for the new data directory.

## Private face worker

If Türwache and the worker run on the same device, select the built-in worker under **AI providers → Face worker** and download ArcFace from the panel. See the [built-in worker guide](windows.en.md) for the settings.

Install Türwache and its OpenCV models on the worker computer. Configure a random `FACE_WORKER_TOKEN` and set `FACE_WORKER_HOST`, `FACE_WORKER_PORT`, `FACE_WORKER_CERT` and `FACE_WORKER_KEY` on that computer. Run `node --env-file=.env scripts/start-face-worker.mjs`. On the Pi, open **AI providers → Face worker**, enter the worker URL and the same token, check the connection, then enable it and save. The connection check uses a synthetic test image. Use `http://127.0.0.1:3211` for a worker on the same Pi. For a worker on another device, the Pi must trust its HTTPS certificate. Choose the network engine for each camera under **Sites → Privacy zones & AI**.

### Optional ArcFace on the worker

1. On the more powerful worker, set `FACE_WORKER_ARCFACE_MODEL` to the verified `w600k_r50.onnx` model from [InsightFace buffalo_l](https://github.com/deepinsight/insightface/releases/tag/model-zoo) and restart the worker. Türwache does not distribute the weights. InsightFace publishes these weights for non-commercial research under its [model terms](https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md).
2. On the Pi, turn on **Enable ArcFace for cameras** under **AI providers → Face worker**, check the connection and save. Enrol at least one reference photo per known person under **Faces**. Selecting the exact same file again adds ArcFace to its existing template.
3. Select **ArcFace on the local network** for the camera under **Sites → Privacy zones & AI → Face engine**. The Pi records the clips, detects faces and matches identities. The worker receives aligned face crops and returns ArcFace embeddings.

ArcFace uses its own similarity threshold of 0.30 and the multi-frame confirmation rule. Türwache uses local SFace when ArcFace templates are missing, the worker is unavailable or privacy zones are active. See **Face recognition in this clip** for details.

Only aligned face crops go to the worker. The gallery, names and matching stay on Türwache. A worker failure or configured privacy zones trigger local processing. Loopback HTTP is available for local testing.

## ONVIF and RTSP

- Use 64-bit Raspberry Pi OS and Node.js 24. On Linux, the Docker deployment uses host networking for ONVIF discovery. A manually entered RTSP address works without multicast.
- Choose H.264 in your camera settings with a keyframe interval around two seconds. Türwache then copies the video without another encode. Enable H.265 conversion and software motion detection per camera when needed and check CPU usage.
- Store the rolling buffer and clips on an SSD. Under **Operations**, set the network stream limit. [Network camera setup](network-cameras.en.md)
