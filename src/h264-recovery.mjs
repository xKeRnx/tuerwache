// Ring negotiates H.264 in non-interleaved mode (single NAL, STAP-A, FU-A).
// Keep each timestamp together so a broken reference picture never reaches FFmpeg.
export class H264Recovery {
  constructor(emit, requestKeyFrame) {
    this.emit = emit;
    this.requestKeyFrame = requestKeyFrame;
    this.frame = null;
    this.waitingForIdr = false;
    this.discardTimestamp = null;
    this.nextSequence = null;
    this.discardedPictures = 0;
  }

  gap() {
    if (this.frame?.vcl) this.discardedPictures++;
    this.discardTimestamp = this.frame?.timestamp ?? this.discardTimestamp;
    this.frame = null;
    this.waitingForIdr = true;
    this.requestKeyFrame();
  }

  push(packet) {
    const {header, payload} = packet;
    const timestamp = header.timestamp;
    if (timestamp === this.discardTimestamp) return;
    this.discardTimestamp = null;
    if (this.frame && this.frame.timestamp !== timestamp) this.finish();
    const frame = this.frame ??= {timestamp, packets: [], fragment: 0, vcl: false, idr: false};
    if (frame.packets.length >= 2048 || !this.accept(frame, payload)) {
      this.gap();
      return;
    }
    frame.packets.push(packet);
    if (header.marker) this.finish();
  }

  accept(frame, payload) {
    if (!payload?.length || payload[0] & 0x80) return false;
    const type = payload[0] & 31;
    const nal = type => {
      if (type >= 1 && type <= 5) frame.vcl = true;
      if (type === 5) frame.idr = true;
      return type > 0 && type < 24;
    };
    if (type === 28) {
      if (payload.length < 2) return false;
      const fragmentType = payload[1] & 31;
      const start = Boolean(payload[1] & 0x80), end = Boolean(payload[1] & 0x40);
      if (start) {
        if (end || frame.fragment || !nal(fragmentType)) return false;
        frame.fragment = fragmentType;
      } else if (!frame.fragment || frame.fragment !== fragmentType) return false;
      if (end) frame.fragment = 0;
      return true;
    }
    if (frame.fragment) return false;
    if (type !== 24) return nal(type);
    for (let at = 1; at < payload.length;) {
      if (at + 2 >= payload.length) return false;
      const size = (payload[at] << 8) | payload[at+1];
      at += 2;
      if (!size || at + size > payload.length || !nal(payload[at] & 31)) return false;
      at += size;
    }
    return payload.length > 1;
  }

  finish() {
    const frame = this.frame;
    if (frame.fragment) {
      this.gap();
      return;
    }
    this.frame = null;
    if (this.waitingForIdr && frame.vcl && !frame.idr) {
      this.discardedPictures++;
      this.requestKeyFrame();
      return;
    }
    if (frame.idr) this.waitingForIdr = false;
    for (const packet of frame.packets) {
      // Only the local FFmpeg leg gets consecutive sequence numbers. Ring's
      // clock, packet contents and feedback retain the original sequence.
      const local = packet.clone();
      this.nextSequence ??= packet.header.sequenceNumber;
      local.header.sequenceNumber = this.nextSequence;
      this.nextSequence = (this.nextSequence + 1) & 65535;
      this.emit(local, frame.vcl);
    }
  }
}
