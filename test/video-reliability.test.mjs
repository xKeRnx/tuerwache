import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-for-homebridge';
import {RtpHeader,RtpPacket} from 'werift';
import {VideoPacketBuffer,VideoTransport,videoInputOptions,configureVideoRecovery} from '../src/video-transport.mjs';
import {H264Recovery} from '../src/h264-recovery.mjs';
import {inspectVideoQuality,finalizeVideo,smoothVideoStart} from '../src/video-quality.mjs';
import {createStoryboard} from '../src/media.mjs';
import {summaryPositions} from '../src/scene-sampling.mjs';
import {validateSceneDescription} from '../src/scene-description.mjs';
import {cleanTestDirectory} from './helpers.mjs';
const run=promisify(execFile);

test('RTP transport handles sequence wrap/reordering and bounds discontinuity state',()=>{
  const stats=new VideoTransport();const packet=sequence=>({header:{sequenceNumber:sequence}});
  for(const sequence of [65534,0,1])stats.observe(packet(sequence));assert.equal(stats.state().missingPackets,1);
  stats.observe(packet(65535));assert.equal(stats.state().missingPackets,0);assert.equal(stats.state().reorderedPackets,1);
  stats.observe(packet(4));assert.equal(stats.state().missingPackets,2);stats.observe({});assert.equal(stats.state().packets,5);
  stats.observe(packet(9000));assert.equal(stats.state().discontinuities,1);assert.equal(stats.state().missingPackets,2);
  assert.ok(videoInputOptions().includes('-buffer_size'));assert.ok(!videoInputOptions().includes('-use_wallclock_as_timestamps'));
  const video={kind:'video',nack:{retryCount:10}},audio={kind:'audio',nack:{retryCount:10}};
  assert.equal(configureVideoRecovery({connection:{pc:{pc:{getReceivers:()=>[video,audio]}}}}).configuredReceivers,1);
  assert.equal(video.nack.retryCount,300);assert.equal(audio.nack.retryCount,10);assert.equal(configureVideoRecovery({}).configuredReceivers,0);
});

test('Late Ring retransmission still repairs the frame within the recording buffer', () => {
  let time = 0;
  const output = [];
  const buffer = new VideoPacketBuffer(packet => output.push(packet.header.sequenceNumber), () => assert.fail('premature gap'), { clock: () => time });
  const push = sequenceNumber => buffer.push({ header: { sequenceNumber } });
  try {
    push(10); push(12);
    time = 950; push(13); push(11);
    assert.deepEqual(output, [10, 11, 12, 13]);
    assert.equal(buffer.metrics.skippedSequenceGaps, 0);
  } finally { buffer.close(); }
});

test('Video waits for retransmitted fragments before forwarding later packets', () => {
  const output = [];
  let gaps = 0;
  const buffer = new VideoPacketBuffer(packet => output.push(packet), () => gaps++);
  try {
    const packets = [65534, 65535, 0, 1].map(sequenceNumber => ({header: {sequenceNumber, timestamp: 9000}}));
    for (const index of [0, 2, 3, 2]) buffer.push(packets[index]);
    assert.deepEqual(output, [packets[0]]);
    buffer.push(packets[1]);
    buffer.push(packets[1]);
    assert.deepEqual(output, packets);
    assert.equal(gaps, 0);
  } finally { buffer.close(); }
});

test('Video skips a gap after its deadline, even when no more packets arrive', async () => {
  const output = [];
  let signalGap;
  const gap = new Promise(resolve => { signalGap = resolve; });
  const buffer = new VideoPacketBuffer(packet => output.push(packet.header.sequenceNumber), signalGap, {waitMs: 15});
  const push = sequenceNumber => buffer.push({header: {sequenceNumber}});
  try {
    push(31); push(33); push(34);
    await gap;
    push(32); push(35);
    assert.deepEqual(output, [31, 33, 34, 35]);
  } finally { buffer.close(); }
});

test('A burst and a large sequence jump cannot grow the reorder queue without bound', () => {
  const output = [];
  let gaps = 0;
  const buffer = new VideoPacketBuffer(packet => output.push(packet.header.sequenceNumber), () => gaps++, {maxPackets: 3});
  const push = sequenceNumber => buffer.push({header: {sequenceNumber}});
  try {
    for (const number of [1, 3, 4, 5, 7, 5000, 5001]) push(number);
    assert.deepEqual(output, [1, 3, 4, 5, 5000, 5001]);
    assert.equal(gaps, 2);
  } finally { buffer.close(); }
});

test('H.264 loss keeps incomplete pictures out of FFmpeg and resumes at a complete IDR', async () => {
  const emitted = [];
  let requested = 0, notifyGap;
  const lost = new Promise(resolve => { notifyGap = resolve; });
  const pictures = new H264Recovery(packet => emitted.push(packet), () => requested++);
  const ordered = new VideoPacketBuffer(packet => pictures.push(packet), () => { pictures.gap(); notifyGap(); }, {waitMs: 15});
  const packet = (sequenceNumber, timestamp, marker, bytes) =>
    new RtpPacket(new RtpHeader({sequenceNumber,timestamp,marker}), Buffer.from(bytes));
  const send = (...args) => ordered.push(packet(...args));
  try {
    send(65533, 100, false, [0x7c, 0x85, 1]);
    send(65535, 100, true, [0x7c, 0x45, 3]);
    send(65534, 100, false, [0x7c, 0x05, 2]);
    assert.equal(emitted.length, 3);
    assert.equal(requested, 0);

    send(0, 200, false, [0x7c, 0x81, 1]);
    send(2, 200, true, [0x7c, 0x41, 3]);
    send(3, 300, true, [0x61, 13]);
    await lost;
    assert.equal(emitted.length, 3);
    assert.ok(requested >= 1);

    const next = packet(4, 400, true, [0x78, 0, 2, 0x67, 9, 0, 2, 0x65, 10]);
    ordered.push(next);
    send(5, 500, true, [0x61, 14]);
    assert.deepEqual(emitted.map(({header}) => [header.sequenceNumber,header.timestamp]),
      [[65533,100],[65534,100],[65535,100],[0,400],[1,500]]);
    assert.equal(next.header.sequenceNumber, 4);
    assert.equal(emitted[3].payload, next.payload);
  } finally { ordered.close(); }
});

test('Final MP4 retains audio/video and fast-start indexing; whole-video check detects later gaps',async t=>{
  const root=await mkdtemp(join(tmpdir(),'tuerwache-video-health-'));t.after(()=>cleanTestDirectory(root));
  const input=join(root,'input.mp4'),final=join(root,'final.mp4'),gap=join(root,'gap.mp4');
  await run(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=160x120:r=20','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.5','-c:v','libx264','-c:a','aac','-movflags','+frag_keyframe+empty_moov',input],{windowsHide:true});
  await finalizeVideo(input,final);const bytes=await readFile(final);assert.ok(bytes.indexOf(Buffer.from('moov'))<bytes.indexOf(Buffer.from('mdat')));
  const good=await inspectVideoQuality(final);assert.equal(good.impaired,false);assert.equal(good.decodedFrames,30);assert.equal(good.decodeErrors,0);
  await run(ffmpeg,['-v','error','-i',final,'-map','0:a:0','-f','null','-'],{windowsHide:true});
  const partial=join(root,'partial.mp4'),recovered=join(root,'recovered.mp4');
  const fragmented=await readFile(input),media=fragmented.lastIndexOf('mdat');
  assert.ok(media>4);
  const middle=media+4+Math.floor((fragmented.readUInt32BE(media-4)-8)/2);
  await writeFile(partial,fragmented.subarray(0,middle));
  await finalizeVideo(partial,recovered);
  const repaired=await inspectVideoQuality(recovered);
  assert.equal(repaired.impaired,false);
  assert.ok(repaired.decodedFrames<good.decodedFrames);
  await run(ffmpeg,['-v','error','-i',final,'-vf','select=not(between(t\\,0.5\\,1.1))','-an','-fps_mode','vfr','-c:v','libx264',gap],{windowsHide:true});
  const broken=await inspectVideoQuality(gap);assert.equal(broken.impaired,true);assert.ok(broken.maxGapSeconds>.5);assert.ok(broken.decodedFrames<good.decodedFrames);
  assert.ok(Math.abs(broken.maxGapAtSeconds - .45) < .11);
});

test('A compressed startup is repaired without changing coded video or audio packets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'tuerwache-video-timing-'));t.after(()=>cleanTestDirectory(root));
  const input=join(root,'normal.mp4'), fast=join(root,'fast.mp4'), repaired=join(root,'repaired.mp4');
  await run(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=160x120:r=25','-f','lavfi','-i','sine=frequency=440',
    '-t','12','-c:v','libx264','-bf','0','-c:a','aac',input],{windowsHide:true});
  assert.equal((await inspectVideoQuality(input)).startupTiming,undefined);
  await finalizeVideo(input,fast,ffmpeg,['-bsf:v',"setts=ts='TS-.016/TB*min(25,max(N-18,0))'"]);
  const original=await inspectVideoQuality(fast);
  assert.ok(original.startupTiming.offset>.38);
  const correction=await smoothVideoStart(fast,repaired,original);
  assert.equal(correction.decodedFrames,original.decodedFrames);
  assert.equal(correction.startupRetimedMs,400);
  const hash=async file=>(await run(ffmpeg,['-v','error','-i',file,'-map','0','-c','copy','-f','streamhash','-'],{windowsHide:true})).stdout;
  assert.equal(await hash(repaired),await hash(fast));
});

test('Summary prefers repeated direction changes supported by one continuous person track',()=>{
  const observations=[[545,143,274],[584,88,188],[588,59,148],[586,102,207],[518,383,356],[526,134,305],[572,79,197]];
  const entry={video:{width:1080,height:1080},ai:{status:'ready',samples:observations.map(([y,w,h],seconds)=>({seconds,people:[{box:[650,y,w,h]}]}))}};
  const original='Eine Person in einer hellen Jacke bewegt sich auf einer Treppe.';
  assert.match(validateSceneDescription(original,entry).text,/kommt kurz zurück und geht dann wieder weg/);
  entry.ai.samples[3].people.push({box:[300,500,120,300]});
  assert.equal(validateSceneDescription(original,entry).text,original);
});

test('Six storyboard panels retain chronological colour order and keep early visitor activity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'tuerwache-storyboard-'));t.after(()=>cleanTestDirectory(root));
  const colors=['red','lime','blue','yellow','cyan','magenta'],frames=[];
  for(const color of colors){const {stdout}=await run(ffmpeg,['-v','error','-f','lavfi','-i',`color=${color}:s=160x160`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:1024*1024});frames.push({bytes:stdout});}
  const sheet=await createStoryboard(frames),file=join(root,'sheet.jpg');await writeFile(file,sheet);
  const {stdout:rgb}=await run(ffmpeg,['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:4*1024*1024});
  assert.equal(rgb.length,1152*768*3);
  const expected=[[1,0,0],[0,1,0],[0,0,1],[1,1,0],[0,1,1],[1,0,1]];
  for(let panel=0;panel<6;panel++){const offset=((Math.floor(panel/3)*384+192)*1152+(panel%3)*384+192)*3;for(let channel=0;channel<3;channel++)assert.equal(rgb[offset+channel]>150,Boolean(expected[panel][channel]));}
  const entry={video:{durationSeconds:30},ai:{status:'ready',samples:Array.from({length:12},(_,index)=>({seconds:index,frameIndex:index*17,people:[{}],faces:[]}))}};
  const positions=summaryPositions(entry,6);assert.equal(positions.length,6);assert.ok(positions.filter(value=>value>0&&value<12).length>=3);assert.ok(positions.at(-1)>29);
  assert.ok(positions.filter(value=>value>=25).length===2);
  assert.equal(validateSceneDescription('In der dritten Szene fährt ein Auto zum Haus.',entry).fallback,true);
  assert.equal(validateSceneDescription('Ein Auto fährt zum Haus.',entry).fallback,true);
  assert.equal(validateSceneDescription('Eine Person geht die Treppe hinauf.',entry).fallback,false);
  const framing=validateSceneDescription('In der unteren Reihe des Zeitrasters ist eine Person zu sehen, die sich auf einer Treppe bewegt.',entry);
  assert.equal(framing.fallback,false);assert.equal(framing.cleanedFraming,true);assert.equal(framing.text,'Eine Person ist zu sehen, die sich auf einer Treppe bewegt.');
  const guess=validateSceneDescription('Eine Person bewegt sich auf einer Treppe. Die Person scheint zum Parkplatz zu gehen.',entry);
  assert.equal(guess.text,'Eine Person bewegt sich auf einer Treppe.');assert.equal(guess.removedSpeculation,true);
  assert.equal(validateSceneDescription('Eine Person könnte die Treppe hinuntergehen.',entry).fallback,true);
});
