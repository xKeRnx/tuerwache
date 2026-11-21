// Keep start/end context and prefer actual person detections without forwarding identities.
export function summaryPositions(entry, maxFrames = 6) {
  const limit = maxFrames === 3 ? 3 : 6;
  const duration = Math.min(60, Math.max(0.2, Number(entry.video?.durationSeconds) || 1));
  // Ring MP4 duration/fps may include a trailing gap. Prefer a frame actually decoded by AI.
  const decodedEnd = (entry.ai?.samples || []).filter(sample => sample.fraction >= 0.95 && Number.isSafeInteger(sample.frameIndex)).at(-1);
  const end = decodedEnd ? sampleSeconds(entry,decodedEnd) : Math.max(0,duration-Math.min(0.25,duration/4));
  const selected = [0, end];
  const add = value => {
    const seconds = Math.max(0, Math.min(duration - 0.001, value));
    if (Number.isFinite(seconds) && selected.every(other => Math.abs(other - seconds) > 0.04) && selected.length < limit) selected.push(seconds);
  };
  const visitors = (entry.ai?.samples || []).filter(sample => sample.people?.length || sample.faces?.length);
  for (const sample of [visitors[0], visitors.at(-1)]) if (sample) add(sampleSeconds(entry,sample));
  const afterVisit = visitors.length ? end-sampleSeconds(entry,visitors.at(-1)) : 0;
  // Leave room for a second late image when most of the clip follows the visit.
  if (limit===6 && afterVisit>8) add(end-Math.min(3,afterVisit/3));
  // Preserve the visit itself between the first/last detection, rather than
  // spending the remaining slots on an empty background after the visitor left.
  if(limit===6&&visitors.length>2)for(const fraction of [.25,.5,.75])add(sampleSeconds(entry,visitors[Math.round((visitors.length-1)*fraction)]));
  for (const fraction of limit===3?[0.5,0.25,0.75]:[0.2, 0.4, 0.6, 0.8, 0.1, 0.3, 0.7, 0.9]) add(end * fraction);
  return selected.sort((a, b) => a - b);
}

function sampleSeconds(entry,sample){return Number.isFinite(sample.seconds)?sample.seconds:(Number(entry.video?.durationSeconds)||1)*sample.fraction;}
export function summaryFrameIndex(entry,seconds){
  const sample=(entry.ai?.samples||[]).find(sample=>Number.isSafeInteger(sample.frameIndex)&&sample.frameIndex>=0&&Math.abs(sampleSeconds(entry,sample)-seconds)<0.001);
  return sample?.frameIndex;
}
