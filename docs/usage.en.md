# Cameras, AI and troubleshooting

## Recordings

Türwache and Ring accounts are separate. Configure monitoring, motion/doorbell recording, duration, cooldown, detection, description model and Discord per camera. Saving a model does not enable camera analysis by itself.

Test a manual recording on Overview. Clips contains saved video; Timeline combines events, recording state and descriptions. A motion alert does not necessarily mean video was saved.

## Missing clips or missing parts of a visit

New clips receive a full-video check for decoder errors and larger timestamp gaps before publication. Impaired recordings show a warning in the archive. Larger receive buffers, longer packet retransmission windows and conventional fast-start MP4 improve delivery/playback; they cannot recreate missing camera images or increase the camera's actual frame rate.

Recordings and web live view now copy the received H.264 video without local resizing or FPS filters. Live view shows measured dimensions and approximate frame rate. Ring may deliver different quality between sessions. Audio is still converted to AAC for compatibility. The former fixed 720-pixel/15-FPS live limit is removed. HLS buffering still adds latency compared with a direct WebRTC connection.

Displayed FPS is calculated from decoded frames in the first live segment. Nominal transport-header rates may differ and do not prove that the corresponding number of images arrived.

- Recording disabled or server offline at event time.
- Cooldown since the previous recording start not reached.
- Another recording running: only one is supported at a time.
- Late battery-camera wake-up, live setup failure or unavailable storage.
- The later part happened after clip end without another usable event.

Read event and analysis status. Adjust duration/cooldown per camera, considering battery use. Unrecorded past images cannot be recovered. Old silent clips cannot gain audio. New clips and live view use camera audio when Ring supplies it; check volume controls.

## Faces and VLM

OpenCV detects people/faces locally. Enrol up to twelve photos per person with different angles/lighting, exactly one clear face each, and consent. Add/remove templates or assign unknown suggestions under Faces.

If Türwache finds a face but rarely confirms the name, add a sharp reference from the same camera angle. Under **Assign unknown faces**, choose a clear crop and use the existing name. Then run AI analysis again for that clip. Türwache crops from the original resolution and adjusts brightness locally for dark crops. Better lighting and a brief front-facing view help with small or blurred faces.

Automatic names need consistent support across at least three distinct frames with a time span. Uncertain/conflicting matches remain unconfirmed. Similarity is not probability. A persistent Python worker caches models and processes jobs serially.

The VLM receives neither the local name list nor face vectors. Verified names are appended separately from local recognition; they do not prove a generated action. Descriptions can be wrong. Reference changes invalidate older automatic identity evidence, but cannot recall existing Discord messages.

## Model selection

Add/edit/check/remove models under AI providers. Local options include Ollama, LM Studio, llama.cpp, LocalAI and vLLM; cloud presets and OpenAI-compatible APIs are available. Models must support images.

Several models can be saved; each camera uses its selected description model without automatic cloud fallback. Local face recognition can run alongside it: one establishes identities, the other describes frames.

Cloud calls send sampled frames and location context. All cloud providers share a configurable UTC daily request limit, including failures. This is not a spending cap. Review provider pricing/data terms.

## Discord and storage

Configure your webhook and per-camera doorbell/clip/person/summary switches. Images require successful corresponding analysis. Attachment limits/webhook errors can prevent delivery. Old events are not resent automatically. Manual analysis does not trigger automatic notifications.

Store clips locally or in another writable directory, optionally with private R2/S3 copies. Cloud videos are not complete app backups. Enter keys only on your own server.

## Sites, users and push

Connect additional Ring accounts under **Ring accounts**. Each has its own credentials and MFA. Shared Ring devices appear once in Türwache. **Sites** lists camera status and the latest doorbell or motion event. Administrators can rename sites, create new ones and move cameras between them.

Under **Users**, open **Edit permissions** for a role or **Account & permissions** for a user. Choose which sites and cameras are in scope, then open **Permissions** next to a camera to set its individual actions. Clip actions require permission to view clips. User rules take precedence over role rules. Within the same level, a matching deny wins. Administrators have full access.

Push quiet hours can be set on the mobile page or in the native app. They apply to all devices for the user, with an optional doorbell exception.

Open **Privacy zones & AI** for a camera to draw masks. The masks apply to explicit clip exports, Discord media and frames for scene descriptions. Playback, encrypted backups and private R2/S3 copies retain the original. A private [face worker](raspberry-pi.en.md) can calculate face embeddings when the camera has no privacy zones.
