// Ring can finish registering its push credentials after cameras are discovered.
// Reapply the idempotent event subscriptions after discovery and credential changes.
export function createEventRegistration(onResult, delayMs = 5000) {
  let cameras = [], timer, stopped = false, previousPushToken;
  function schedule() {
    clearTimeout(timer);
    if (stopped || !cameras.length) return;
    timer = setTimeout(async () => {
      const calls = cameras.flatMap(camera => [
        () => camera.subscribeToMotionEvents(),
        () => camera.subscribeToDingEvents(),
      ]);
      const outcomes = await Promise.allSettled(calls.map(call => Promise.resolve().then(call)));
      if (!stopped) onResult(outcomes.filter(result => result.status === 'rejected').length);
    }, delayMs);
  }
  return {
    tokenChanged(token) {
      try {
        const current = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))?.pnc?.fcm?.token;
        if (typeof current === 'string' && current && current !== previousPushToken) {
          previousPushToken = current;
          schedule();
        }
      } catch { /* Opaque tokens are valid; discovery still schedules registration. */ }
    },
    discovered(targets) { cameras = targets; schedule(); },
    close() { stopped = true; clearTimeout(timer); cameras = []; previousPushToken = undefined; },
  };
}

export function detectionInfo(notification, receivedAtMs = Date.now()) {
  const ding = notification?.data?.event?.ding;
  let timestamp = typeof ding?.created_at === 'string' ? Date.parse(ding.created_at) : NaN;
  if (!Number.isFinite(timestamp) && typeof notification?.analytics?.triggered_at === 'number') {
    timestamp = notification.analytics.triggered_at;
    if (timestamp < 100000000000) timestamp *= 1000;
  }
  const validTime = Number.isFinite(timestamp) && timestamp <= receivedAtMs && receivedAtMs - timestamp < 86400000;
  return {
    receivedAtMs,
    ...(typeof ding?.id === 'string' && ding.id.length <= 128 ? { eventId: ding.id } : {}),
    ...(typeof ding?.subtype === 'string' && ding.subtype.length <= 64 ? { ringLabel: ding.subtype } : {}),
    ...(validTime ? { ringDetectedAt: new Date(timestamp).toISOString(), pushDelayMs: receivedAtMs - timestamp } : {}),
  };
}
