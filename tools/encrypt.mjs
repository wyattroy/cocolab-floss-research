/**
 * encrypt.mjs — turn src/insights.json into data/insights.enc.json
 *
 * The site is a public GitHub Pages repo, so the gate cannot be a JavaScript
 * `if (password === ...)` check — anyone can read the source and skip it. The
 * research itself is therefore encrypted, and the password is the only way to
 * derive the key. What ships to GitHub is ciphertext and nothing else.
 *
 *   AES-256-GCM  ·  PBKDF2-HMAC-SHA256, 310,000 iterations  ·  random salt + IV
 *
 * The password is read from $SITE_PASSWORD and is deliberately NOT stored here.
 * This file ships to a public repo — a default baked into it would publish the
 * key alongside the ciphertext and make the whole scheme decorative.
 *
 * Usage:  SITE_PASSWORD='your-password' node tools/encrypt.mjs
 */

import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Keep in sync with js/gate.js — both sides must derive the key identically.
const PBKDF2_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const PASSWORD = process.env.SITE_PASSWORD;
if (!PASSWORD) {
  console.error("Set SITE_PASSWORD, e.g.  SITE_PASSWORD='your-password' node tools/encrypt.mjs");
  process.exit(1);
}

const plaintext = readFileSync(resolve(ROOT, 'src/insights.json'), 'utf8');
JSON.parse(plaintext); // fail loudly on malformed source rather than shipping a broken payload

const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

const baseKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(PASSWORD),
  'PBKDF2',
  false,
  ['deriveKey']
);

const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);

const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  key,
  new TextEncoder().encode(plaintext)
);

const b64 = (buf) => Buffer.from(buf).toString('base64');

writeFileSync(
  resolve(ROOT, 'data/insights.enc.json'),
  JSON.stringify(
    {
      v: 1,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: b64(salt),
      iv: b64(iv),
      ct: b64(ciphertext),
    },
    null,
    2
  ) + '\n'
);

console.log(`Encrypted ${plaintext.length} chars -> data/insights.enc.json`);
