// Keep the camera's RTP clock. Buffer local UDP bursts/reordering instead of
// generating video timestamps from the Node event loop's arrival times.
export function videoInputOptions() {
  return ['-thread_queue_size','1024','-buffer_size','4194304','-reorder_queue_size','1024','-max_delay','1000000'];
}

export function configureVideoRecovery(session){
  // ring-client-api 14 / werift exposes the RTCRtpReceiver here. Its default
  // NACK retry budget expires after roughly 55 ms (5 ms interval, 10 retries),
  // often before a Ring cloud retransmission can return. Keep this adapter
  // optional so sessions/versions without that API continue normally.
  const receivers=session.connection?.pc?.pc?.getReceivers?.()||[];
  let configured=0;
  for(const receiver of receivers)if(receiver.kind==='video'&&typeof receiver.nack?.retryCount==='number'){
    receiver.nack.retryCount=Math.max(receiver.nack.retryCount,VIDEO_NACK_RETRIES);configured++;
  }
  return {configuredReceivers:configured,retryBudget:configured?VIDEO_NACK_RETRIES:null};
}

const sequenceDistance = (sequence, reference) => ((sequence - (reference & 65535) + 32768) & 65535) - 32768;
// Match the retry window to the packet buffer so the receiver can use late replies.
export const VIDEO_REORDER_WAIT_MS = 1500;
const VIDEO_NACK_RETRIES = 300;

// Keep Ring's original RTP timestamps and wait for retransmissions before FFmpeg
// sees a gap. FFmpeg cannot repair a fragmented H.264 frame after consuming it.
export class VideoPacketBuffer {
  constructor(emit, onGap, { waitMs = VIDEO_REORDER_WAIT_MS, maxPackets = 2048, clock = () => performance.now() } = {}) {
    this.emit = emit;
    this.onGap = onGap;
    this.waitMs = waitMs;
    this.maxPackets = maxPackets;
    this.clock = clock;
    this.pending = new Map();
    this.next = null;
    this.timer = null;
    this.metrics = { skippedSequenceGaps: 0, bufferLimitHits: 0, latePackets: 0 };
  }

  push(packet) {
    const sequence = packet.header.sequenceNumber;
    this.next ??= sequence;
    const distance = sequenceDistance(sequence, this.next);
    if (distance < 0) { this.metrics.latePackets++; return; }
    const index = this.next + distance;
    if (distance > 2048) {
      this.pending.clear();
      this.next = index;
      this.metrics.skippedSequenceGaps++;
      this.onGap();
    }
    if (this.pending.has(index)) return;
    this.pending.set(index, { packet, receivedAt: this.clock() });
    this.drain();
  }

  drain() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    while (this.pending.size) {
      const ready = this.pending.get(this.next);
      if (ready) {
        this.pending.delete(this.next++);
        this.emit(ready.packet);
        continue;
      }
      const remaining = this.waitMs - (this.clock() - this.pending.values().next().value.receivedAt);
      if (remaining > 0 && this.pending.size < this.maxPackets) {
        this.timer = setTimeout(() => this.drain(), Math.ceil(remaining));
        return;
      }
      this.metrics.skippedSequenceGaps++;
      if (remaining > 0) this.metrics.bufferLimitHits++;
      this.next = Math.min(...this.pending.keys());
      this.onGap();
    }
  }

  close() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}

export class VideoTransport {
  constructor(){this.packets=0;this.highest=null;this.missing=new Set();this.permanentMissing=0;this.reordered=0;this.discontinuities=0;}
  observe(packet){
    const sequence=packet?.header?.sequenceNumber;
    if(!Number.isInteger(sequence)||sequence<0||sequence>65535)return;
    this.packets++;
    if(this.highest===null){this.highest=sequence;return;}
    const delta=sequenceDistance(sequence,this.highest);
    const extended=this.highest+delta;
    if(delta>0){
      if(delta>2048){this.discontinuities++;this.permanentMissing+=this.missing.size;this.missing.clear();}
      else for(let value=this.highest+1;value<extended;value++)this.missing.add(value);
      this.highest=extended;
      for(const value of this.missing)if(value<extended-4096){this.permanentMissing++;this.missing.delete(value);}
    }else if(this.missing.delete(extended))this.reordered++;
  }
  state(){return {packets:this.packets,missingPackets:this.permanentMissing+this.missing.size,reorderedPackets:this.reordered,discontinuities:this.discontinuities};}
}
