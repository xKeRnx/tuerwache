# Türwache documentation

Türwache is a private server for Ring and network cameras. Its web interface brings together clips, a timeline, local AI and notifications. Choose German or English in the header.

## Start here

- [Install on Windows](windows.en.md)
- [Install on Linux and servers](linux.en.md)
- [Raspberry Pi suitability](raspberry-pi.en.md)
- [Using cameras, AI and troubleshooting](usage.en.md)
- [Connect network cameras using ONVIF and RTSP](network-cameras.en.md)
- [Security, backups and upgrades](operations.en.md)
- [Mobile apps and architecture](architecture.en.md)
- [Local operation and help](saas.en.md)
- [GitHub, licensing and business model](github.en.md)

## Development status

Windows and the owner's Ring Battery Doorbell Pro have been tested with real camera data. Live view and new recordings include audio when supplied by the camera. This private test worked without a Ring subscription or, according to the owner, a trial. This does not guarantee support for every Ring device or continued API availability.

A Ring account, internet connection and Ring cloud remain necessary. This project does not replace camera firmware or cloud connection setup. Battery cameras need to wake up, so the beginning of an event can be missed. Multiple cameras can record concurrently; live view and recording share one connection per camera.

The Linux x86_64 container was tested, including HTTP service, model downloads and the persistent Python worker. Physical Raspberry Pi hardware, systemd service operation and iOS installation have not been tested. AI can misdescribe events and miss people. Neither perfect security nor perfect recognition is promised.
