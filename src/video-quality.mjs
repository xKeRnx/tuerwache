import {spawn} from 'node:child_process';
import ffmpeg from 'ffmpeg-for-homebridge';

function startupTiming(times, gaps) {
  const start = times[0];
  const reference = gaps.filter((gap, index) => times[index] - start >= 2.5 && times[index] - start < 7).sort((a,b) => a-b);
  const step = reference[Math.floor(reference.length / 2)];
  if (reference.length < 30 || !(step >= .02 && step <= .085) ||
      reference.filter(gap => Math.abs(gap - step) <= step * .08).length < reference.length * .85) return null;

  const short = gaps.flatMap((gap, index) => times[index] - start < 2.5 && gap < step * .8 ? [index] : []);
  if (short.length < 5) return null;
  const lastFrame = short.at(-1) + 1;
  const boundary = times[lastFrame] - start;
  const offset = lastFrame * step - boundary;
  if (offset < .14 || offset > .8 || gaps.slice(0, lastFrame).some(gap => gap <= 0 || gap > step * 2.5)) return null;
  // Rejoin the original clock gradually so the clip end and audio clock stay put.
  const transition = Math.min(10, times.at(-1) - times[lastFrame] - .05);
  if (transition < Math.max(4, offset * 16)) return null;
  return { step, lastFrame, boundary, offset, transition };
}

export function inspectVideoQuality(file,binary=ffmpeg,{timeoutMs=45000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,['-nostdin','-hide_banner','-i',file,'-map','0:v:0','-an','-vf','showinfo','-fps_mode','passthrough','-f','null','-'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let log='';let overflow=false;
    child.stderr.on('data',chunk=>{if(log.length<4*1024*1024)log+=chunk.toString();else overflow=true;});
    const timer=setTimeout(()=>{child.kill();reject(Error('Vollständige Video-Prüfung hat zu lange gedauert.'));},Math.max(500,Math.min(45000,Number(timeoutMs)||45000)));
    child.once('error',()=>{clearTimeout(timer);reject(Error('Video-Prüfung konnte nicht gestartet werden.'));});
    child.once('close',code=>{
      clearTimeout(timer);
      const frames=[...log.matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([\d.e+-]+)[^\r\n]*\btype:([A-Z?])/g)];
      const times=frames.map(match=>Number(match[1]));
      if(code!==0||!times.length||overflow){reject(Error('Video nicht vollständig prüfbar.'));return;}
      const gaps=times.slice(1).map((value,index)=>value-times[index]);
      const largest = gaps.reduce((current, gap, index) => gap > current.seconds ? { seconds: gap, index } : current,
        { seconds: 0, index: 0 });
      const decodeErrors=(log.match(/error while decoding|concealing \d+.*? errors|Invalid NAL|corrupt decoded frame/gi)||[]).length;
      const impaired=decodeErrors>0||gaps.some(gap=>gap>.5||gap<=0);
      const timing=!impaired && frames.every(match=>['I','P'].includes(match[2])) ? startupTiming(times,gaps) : null;
      resolve({checked:true,decodedFrames:times.length,decodeErrors,nonMonotonicFrames:gaps.filter(gap=>gap<=0).length,longGaps:gaps.filter(gap=>gap>.25).length,maxGapSeconds:Math.round(largest.seconds*1000)/1000,averageFps:Math.round((times.length-1)/Math.max(.001,times.at(-1)-times[0])*100)/100,impaired,
        ...(largest.seconds > .25 ? { maxGapAtSeconds: Math.round((times[largest.index] - times[0]) * 1000) / 1000 } : {}),
        ...(timing?{startupTiming:timing}:{})});
    });
  });
}

export async function smoothVideoStart(source, target, quality, binary = ffmpeg) {
  const timing = quality.startupTiming;
  if (!timing) return null;
  const {step, lastFrame, boundary, offset, transition} = timing;
  // Only the video packet timestamps change. The coded pictures and audio are copied.
  const expression = `if(lte(N,${lastFrame}),STARTPTS+N*${step}/TB,TS+${offset}/TB*max(0,1-((TS-STARTPTS)*TB-${boundary})/${transition}))`;
  await finalizeVideo(source, target, binary, ['-bsf:v', `setts=ts='${expression}'`]);
  const checked = await inspectVideoQuality(target, binary);
  if (checked.impaired || checked.startupTiming || checked.decodedFrames !== quality.decodedFrames ||
      Math.abs(checked.averageFps - quality.averageFps) > .1) throw Error('Korrektur des Videoanfangs konnte nicht verifiziert werden.');
  return {...checked, startupRetimedMs: Math.round(offset * 1000)};
}

export function finalizeVideo(source,target,binary=ffmpeg,videoOptions=[]){
  return new Promise((resolve,reject)=>{
    // An interrupted FFmpeg writer can leave the final MP4 packet truncated.
    const child=spawn(binary,['-nostdin','-v','error','-fflags','+discardcorrupt','-i',source,'-map','0:v:0','-map','0:a:0?','-c','copy',...videoOptions,'-movflags','+faststart','-f','mp4','-y',target],{windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill();reject(Error('Video-Abschluss hat zu lange gedauert.'));},20000);
    child.once('error',()=>{clearTimeout(timer);reject(Error('Video-Abschluss konnte nicht gestartet werden.'));});
    child.once('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('Video-Abschluss fehlgeschlagen.'));});
  });
}
