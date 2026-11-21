const fs = require('node:fs');
const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
const googleFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
module.exports = ({ config: base }) => ({
  ...base, name: 'Türwache', slug: 'tuerwache', scheme: 'tuerwache', version: '0.13.0',
  ios: { ...base.ios, bundleIdentifier: 'de.tuerwache.app', config: { usesNonExemptEncryption: false } },
  android: { ...base.android, package: 'de.tuerwache.app', versionCode: 4, allowBackup: false, blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW'], adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#142f29' }, ...(fs.existsSync(googleFile) ? { googleServicesFile: googleFile } : {}) },
  plugins: [...base.plugins, 'expo-router', ['expo-notifications', { defaultChannel: 'tuerwache' }], ['expo-build-properties', { android: process.platform === 'win32' ? { cmakeVersion: '3.31.6' } : {} }]],
  extra: { ...(projectId ? { eas: { projectId } } : {}) },
});
