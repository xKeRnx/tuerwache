// Identity evidence stays on the server. No names or biometric templates enter VLM prompts.
export function confirmedSummaryIdentities(entry, ai, profile) {
  const result = entry.ai;
  if (!profile.faceRecognition || result?.status !== 'ready' || result.identityVersion !== 2 || result.galleryRevision !== ai.galleryRevision()) return [];
  const identities = new Map();
  for (const candidate of result.confirmedIdentities || []) {
    const person = ai.people.find(person => person.id === candidate.personId);
    if (!person || candidate.source !== 'local-multiframe' || candidate.frames < 3) continue;
    const support = (result.samples || []).filter(sample => Number.isSafeInteger(sample.frameIndex) && Number.isFinite(sample.seconds) && sample.faces?.some(face => face.identityConfirmed === true && face.personId === person.id && face.trackId === candidate.trackId));
    if (new Set(support.map(sample => sample.frameIndex)).size < 3 || Math.round((Math.max(...support.map(sample => sample.seconds)) - Math.min(...support.map(sample => sample.seconds))) * 1000) < 400) continue;
    const existing = identities.get(person.id);
    identities.set(person.id, { personId: person.id, name: person.name, frames: Math.max(existing?.frames || 0, support.length), source: 'local-multiframe' });
  }
  return [...identities.values()];
}

export function anonymousSceneText(text, people) {
  for (const { name } of people) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?:['’]?s)?(?![\\p{L}\\p{N}_])`, 'iu').test(text)) throw new Error('KI-Beschreibung enthielt eine Namensvermutung und wurde verworfen. Bitte erneut beschreiben lassen.');
  }
  return text;
}

export function appendConfirmedNames(sceneText, identities) {
  return identities.length ? `${sceneText}\nLokale Gesichtserkennung (mehrere Bilder): ${identities.map(person => person.name).join(', ')}.` : sceneText;
}
