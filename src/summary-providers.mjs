import { isIP } from 'node:net';
import { providerInfo } from './provider-catalog.mjs';
import {createStoryboard} from './media.mjs';

export function normalizeProviderUrl(provider, value) {
  const info = providerInfo(provider);
  if (!info) throw new Error('KI-Anbieter unbekannt.');
  if (provider === 'ollama') return normalizeOllamaUrl(value);
  if (!info.customUrl) {
    if (value && value.replace(/\/$/, '') !== info.baseUrl) throw new Error('KI-Anbieter verwendet einen festen API-Endpunkt.');
    return info.baseUrl;
  }
  let url; try { url = new URL(value); } catch { throw new Error('KI-API-Adresse ungültig.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const octets = isIP(host) === 4 ? host.split('.').map(Number) : [];
  const local = ['localhost', '::1'].includes(host) || (octets.length && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)));
  const invalid = url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9_./-]*$/.test(url.pathname);
  if (invalid || (info.local ? !local || !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:' || local || !host.includes('.') || isIP(host) || /\.(local|internal|localhost)$/.test(host))) throw new Error(info.local ? 'KI-Server benötigt localhost oder eine private IPv4-Adresse ohne Zugangsdaten.' : 'KI-Cloud-Endpunkt benötigt eine öffentliche HTTPS-Domain ohne Zugangsdaten.');
  return url.href.replace(/\/$/, '');
}

export function normalizeOllamaUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Ollama-Adresse ungültig.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const octets = isIP(host) === 4 ? host.split('.').map(Number) : [];
  const local = ['localhost', '::1'].includes(host) || (octets.length && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)));
  if (!local || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error('Ollama benötigt localhost oder eine private IPv4-Adresse ohne Pfad.');
  return url.origin;
}

export function validModel(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(value) && !value.includes('..'); }
export function localModel(value) { return validModel(value) && !/(?:^|[-:/])cloud(?:$|[-:/])/i.test(value); }

export async function boundedJson(response, maxBytes = 1_048_576) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('KI-Anbieter liefert keine lesbare Antwort.');
  const chunks = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) throw new Error('KI-Antwort zu groß.'); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { await reader.cancel().catch(() => {}); throw new Error('KI-Antwort nicht lesbar oder zu groß.'); }
}

function cleanText(value) {
  if (typeof value !== 'string') throw new Error('KI-Anbieter hat keine Zusammenfassung geliefert.');
  const result = value.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  if (!result || result.length > 2400) throw new Error('KI-Zusammenfassung fehlt oder ist zu lang.');
  return [...new Intl.Segmenter('de', { granularity: 'sentence' }).segment(result)].slice(0, 2).map(item => item.segment).join('').trim();
}

export class SummaryProviders {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; }
  async json(url, options, timeout = 10_000) {
    let response;
    try { response = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('KI-Anbieter nicht erreichbar oder Zeitüberschreitung.'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 403 ? 'KI-Anbieter verweigert Zugriff. API-Schlüssel und Freigabe prüfen.' : response.status === 404 ? 'KI-Modell oder Endpunkt nicht gefunden.' : response.status === 429 ? 'KI-Anbieter begrenzt Anfragen oder API-Guthaben fehlt.' : 'KI-Anbieter hat die Anfrage abgelehnt. Modell und Einstellungen prüfen.');
    }
    return boundedJson(response);
  }
  async models(baseUrl) {
    const result = await this.json(`${normalizeOllamaUrl(baseUrl)}/api/tags`, { method: 'GET' });
    if (!Array.isArray(result.models)) throw new Error('Ollama liefert keine Modellliste.');
    return result.models.filter(model => localModel(model.name)).slice(0, 50).map(model => ({ name: model.name, size: Number.isSafeInteger(model.size) ? model.size : null }));
  }
  async inspect(baseUrl, model) {
    if (!localModel(model)) throw new Error('Ein lokales Ollama-Modell ohne Cloud-Kennung wählen.');
    const data = await this.json(`${normalizeOllamaUrl(baseUrl)}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, verbose: false }) });
    if (data.remote_host || data.remote_model || !Array.isArray(data.capabilities) || !data.capabilities.includes('vision')) throw new Error('Das gewählte Ollama-Modell muss lokal installiert sein und Bilder unterstützen.');
    return { vision: true };
  }
  async check(provider, config) {
    const info = providerInfo(provider);
    if (!info || provider === 'ollama') throw new Error('KI-Anbieter für diese Prüfung ungültig.');
    if (info.keyRequired && !config.apiKey) throw new Error('KI-API-Schlüssel zuerst speichern.');
    const headers = info.protocol === 'anthropic' ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' } : config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
    const data = await this.json(`${normalizeProviderUrl(provider, config.baseUrl)}/models`, { method: 'GET', headers });
    if (!Array.isArray(data.data)) throw new Error('KI-Anbieter liefert keine kompatible Modellliste. Modellnamen gegebenenfalls manuell eintragen.');
    return { models: data.data.filter(item => validModel(item.id)).slice(0, 200).map(item => ({ name: item.id })), checkedAt: new Date().toISOString(), visionVerified: false };
  }
  async summarize(provider, config, frames, prompt) {
    const started = Date.now();
    const info = providerInfo(provider);
    let data, value;
    if (provider === 'ollama') {
      if (!config.enabled || !localModel(config.model)) throw new Error('Ollama zuerst freigeben und ein lokales Bildmodell auswählen.');
      await this.inspect(config.baseUrl, config.model);
      const storyboard=await createStoryboard(frames);
      data = await this.json(`${normalizeOllamaUrl(config.baseUrl)}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, stream: false, keep_alive: '5m', messages: [{ role: 'user', content: prompt, images: [storyboard.toString('base64')] }], options: { temperature: 0, num_predict: 200, num_ctx: 8192, seed: 7 } }),
      }, 240_000);
      if (data.done !== true) throw new Error('Ollama hat die Zusammenfassung nicht abgeschlossen.');
      value = data.message?.content;
    } else if (provider === 'openai') {
      if (!config.enabled || !config.apiKey || !validModel(config.model)) throw new Error('OpenAI zuerst freigeben, API-Schlüssel und Bildmodell eintragen.');
      const content = [{ type: 'input_text', text: prompt }];
      for (const frame of frames) content.push({ type: 'input_text', text: `Videoposition: ${frame.seconds.toFixed(2)} Sekunden` }, { type: 'input_image', image_url: `data:image/jpeg;base64,${frame.bytes.toString('base64')}`, detail: 'low' });
      data = await this.json('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 500, input: [{ role: 'user', content }] }) }, 60_000);
      if (data.status !== 'completed') throw new Error('OpenAI hat die Zusammenfassung nicht vollständig abgeschlossen.');
      value = (data.output || []).filter(item => item.type === 'message' && item.role === 'assistant').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    } else if (info) {
      if (!config.enabled || !validModel(config.model) || (info.keyRequired && !config.apiKey)) throw new Error('KI-Anbieter zuerst freigeben, Bildmodell und gegebenenfalls API-Schlüssel eintragen.');
      const base = normalizeProviderUrl(provider, config.baseUrl);
      if (info.protocol === 'anthropic') {
        const content = [{ type: 'text', text: prompt }];
        for (const frame of frames) content.push({ type: 'text', text: `Videoposition: ${frame.seconds.toFixed(2)} Sekunden` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame.bytes.toString('base64') } });
        data = await this.json(`${base}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: config.model, max_tokens: 500, messages: [{ role: 'user', content }] }) }, 60_000);
        if (data.stop_reason !== 'end_turn') throw new Error('KI-Anbieter hat die Zusammenfassung nicht vollständig abgeschlossen.');
        value = (data.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
      } else {
        const content = [{ type: 'text', text: prompt }];
        for (const frame of frames) content.push({ type: 'text', text: `Videoposition: ${frame.seconds.toFixed(2)} Sekunden` }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.bytes.toString('base64')}` } });
        data = await this.json(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify({ model: config.model, stream: false, max_tokens: 500, messages: [{ role: 'user', content }] }) }, info.local ? 240_000 : 60_000);
        const choice = data.choices?.[0];
        if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls?.length) throw new Error('KI-Anbieter hat die Zusammenfassung nicht vollständig abgeschlossen.');
        value = Array.isArray(choice.message?.content) ? choice.message.content.filter(item => item.type === 'text').map(item => item.text).join('\n') : choice.message?.content;
      }
    } else throw new Error('Kein KI-Anbieter ausgewählt.');
    const usage = provider === 'ollama' ? { inputTokens: Number(data.prompt_eval_count) || 0, outputTokens: Number(data.eval_count) || 0 } : { inputTokens: Number(data.usage?.input_tokens ?? data.usage?.prompt_tokens) || 0, outputTokens: Number(data.usage?.output_tokens ?? data.usage?.completion_tokens) || 0 };
    return { text: cleanText(value), provider, model: config.model, elapsedMs: Date.now() - started, usage };
  }
}
