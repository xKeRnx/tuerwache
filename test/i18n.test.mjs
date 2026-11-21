import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

test('DE/EN-Auswahl berücksichtigt gespeicherte Sprache, dynamische Rückmeldungen und unveränderte Namen/URLs', () => {
  for (const saved of ['de', 'en', 'invalid']) {
    const context = createContext({ window: {}, localStorage: { getItem: () => saved } });
    runInContext(readFileSync('public/translations.js', 'utf8'), context); runInContext(readFileSync('public/i18n.js', 'utf8'), context);
    const i18n = context.window.tuerwacheI18n; assert.equal(i18n.language, saved === 'en' ? 'en' : 'de');
    assert.equal(i18n.translate('Kamera-Profil speichern', 'en'), 'Save camera profile');
    assert.equal(i18n.translate('✓ Gespeichert um 12:34:56', 'en'), '✓ Saved at 12:34:56');
    assert.equal(i18n.translate('KI-Anbieter für Joschas Haustür', 'en'), 'AI provider for Joschas Haustür');
    assert.equal(i18n.translate('Zugeordnet: Joscha, Anna', 'en'), 'Assigned: Joscha, Anna');
    assert.equal(i18n.translate('Serveradresse für dein Handy: https://my.example.com', 'en'), 'Server address for your phone: https://my.example.com');
    assert.equal(i18n.translate('17.11.2026, 11:44:12', 'en'), '17/11/2026, 11:44:12');
    assert.equal(i18n.translate('BENUTZER', 'en'), 'USERS');
    assert.equal(i18n.translate('3 von 20 Cloud-Anfragen heute (UTC).', 'en'), '3 of 20 cloud requests today (UTC).');
    assert.equal(i18n.translate('Kamera-Profil speichern', 'de'), 'Kamera-Profil speichern');
    assert.equal(i18n.translate('Unknown user supplied text', 'en'), 'Unknown user supplied text');
  }
});
