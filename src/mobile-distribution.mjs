import { stat,readFile } from 'node:fs/promises';
import { join } from 'node:path';

export class MobileDistribution {
  constructor(directory) { this.apk = join(directory, 'Tuerwache-Android-Test.apk'); }
  async info() {
    try {
      const file = await stat(this.apk);
      let metadata={};try{const manifest=JSON.parse((await readFile(join(this.apk,'..','android-build.json'),'utf8')).replace(/^\uFEFF/,''));if(manifest.bytes===file.size&&/^\d+\.\d+\.\d+$/.test(manifest.version)&&/^[a-f0-9]{64}$/i.test(manifest.sha256))metadata={version:manifest.version,sha256:manifest.sha256,signing:'test'};}catch{/* Older builds do not have metadata. */}
      return { android: { available: file.isFile() && file.size > 0, bytes: file.size, updatedAt: file.mtime.toISOString(), downloadUrl: '/api/mobile/download/android',...metadata }, ios: { available: false } };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { android: { available: false }, ios: { available: false } };
    }
  }
}
