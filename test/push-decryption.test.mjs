import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import encryption from 'http_ece';
import decryptModule from '@eneris/push-receiver/dist/utils/decrypt.js';

const decrypt = decryptModule.default ?? decryptModule;

test('Echte WebPush-Verschlüsselung wird mit zusätzlichen Header-Parametern entschlüsselt', () => {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const sender = createECDH('prime256v1');
  sender.generateKeys();
  const authSecret = randomBytes(16);
  const salt = randomBytes(16);
  const expected = { data: { event: { ding: { id: 'synthetic-motion-test', subtype: 'motion' } } } };
  const ciphertext = encryption.encrypt(Buffer.from(JSON.stringify(expected)), {
    version: 'aesgcm', dh: receiver.getPublicKey(), privateKey: sender, salt, authSecret,
  });
  const keys = { privateKey: receiver.getPrivateKey().toString('base64'), authSecret: authSecret.toString('base64') };
  const publicKey = sender.getPublicKey().toString('base64url');
  for (const header of [`dh=${publicKey}; p256ecdsa=unused`, `p256ecdsa=unused; dh=${publicKey}`]) {
    const message = {
      appData: [
        { key: 'crypto-key', value: header },
        { key: 'encryption', value: `salt=${salt.toString('base64url')}; rs=4096` },
      ],
      rawData: ciphertext,
    };
    assert.deepEqual(decrypt(message, keys), expected);
  }
});
