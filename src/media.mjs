import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-for-homebridge';
import { privacyFilters } from './privacy-zones.mjs';

export function createStoryboard(frames,binary=ffmpegPath){
  if(!Array.isArray(frames)||frames.length<1||frames.length>6||frames.some(frame=>!Buffer.isBuffer(frame.bytes)||frame.bytes.length>2*1024*1024))return Promise.reject(Error('KI-Bildfolge ungültig.'));
  return new Promise((resolve,reject)=>{
    const rows=Math.ceil(frames.length/3);
    const child=spawn(binary,['-nostdin','-v','error','-f','image2pipe','-vcodec','mjpeg','-i','pipe:0','-vf',`scale=384:384:force_original_aspect_ratio=decrease,pad=384:384:(ow-iw)/2:(oh-ih)/2:color=black,tile=3x${rows}`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let size=0;const chunks=[];
    const timer=setTimeout(()=>{child.kill();reject(Error('KI-Bildraster konnte nicht rechtzeitig erzeugt werden.'));},15000);
    child.stdin.on('error',()=>{});child.stdin.end(Buffer.concat(frames.map(frame=>frame.bytes)));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)child.kill();else chunks.push(chunk);});
    child.once('error',()=>{clearTimeout(timer);reject(Error('KI-Bildraster konnte nicht erstellt werden.'));});
    child.once('close',code=>{clearTimeout(timer);const bytes=Buffer.concat(chunks);if(code!==0||size>2*1024*1024||bytes[0]!==255||bytes[1]!==216)reject(Error('KI-Bildraster ist nicht lesbar.'));else resolve(bytes);});
  });
}

export function extractJpeg(file, { frameIndex, atSeconds = 0, maxWidth = 1280, crop, privacyZones } = {}, binary = ffmpegPath) {
  return new Promise((resolve, reject) => {
    const exact = Number.isSafeInteger(frameIndex) && frameIndex >= 0 && frameIndex <= 1_000_000;
    const selection = exact ? `select=eq(n\\,${frameIndex}),` : '';
    const width = Number.isSafeInteger(maxWidth) && maxWidth >= 160 && maxWidth <= 1280 ? maxWidth : 1280;
    if(crop&&(!Array.isArray(crop)||crop.length!==4||crop.some(value=>!Number.isSafeInteger(value)||value<0||value>16384)||crop[2]<32||crop[3]<32)){reject(new Error('Ungültiger Gesichtsausschnitt.'));return;}
    const cropping=crop?`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},`:'';
    const masks = privacyFilters(privacyZones).map(filter => `${filter},`).join('');
    const args = ['-nostdin', '-loglevel', 'error', ...(!exact ? ['-ss', String(Math.max(0, Math.min(Number(atSeconds) || 0, 60)))] : []), '-i', file, '-an', '-vf', `${selection}${masks}${cropping}scale=w='min(${width},iw)':h=-2`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'];
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let size = 0; const chunks = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('Vorschaubild konnte nicht rechtzeitig erzeugt werden.')); }, 15_000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
    child.once('error', () => { clearTimeout(timer); reject(new Error('FFmpeg für das Vorschaubild nicht verfügbar.')); });
    child.once('close', code => {
      clearTimeout(timer); const bytes = Buffer.concat(chunks);
      if (code !== 0 || size > 2 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) { reject(new Error('Kein lesbares Vorschaubild im Clip.')); return; }
      resolve(bytes);
    });
  });
}

// Decode a real frame. An existing file or an MP4 header alone is not success.
export function verifyVideo(file, binary = ffmpegPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-nostdin', '-hide_banner', '-i', file, '-map', '0:v:0', '-an', '-frames:v', '1', '-progress', 'pipe:1', '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let progress = '', metadata = '';
    child.stdout.on('data', chunk => { progress = (progress + chunk.toString()).slice(-8192); });
    child.stderr.on('data', chunk => { metadata = (metadata + chunk.toString()).slice(-16384); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Video-Prüfung hat zu lange gedauert.')); }, 10000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('FFmpeg konnte nicht gestartet werden.')); });
    child.once('close', code => {
      clearTimeout(timer);
      const frameCounts = [...progress.matchAll(/^frame=(\d+)/gm)].map(match => Number(match[1]));
      if (code !== 0 || !frameCounts.some(count => count > 0)) { reject(new Error('Die Aufnahme enthält kein lesbares Videobild.')); return; }
      const duration = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(metadata);
      const stream = /Video:\s*([^,\s]+)[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(metadata);
      const fps = /Video:[^\r\n]*?\b([\d.]+) fps\b/.exec(metadata);
      resolve({
        decoded: true, hasAudio: /Audio:/.test(metadata),
        ...(/Audio:\s*([^,\s]+)/.test(metadata) ? { audioCodec: /Audio:\s*([^,\s]+)/.exec(metadata)[1] } : {}),
        ...(duration ? { durationSeconds: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) } : {}),
        ...(stream ? { codec: stream[1], width: Number(stream[2]), height: Number(stream[3]) } : {}),
        ...(fps && Number(fps[1]) > 0 ? { framesPerSecond: Number(fps[1]) } : {}),
      });
    });
  });
}
