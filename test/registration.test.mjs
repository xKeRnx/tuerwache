import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventRegistration, detectionInfo } from '../src/event-registration.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const wrapped = value => Buffer.from(JSON.stringify({ pnc: { fcm: { token: value } } })).toString('base64');

test('Späte Push-Registrierung erneuert Ereignisabos und stoppt beim Abmelden', async () => {
  let calls = 0;
  const reports = [];
  const camera = { subscribeToMotionEvents: async () => { calls++; }, subscribeToDingEvents: async () => { calls++; } };
  const registration = createEventRegistration(count => reports.push(count), 10);
  registration.tokenChanged(wrapped('test-token-a'));
  registration.discovered([camera]);
  await wait(40);
  assert.equal(calls, 2);
  assert.deepEqual(reports, [0]);
  registration.tokenChanged(wrapped('test-token-a'));
  await wait(30);
  assert.equal(calls, 2);
  registration.tokenChanged(wrapped('test-token-b'));
  await wait(40);
  assert.equal(calls, 4);
  registration.tokenChanged(wrapped('test-token-c'));
  registration.close();
  await wait(30);
  assert.equal(calls, 4);
});

test('Ein fehlerhaftes Ereignisabo verhindert die übrigen nicht', async () => {
  let successful = 0;
  const reports = [];
  const registration = createEventRegistration(count => reports.push(count), 5);
  registration.discovered([
    { subscribeToMotionEvents() { throw new Error('private-error'); }, subscribeToDingEvents: async () => { successful++; } },
    { subscribeToMotionEvents: async () => { successful++; }, subscribeToDingEvents: async () => { successful++; } },
  ]);
  await wait(30);
  registration.close();
  assert.equal(successful, 3);
  assert.deepEqual(reports, [1]);
});

test('Messwerte unterscheiden Ring-Erkennung von Empfang und verwerfen unplausible Zeiten', () => {
  const receivedAt = Date.parse('2026-11-16T22:00:03Z');
  const notification = { data: { event: { ding: { id: 'test-event', subtype: 'motion', created_at: '2026-11-16T22:00:00Z' } } }, password: 'must-not-leak' };
  const result = detectionInfo(notification, receivedAt);
  assert.equal(result.pushDelayMs, 3000);
  assert.equal(result.ringLabel, 'motion');
  assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  assert.equal(detectionInfo({ analytics: { triggered_at: receivedAt / 1000 - 2 } }, receivedAt).pushDelayMs, 2000);
  assert.equal(detectionInfo({ analytics: { triggered_at: receivedAt + 5000 } }, receivedAt).pushDelayMs, undefined);
  assert.equal(detectionInfo({}, receivedAt).pushDelayMs, undefined);
});
