import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
export type Session = { base: string; token: string; deviceId: string; expiresAt: string; user: { id: string; name: string; role: string } };
const key = 'tuerwache.session.v1';
export function serverUrl(value: string) {
  const url = new URL(value.trim());
  const development = __DEV__ && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(development && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Bitte eine HTTPS-Serveradresse ohne Unterpfad angeben, z. B. https://tuerwache.example.de.');
  return url.origin;
}
export async function savedSession(): Promise<Session | null> {
  if (Platform.OS === 'web') return null;
  const value = await SecureStore.getItemAsync(key);
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
export async function remember(session: Session | null) {
  if (Platform.OS === 'web') return;
  if (session) await SecureStore.setItemAsync(key, JSON.stringify(session), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(key);
}
export async function request(base: string, path: string, token?: string, body?: unknown) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', headers: { 'X-Tuerwache-App': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    const value = await response.json();
    if (!response.ok) { const error = new Error(value.error || 'Serveranfrage fehlgeschlagen.') as Error & { status?: number }; error.status = response.status; throw error; }
    return value;
  } finally { clearTimeout(timer); }
}

export async function savedLanguage(){if(Platform.OS==='web')return 'de';return (await SecureStore.getItemAsync('tuerwache.language.v1'))==='en'?'en':'de';}
export async function rememberLanguage(language:string){if(Platform.OS!=='web')await SecureStore.setItemAsync('tuerwache.language.v1',language==='en'?'en':'de');}
