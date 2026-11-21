import React, { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text as NativeText, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { request, remember, savedSession, savedLanguage, rememberLanguage, serverUrl, Session } from './api';
import {Slot,router,usePathname,useLocalSearchParams} from 'expo-router';
import {mobileTranslate} from './translations';
import { pushReadiness, pushAddress } from './push';

type Camera = { id: string; name: string; model: string; battery: number | null; offline: boolean; features: Record<string, any>; permissions?: string[] };
type SiteCamera = { id: string; name: string; permissions: string[]; status: 'online' | 'offline' | 'disconnected' | 'paused'; lastEvent?: { type: string; at: string } | null };
type Site = { id: string; name: string; cameras: SiteCamera[] };
type QuietHours = { enabled: boolean; start: string; end: string; timeZone: string; allowDing: boolean };
type Entry = { id: string; cameraId: string; camera: string; type: string; at: string; message: string; status?: string; clip?: string; ai?: { status: string; personDetected?: boolean; names?: string[] }; summary?: { status: string; text?: string; message?: string } };
type State = { user: Session['user'] | null; phase: string; cameras: Camera[]; events: Entry[]; sites?: Site[]; permissions?: string[]; quietHours?: QuietHours; recording?: {cameraId:string}; recordings?: {cameraId:string}[]; live?: { url: string; cameraId: string; status: string; expiresAt: string }; mobile?: { devices: { id: string; name: string; pushEnabled: boolean; subscriptions: Record<string, string[]>; lastPush?: { message: string } }[] } };
type Movie = { uri: string; live: boolean; title: string; until?: string; cameraId?: string };
const kinds = [['ding', 'Es klingelt'], ['clip', 'Klingel-Clip ist bereit'], ['person', 'Person / Gesicht erkannt'], ['summary', 'Szenenbeschreibung ist bereit']];
function can(state: State | null, id: string | undefined, action: string) {
  if (!state?.user) return false;
  if (state.user.role === 'admin') return true;
  if (!state.permissions) return ['clips', 'events', 'live', 'push'].includes(action) || state.user.role === 'operator';
  return id ? Boolean(state.sites?.some(site => site.cameras.some(camera => camera.id === id && camera.permissions.includes(action)))) : state.permissions.includes(action);
}
function Button({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[s.button, secondary && s.secondary, disabled && { opacity: .4 }]}><Text style={[s.buttonText, secondary && { color: '#254d3d' }]}>{label}</Text></Pressable>;
}
function MoviePlayer({ movie, session, close }: { movie: Movie; session: Session; close: () => void }) {
  const player = useVideoPlayer({ uri: movie.uri, contentType: movie.live ? 'hls' : 'progressive', headers: movie.live ? {} : { Authorization: `Bearer ${session.token}` } }, player => { player.play(); });
  const [error, setError] = useState('');
  useEffect(() => { const listener = player.addListener('statusChange', ({ status, error }) => { if (status === 'error') setError(error?.message || 'Video konnte nicht abgespielt werden.'); }); return () => listener.remove(); }, [player]);
  useEffect(() => { if (!movie.until) return; const timer = setTimeout(close, Math.max(0, Date.parse(movie.until) - Date.now())); return () => clearTimeout(timer); }, [movie.until, close]);
  return <View style={s.card}><Text style={s.h2}>{movie.title}</Text><VideoView player={player} style={s.video} nativeControls allowsPictureInPicture={false} />{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}<Text style={s.note}>{movie.live ? 'Livebild mit Kameraton, sofern verfügbar. Endet nach höchstens 90 Sekunden.' : 'Lokal auf deinem Server gespeicherter Clip.'}</Text><Button label="Video schließen" onPress={close} secondary /></View>;
}
const MobileContext=createContext<any>(null);
const LanguageContext=createContext({language:'de',setLanguage:(_value:string)=>{}});
function Text(props:React.ComponentProps<typeof NativeText>){const {language}=useContext(LanguageContext);const convert=(value:any):any=>typeof value==='string'?mobileTranslate(value,language):Array.isArray(value)?value.map(convert):value;return <NativeText {...props}>{convert(props.children)}</NativeText>;}
function Application() {
  const pathname=usePathname(),page=pathname==='/settings'?'settings':pathname==='/clips'?'clips':pathname==='/events'||pathname.startsWith('/event/')?'events':'cameras';
  const [language,setLanguage]=useState('de');
  const changeLanguage=()=>{const next=language==='de'?'en':'de';setLanguage(next);rememberLanguage(next).catch(()=>{});};
  useEffect(()=>{savedLanguage().then(setLanguage).catch(()=>{});},[]);
  const setPage=(value:string)=>router.push(value==='cameras'?'/':value==='settings'?'/settings':'/events');
  const [session, setSession] = useState<Session | null>(null), [loaded, setLoaded] = useState(false);
  const [base, setBase] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState('');
  const [otp,setOtp]=useState('');
  const [clipItems,setClipItems]=useState<Entry[]>([]),[clipCursor,setClipCursor]=useState<string|null>(null);
  const [state, setState] = useState<State | null>(null);
  const [success,setSuccess]=useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [connected, setConnected] = useState(false);
  const [movie, setMovie] = useState<Movie | null>(null), [subscriptions, setSubscriptions] = useState<Record<string, string[]>>({});
  const active = useRef(true), changing = useRef(false), pendingEvent = useRef<string | null>(null), currentSession = useRef(session), currentMovie = useRef(movie), initializedDevice = useRef(''), archiveInitialized=useRef('');
  useEffect(() => { currentSession.current = session; currentMovie.current = movie; }, [session, movie]);
  useEffect(() => { savedSession().then(value => { if (value) { setSession(value); setBase(value.base); setName(value.user.name); } }).catch(() => {}).finally(() => setLoaded(true)); }, []);
  const logoutLocal = useCallback(async () => { setClipItems([]);setClipCursor(null);archiveInitialized.current=''; await remember(null); setMovie(null); setState(null); setSession(null); setConnected(false); initializedDevice.current = ''; }, []);
  const refresh = useCallback(async () => {
    if (!session || !active.current) return;
    try {
      const next: State = await request(session.base, '/api/state', session.token);
      const timeline=await request(session.base,'/api/timeline?limit=48',session.token);
      next.events=timeline.items;
      const archive=await request(session.base,'/api/clips?limit=24',session.token);
      const requestedEvent=pendingEvent.current||(/^\/event\/([a-f0-9-]{36})$/.exec(pathname)?.[1]);
      if(requestedEvent&&!next.events.some(event=>event.id===requestedEvent)){try{const detail=await request(session.base,'/api/events/'+encodeURIComponent(requestedEvent),session.token);next.events.unshift(detail.event);}catch(cause:any){if(cause.status!==404)throw cause;}}
      if (currentSession.current?.token !== session.token) return;
      if (!next.user) throw new Error('Bitte erneut anmelden.');
      const scope = JSON.stringify([next.permissions, next.sites?.flatMap(site => site.cameras.map(camera => [camera.id, camera.permissions]))]);
      const archiveKey = session.token + scope;
      const sameScope = archiveInitialized.current === archiveKey;
      setClipItems(previous => [...archive.items, ...(sameScope ? previous.filter(item => can(next, item.cameraId, 'clips') && !archive.items.some((fresh: Entry) => fresh.id === item.id)) : [])]);
      if (!sameScope) { archiveInitialized.current = archiveKey; setClipCursor(archive.nextCursor); }
      setMovie(previous => previous && can(next, previous.cameraId, previous.live ? 'live' : 'clips') && (!previous.live || next.live) ? previous : null);
      setState(next); setConnected(true);
      const device = next.mobile?.devices.find(device => device.id === session.deviceId);
      if (device && initializedDevice.current !== device.id) { initializedDevice.current = device.id; setSubscriptions(device.subscriptions || {}); }
      if (pendingEvent.current) {
        router.push({pathname:'/event/[id]',params:{id:pendingEvent.current}});
        const event = next.events.find(event => event.id === pendingEvent.current);
        if (event?.clip && event.status === 'ready') setMovie({ uri: session.base + '/clips/' + event.clip, live: false, title: event.camera || 'Ereignis', cameraId: event.cameraId });
        pendingEvent.current = null;
      }
    } catch (cause: any) {
      setConnected(false); setError(cause.status === 401 ? 'Deine Anmeldung ist abgelaufen oder wurde widerrufen.' : 'Server nicht erreichbar. Verbindung und Serveradresse prüfen.');
      if (cause.status === 401) await logoutLocal();
    }
  }, [session, logoutLocal,pathname]);
  useEffect(() => { if (!session) return; const initial = setTimeout(refresh, 0), timer = setInterval(refresh, 8000); return () => { clearTimeout(initial); clearInterval(timer); }; }, [session, refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      active.current = next === 'active';
      if (active.current) refresh();
      else if (currentMovie.current?.live) { const value = currentSession.current; if (value) request(value.base, '/api/live/stop', value.token, {}).catch(() => {}); setMovie(null); }
    }); return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => { const id = response.notification.request.content.data?.eventId; if (typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)){pendingEvent.current = id;if(currentSession.current)router.push({pathname:'/event/[id]',params:{id}});}else if(currentSession.current)router.push('/settings');refresh(); };
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    Notifications.getLastNotificationResponseAsync().then(response => { if (response) { open(response); Notifications.clearLastNotificationResponseAsync().catch(() => {}); } });
    return () => listener.remove();
  }, [refresh]);
  const execute = useCallback(async (path: string, body = {}) => {
    if (!session || changing.current) return null;
    changing.current = true; setBusy(true); setError('');setSuccess('');
    try { const result = await request(session.base, path, session.token, body); await refresh();setSuccess(mobileTranslate(path==='/api/capture'?'Aufnahme gestartet.':path==='/api/mobile/test'?'Push-Test beim Dienst angefragt. Zustellung am Handy prüfen.':path==='/api/live/start'?'Livebild ist bereit.':'Aktion erfolgreich abgeschlossen.',language));return result; }
    catch (cause: any) { setError(cause.message || 'Aktion fehlgeschlagen.'); return null; }
    finally { changing.current = false; setBusy(false); }
  }, [session, refresh,language]);
  const closeMovie = useCallback(() => { const live = currentMovie.current?.live; setMovie(null); if (live) execute('/api/live/stop'); }, [execute]);
  async function login() {
    if (changing.current) return; changing.current = true; setBusy(true); setError('');
    try {
      const address = serverUrl(base);
      const result = await request(address, '/api/mobile/login', undefined, { name, password,otp, deviceName: Device.deviceName || `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} · Türwache` });
      const next = { ...result, base: address }; await remember(next); setSession(next); setState(null);
    } catch (cause: any) { setError(cause.message || 'Anmeldung fehlgeschlagen.'); }
    finally { setPassword('');setOtp(''); changing.current = false; setBusy(false); }
  }
  async function configurePush(enable: boolean) {
    if (!session || changing.current) return; changing.current = true; setBusy(true); setError('');
    try {
      const token = enable ? await pushAddress() : '';
      const allowed = Object.fromEntries(Object.entries(subscriptions).filter(([id]) => state?.cameras.some(camera => camera.id === id) && can(state, id, 'push')));
      await request(session.base, '/api/mobile/configure', session.token, { token, subscriptions: allowed, language }); await refresh();
      Alert.alert('Türwache', enable ? 'Push ist für deine Auswahl eingerichtet. Eine echte Benachrichtigung muss noch am Handy geprüft werden.' : 'Push auf diesem Handy ausgeschaltet.');
    } catch (cause: any) { setError(cause.message || 'Push konnte nicht eingerichtet werden.'); }
    finally { changing.current = false; setBusy(false); }
  }
  const isRecording=(id:string)=>Boolean(state?.recordings?.some(job=>job.cameraId===id)||state?.recording?.cameraId===id);
  const loadMoreClips=async()=>{if(!session||!clipCursor)return;const expected=session.token;const result=await request(session.base,'/api/clips?limit=24&cursor='+encodeURIComponent(clipCursor),session.token);if(currentSession.current?.token!==expected)return;setClipItems(current=>[...current,...result.items.filter((entry:Entry)=>!current.some(item=>item.id===entry.id))]);setClipCursor(result.nextCursor);};
  if (!loaded) return <View style={s.center}><ActivityIndicator color="#254d3d" /></View>;
  if (!session) return <LanguageContext.Provider value={{language,setLanguage}}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.login}>
    <Text style={s.logo}>türwache.</Text><Text style={s.h1}>Dein Server. Deine Kameras.</Text><Pressable onPress={()=>changeLanguage()}><NativeText>Deutsch / English</NativeText></Pressable><Text style={s.note}>Mit deinem Türwache-Konto anmelden. Die Ring-Anmeldung verwaltest du im Web auf deinem Server.</Text>
    <Text style={s.label}>Serveradresse</Text><TextInput accessibilityLabel="Serveradresse" value={base} onChangeText={setBase} placeholder="https://tuerwache.example.de" autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} />
    <Text style={s.label}>Türwache-Benutzername</Text><TextInput accessibilityLabel="Benutzername" value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} textContentType="username" style={s.input} />
    <Text style={s.label}>Passwort</Text><TextInput accessibilityLabel="Passwort" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" style={s.input} onSubmitEditing={login} />
    <Text style={s.label}>2FA- oder Wiederherstellungscode (falls eingerichtet)</Text><TextInput accessibilityLabel="2FA-Code" value={otp} onChangeText={setOtp} autoCapitalize="none" autoCorrect={false} textContentType="oneTimeCode" style={s.input} maxLength={40} onSubmitEditing={login} />
    <Button label={busy ? 'Verbinden …' : 'Mit Server verbinden'} onPress={login} disabled={busy} />{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <Text style={s.note}>Die Verbindung ist verschlüsselt. Dein Anmeldeschlüssel liegt im geschützten Gerätespeicher. Keine Serveradresse? Zuerst HTTPS für deinen Server einrichten.</Text>
  </ScrollView></LanguageContext.Provider>;
  const currentDevice = state?.mobile?.devices.find(device => device.id === session.deviceId);
  const context={state,session,busy,connected,execute,setMovie,closeMovie,subscriptions,setSubscriptions,configurePush,currentDevice,logoutLocal,isRecording,clipItems,clipCursor,loadMoreClips,language};
  return <LanguageContext.Provider value={{language,setLanguage}}><MobileContext.Provider value={context}><View style={{ flex: 1 }}>
    <View style={s.header}><Text style={s.logo}>türwache.</Text><Text style={s.note}>{connected ? '● Verbunden' : '○ Server nicht erreichbar'} · {session.user.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Deutsch / English" onPress={()=>changeLanguage()}><Text style={s.label}>{language==='de'?'DE · English':'Deutsch · EN'}</Text></Pressable></View>
    {busy && <ActivityIndicator color="#254d3d" style={{ margin: 8 }} />}{error ? <Text accessibilityRole="alert" style={[s.error, { marginHorizontal: 20 }]}>{error}</Text> : null}
    {success?<Text accessibilityLiveRegion="polite" style={[s.note,{paddingHorizontal:20,paddingTop:10}]}>{success}</Text>:null}
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true);setClipItems([]);archiveInitialized.current='';setClipCursor(null);await refresh();setRefreshing(false); }} />}>
      {movie && <MoviePlayer key={movie.uri} movie={movie} session={session} close={closeMovie} />}
      {state?.live && !movie && <Button label="Laufendes Livebild beenden" secondary disabled={busy} onPress={() => execute('/api/live/stop')} />}
      <Slot />
    </ScrollView>
    <View style={s.tabs}>{[['cameras', 'Kameras'], ['clips','Clips'], ['events', 'Zeitstrahl'], ['settings', 'Mein Handy']].map(([id, label]) => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: page === id }} onPress={() => id==='clips'?router.push('/clips'):setPage(id)} style={[s.tab, page === id && s.tabActive]}><Text style={page === id ? s.tabTextActive : s.tabText}>{label}</Text></Pressable>)}</View>
  </View></MobileContext.Provider></LanguageContext.Provider>;
}
export default function App() { return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#f4f5f1' }}><StatusBar style="dark" /><Application /></SafeAreaView></SafeAreaProvider>; }
const s = StyleSheet.create({ center: { flex: 1, justifyContent: 'center' }, login: { padding: 26, paddingTop: 64, gap: 12, flexGrow: 1, maxWidth: 600, width: '100%', alignSelf: 'center' }, logo: { fontSize: 26, fontWeight: '800', color: '#254d3d', letterSpacing: -1 }, h1: { fontSize: 28, fontWeight: '700', color: '#20332c', marginBottom: 10 }, h2: { fontSize: 18, fontWeight: '600', color: '#20332c', marginBottom: 8 }, header: { padding: 20, borderBottomColor: '#e3e7df', borderBottomWidth: 1 }, content: { padding: 20, paddingBottom: 40, gap: 14 }, card: { backgroundColor: '#fff', borderRadius: 14, borderColor: '#e3e7df', borderWidth: 1, padding: 20, gap: 8 }, note: { color: '#707d72', fontSize: 12, lineHeight: 20 }, text: { color: '#20332c', fontSize: 14, lineHeight: 22 }, label: { color: '#20332c', fontSize: 13, fontWeight: '600', marginTop: 10 }, input: { borderWidth: 1, borderColor: '#cfd9cc', backgroundColor: '#fff', borderRadius: 8, padding: 14, fontSize: 16, color: '#20332c' }, button: { backgroundColor: '#254d3d', padding: 15, borderRadius: 9, alignItems: 'center', marginTop: 8 }, secondary: { backgroundColor: '#edf2e9' }, buttonText: { fontSize: 14, fontWeight: '600', color: '#fff' }, error: { color: '#9a4a31', padding: 12, backgroundColor: '#fff1e8', borderRadius: 8, lineHeight: 22 }, tabs: { flexDirection: 'row', borderTopColor: '#dce3d8', borderTopWidth: 1, padding: 8, backgroundColor: '#fff', gap: 4 }, tab: { flex: 1, alignItems: 'center', padding: 14, borderRadius: 9 }, tabActive: { backgroundColor: '#edf2e9' }, tabText: { color: '#778078', fontSize: 13 }, tabTextActive: { color: '#254d3d', fontSize: 13, fontWeight: '700' }, switch: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomColor: '#edf0e9', borderBottomWidth: 1, paddingVertical: 10 }, video: { width: '100%', aspectRatio: 1, backgroundColor: '#182d29', borderRadius: 8 } });

export function CamerasScreen() {
  const { state, session, busy, connected, execute, setMovie, isRecording } = useContext(MobileContext) as { state: State | null; session: Session; busy: boolean; connected: boolean; execute: (path: string, body: unknown) => Promise<any>; setMovie: (movie: Movie) => void; isRecording: (id: string) => boolean };
  const fallback: Site = { id: 'legacy', name: 'Kameras', cameras: (state?.cameras || []).map(camera => ({ id: camera.id, name: camera.name, permissions: [], status: camera.offline ? 'offline' : camera.features.monitoring ? 'online' : 'paused' })) };
  const sites = (state?.sites || [fallback]).filter(site => site.cameras.length);
  const statuses = { online: 'Online', offline: 'Offline', disconnected: 'Ring-Verbindung getrennt', paused: 'Pausiert' };
  return <><Text style={s.h1}>Kameras nach Standort</Text>{sites.map(site => <React.Fragment key={site.id}>
    <Text style={s.h2}>{site.name}</Text>{site.cameras.map(item => {
      const camera = state?.cameras.find(camera => camera.id === item.id);
      const ready = connected && item.status === 'online';
      return <View key={item.id} style={s.card}>
        <Text style={s.h2}>{item.name}</Text><Text style={s.note}>{statuses[item.status]}{camera?.battery != null ? ` · Akku ${camera.battery}%` : ''}</Text>
        {item.lastEvent && <Text style={s.note}>{item.lastEvent.type === 'ding' ? 'Klingeln' : 'Bewegung'} · {new Date(item.lastEvent.at).toLocaleString('de-DE')}</Text>}
        {can(state, item.id, 'live') && <Button label="Livebild öffnen" disabled={busy || !ready || Boolean(state?.live)} onPress={async () => {
          const result = await execute('/api/live/start', { cameraId: item.id });
          if (result?.live) setMovie({ uri: session.base + result.live.url, live: true, title: item.name + ' · Live', until: result.live.expiresAt, cameraId: item.id });
        }} />}
        {can(state, item.id, 'capture') && <Button label={isRecording(item.id) ? 'Aufnahme läuft …' : `${camera?.features.recordingSeconds || 10} Sekunden aufnehmen`} secondary disabled={busy || !ready || isRecording(item.id)} onPress={() => execute('/api/capture', { cameraId: item.id })} />}
      </View>;
    })}</React.Fragment>)}{state && !sites.length && <Text style={s.note}>Für dieses Konto sind noch keine Kameras freigegeben.</Text>}</>;
}

export function EventsScreen(){const {state,session,busy,execute,setMovie,closeMovie}=useContext(MobileContext);const params=useLocalSearchParams<{id?:string}>();const entries:Entry[]=params.id?(state?.events||[]).filter((entry:Entry)=>entry.id===params.id):(state?.events||[]);return (<><Text style={s.h1}>Ereignisse</Text>{params.id&&!entries.length&&<Text style={s.note}>Ereignis nicht mehr verfügbar. Bitte Zeitstrahl öffnen.</Text>}{entries.map((event:Entry) => <View key={event.id} style={s.card}>
        <Text style={s.h2}>{event.camera || 'Türwache'} · {event.type === 'ding' ? 'Klingeln' : event.type === 'motion' ? 'Bewegung' : event.type === 'clip' ? 'Aufnahme' : 'System'}</Text><Text style={s.note}>{new Date(event.at).toLocaleString('de-DE')}</Text><Text style={s.text}>{event.message}</Text>
        {event.ai?.status === 'ready' && <Text style={s.text}>{event.ai.personDetected ? 'Person / Gesicht erkannt' : 'Keine Person erkannt'}{event.ai.names?.length ? ` · KI-Zuordnung: ${event.ai.names.join(', ')}` : ''}</Text>}
        {event.summary && <><Text style={s.text}>{event.summary.status === 'ready' ? event.summary.text : event.summary.message || 'Szenenbeschreibung wird vorbereitet …'}</Text><Text style={s.note}>KI-Beschreibungen können Fehler enthalten.</Text></>}
        {event.clip && event.status === 'ready' && <>
          <Button label="Clip ansehen" secondary onPress={() => { closeMovie(); setMovie({ uri: session.base + '/clips/' + event.clip, live: false, title: event.camera || 'Aufnahme', cameraId: event.cameraId }); }} />
          {can(state, event.cameraId, 'analyze') && <Button label="Szene beschreiben" secondary disabled={busy || !state.cameras.find((camera:Camera) => camera.id === event.cameraId)?.features.monitoring || !(state.cameras.find((camera:Camera) => camera.id === event.cameraId)?.features.summaryProvider && state.cameras.find((camera:Camera) => camera.id === event.cameraId)?.features.summaryProvider !== 'off')} onPress={() => execute('/api/summarize', { id: event.id })} />}
        </>}
      </View>)}</>);}

function QuietHoursEditor({ value, disabled, save }: { value: QuietHours; disabled: boolean; save: (value: QuietHours) => void }) {
  const [draft, setDraft] = useState(value);
  const isTime = (time: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  return <View style={s.card}>
    <Text style={s.h2}>Push-Ruhezeiten</Text>
    <View style={s.switch}><Text style={{ flex: 1 }}>Ruhezeiten aktivieren</Text><Switch accessibilityLabel="Ruhezeiten aktivieren" value={draft.enabled} onValueChange={enabled => setDraft({ ...draft, enabled })} /></View>
    {(['start', 'end', 'timeZone'] as const).map(key => <React.Fragment key={key}>
      <Text style={s.label}>{key === 'start' ? 'Von (HH:MM)' : key === 'end' ? 'Bis (HH:MM)' : 'Zeitzone'}</Text>
      <TextInput style={s.input} value={draft[key]} onChangeText={text => setDraft({ ...draft, [key]: text })} accessibilityLabel={key === 'start' ? 'Von' : key === 'end' ? 'Bis' : 'Zeitzone'} autoCorrect={false} maxLength={key === 'timeZone' ? 80 : 5} />
    </React.Fragment>)}
    <View style={s.switch}><Text style={{ flex: 1 }}>Klingeln darf die Ruhezeit unterbrechen</Text><Switch accessibilityLabel="Klingeln während der Ruhezeit" value={draft.allowDing} onValueChange={allowDing => setDraft({ ...draft, allowDing })} /></View>
    <Button label="Ruhezeiten speichern" disabled={disabled || !isTime(draft.start) || !isTime(draft.end) || draft.start === draft.end || !draft.timeZone.trim()} onPress={() => save(draft)} />
  </View>;
}

export function SettingsScreen(){const {state,session,busy,connected,execute,subscriptions,setSubscriptions,configurePush,currentDevice,logoutLocal,language}=useContext(MobileContext);return (<><Text style={s.h1}>Dein Handy</Text>{state?.quietHours && <QuietHoursEditor key={JSON.stringify(state.quietHours)} value={state.quietHours} disabled={busy || !connected} save={value => execute('/api/account/quiet-hours', value)} />}<View style={s.card}>
        <Text style={s.h2}>Push je Kamera</Text><Text style={s.note}>{pushReadiness(language)}</Text><Text style={s.note}>Wähle die Meldungen für dieses Handy. Auf dem Sperrbildschirm erscheinen neutrale Texte; Clips und Bilder öffnest du nach der Anmeldung. Personenmeldungen benötigen eine Aufnahme und aktivierte lokale KI.</Text>
        {state?.cameras.filter((camera: Camera) => can(state, camera.id, 'push')).map((camera:Camera) => <View key={camera.id}><Text style={[s.h2, { marginTop: 18 }]}>{camera.name}{!camera.features.monitoring ? ' · pausiert' : ''}</Text>{kinds.map(([kind, title]) => <View key={kind} style={s.switch}><Text style={[s.text, { flex: 1 }]}>{title}</Text><Switch accessibilityLabel={`${camera.name}: ${title}`} value={subscriptions[camera.id]?.includes(kind) || false} onValueChange={value => setSubscriptions((current:Record<string,string[]>) => ({ ...current, [camera.id]: value ? [...new Set([...(current[camera.id] || []), kind])] : (current[camera.id] || []).filter((item:string) => item !== kind) }))} trackColor={{ true: '#71915d' }} /></View>)}</View>)}
        <Button label={currentDevice?.pushEnabled ? 'Push-Auswahl speichern' : 'Push aktivieren & Auswahl speichern'} disabled={busy || !connected} onPress={() => configurePush(true)} />
        {currentDevice?.pushEnabled && <Button label="Push auf diesem Handy ausschalten" secondary disabled={busy || !connected} onPress={() => configurePush(false)} />}<Button label="Push-Test an dieses Handy senden" secondary disabled={busy||!currentDevice?.pushEnabled} onPress={()=>execute('/api/mobile/test')} />{currentDevice?.lastPush && <Text style={s.note}>{currentDevice.lastPush.message}</Text>}
      </View><View style={s.card}>
        <Text style={s.h2}>Server & Anmeldung</Text><Text selectable style={s.note}>{session.base}</Text><Text style={s.note}>Anmeldung gültig bis {new Date(session.expiresAt).toLocaleDateString('de-DE')}. Änderungen an Passwort oder Rolle widerrufen die Handy-Anmeldung.</Text>
        <Button label="Server im Browser öffnen" secondary onPress={() => Linking.openURL(session.base + '/mobile')} /><Text style={s.note}>Kameras, KI-Anbieter, Speicher, bekannte Gesichter und Benutzer verwaltest du auf den einzelnen Seiten der Web-App.</Text>
        <Button label="Von diesem Server abmelden" secondary disabled={busy} onPress={async () => { const result = await execute('/api/mobile/logout'); if (result) await logoutLocal(); }} />
      </View></>);}

export function ClipsScreen(){const {clipItems,session,setMovie,closeMovie,clipCursor,loadMoreClips,state}=useContext(MobileContext);return <><Text style={s.h1}>Clips</Text>{clipItems.filter((event: Entry) => can(state, event.cameraId, 'clips')).map((event:Entry)=><View key={event.id} style={s.card}><Text style={s.h2}>{event.camera}</Text><Text style={s.note}>{new Date(event.at).toLocaleString()}</Text><Text style={s.text}>{event.summary?.text||event.message}</Text><Button label="Clip ansehen" onPress={()=>{closeMovie();setMovie({uri:session.base+'/clips/'+event.clip,live:false,title:event.camera,cameraId:event.cameraId});}} /></View>)}{clipCursor&&<Button label="Weitere Clips laden" secondary onPress={()=>loadMoreClips().catch(()=>Alert.alert('Türwache','Clips konnten nicht geladen werden.'))} />}</>;}
