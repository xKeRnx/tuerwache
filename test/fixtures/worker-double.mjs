import { createInterface } from 'node:readline';
process.stdout.write(JSON.stringify({ ready: true, protocol: 1 }) + '\n');
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const { id, data } = JSON.parse(line);
  if (data.mode === 'crash') process.exit(1);
  if (data.mode === 'hang') return;
  if (data.mode === 'malformed') { process.stdout.write('not json\n'); return; }
  if (data.mode === 'oversized') { process.stdout.write('x'.repeat(1_100_000)); return; }
  const result = data.mode === 'error' ? { error: 'Ein Foto mit genau einem ausreichend großen, gut sichtbaren Gesicht verwenden.' } : { status: 'ready', value: data.value, worker: { pid: process.pid, modelLoads: { detector: 1 } } };
  process.stdout.write(JSON.stringify({ id, result }) + '\n');
});
