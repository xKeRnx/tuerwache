import { setTimeout as delay } from 'node:timers/promises';

export const DISCORD_FILE_LIMIT = 8 * 1024 * 1024;

export function normalizeWebhook(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Gültige Discord-Webhook-URL eingeben.'); }
  if (url.protocol !== 'https:' || !['discord.com', 'canary.discord.com', 'ptb.discord.com', 'discordapp.com'].includes(url.hostname) || url.port || url.username || url.password || url.hash || !/^\/api\/(?:v10\/)?webhooks\/\d{17,22}\/[A-Za-z0-9_-]{30,200}$/.test(url.pathname)) throw new Error('Nur offizielle Discord-Webhook-URLs werden unterstützt.');
  const thread = url.searchParams.get('thread_id');
  if ([...url.searchParams.keys()].some(key => !['thread_id', 'wait'].includes(key)) || (thread && !/^\d{17,22}$/.test(thread))) throw new Error('Discord-Webhook-Parameter ungültig.');
  const normalized = new URL(`https://discord.com${url.pathname.replace('/api/v10/', '/api/')}`);
  if (thread) normalized.searchParams.set('thread_id', thread);
  return normalized.href;
}

export class DiscordClient {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; this.blocked = new Map(); }
  async send(webhookUrl, content, file) {
    const endpoint = new URL(normalizeWebhook(webhookUrl)); endpoint.searchParams.set('wait', 'true');
    const payload = { username: 'Türwache', content: content.slice(0, 1900), allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } };
    let attached = Boolean(file), note;
    if (file?.bytes.length > DISCORD_FILE_LIMIT) { attached = false; note = 'Anhang über dem Türwache-Limit von 8 MiB; nur Text gesendet.'; payload.content += '\nDer Anhang ist zu groß; der Clip bleibt lokal gespeichert.'; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = (this.blocked.get(endpoint.href) || 0) - Date.now();
      if (remaining > 30_000) throw new Error('Discord begrenzt Anfragen. Bitte später erneut versuchen.');
      if (remaining > 0) await delay(remaining);
      let body, headers;
      if (attached) {
        const form = new FormData();
        const data = { ...payload, attachments: [{ id: 0, filename: file.name }] };
        if (file.type === 'image/jpeg') data.embeds = [{ image: { url: `attachment://${file.name}` } }];
        form.set('payload_json', JSON.stringify(data));
        form.set('files[0]', new Blob([file.bytes], { type: file.type }), file.name); body = form;
      } else { headers = { 'Content-Type': 'application/json' }; body = JSON.stringify(payload); }
      let response;
      try { response = await this.fetch(endpoint.href, { method: 'POST', redirect: 'error', headers, body, signal: AbortSignal.timeout(15_000) }); }
      catch { throw new Error('Discord nicht erreichbar oder Zeitüberschreitung. Zustellung unklar; erneutes Senden kann eine doppelte Nachricht erzeugen.'); }
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        const seconds = Number(data.retry_after ?? response.headers.get('retry-after'));
        const ms = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 86400_000) : 30_000;
        this.blocked.set(endpoint.href, Date.now() + ms);
        if (attempt < 2 && ms <= 30_000) continue;
        throw new Error('Discord begrenzt Anfragen. Bitte später erneut versuchen.');
      }
      if (response.status === 413 && attached && attempt < 2) {
        await response.body?.cancel(); attached = false;
        note = 'Discord hat den Anhang wegen seiner Größe abgelehnt; nur Text gesendet.';
        payload.content += '\nDiscord konnte den Anhang nicht annehmen. Der Clip bleibt lokal gespeichert.';
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 401 || response.status === 404 ? 'Discord-Webhook ungültig oder gelöscht. URL prüfen.' : response.status === 403 ? 'Discord-Zugriff verweigert. Webhook und Kanal prüfen.' : 'Discord hat die Nachricht abgelehnt. Webhook und Kanal prüfen.'); }
      const message = await response.json().catch(() => null);
      if (!message || !/^\d{1,22}$/.test(message.id)) throw new Error('Discord-Zustellung nicht bestätigt. Erneutes Senden kann eine doppelte Nachricht erzeugen.');
      return { status: 'sent', at: new Date().toISOString(), messageId: message.id, attachmentSent: attached, ...(note ? { note } : {}) };
    }
    throw new Error('Discord-Versand fehlgeschlagen.');
  }
}
