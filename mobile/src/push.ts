import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import Constants from 'expo-constants';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
export async function pushAddress() {
  if (!Device.isDevice || Platform.OS === 'web') throw new Error('Push benötigt eine installierte App auf einem echten Handy.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Für diesen Build fehlt das Expo-Projekt. Zuerst Expo und die Push-Zugangsdaten für Android/iOS einrichten und die App neu bauen.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('tuerwache', { name: 'Türwache', importance: AndroidImportance.HIGH });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Benachrichtigungen wurden nicht erlaubt. Du kannst sie später in den Handy-Einstellungen freigeben.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export function pushReadiness(language='de'){
 const en=language==='en',projectId=Constants.expoConfig?.extra?.eas?.projectId||Constants.easConfig?.projectId;
 if(!Device.isDevice||Platform.OS==='web')return en?'Push testing requires a physical iOS/Android device.':'Push-Tests benötigen ein echtes iOS-/Android-Handy.';
 if(!projectId)return en?'This build has no Expo project. Configure Expo plus Firebase/APNs credentials and create a new build.':'Diesem Build fehlt das Expo-Projekt. Expo und Firebase/APNs einrichten und danach neu bauen.';
 return en?'Project configured. Enable permission, save your selection and send a test. Provider receipts do not confirm that the alert was shown.':'Projekt eingerichtet. Berechtigung erlauben, Auswahl speichern und einen Test senden. Anbieterbestätigungen beweisen nicht die Anzeige am Handy.';
}
