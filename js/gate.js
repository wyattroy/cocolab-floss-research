/**
 * gate.js — password gate.
 *
 * This is not a cosmetic check. The research never ships to GitHub in
 * readable form: data/insights.enc.json is AES-256-GCM ciphertext, and the
 * password the client types is what derives the key. A wrong password does
 * not fail an `if` — it produces a key that cannot authenticate the GCM tag,
 * so `decrypt` throws and there is nothing to show.
 *
 * Must stay in sync with tools/encrypt.mjs.
 */

const PAYLOAD_URL = 'data/insights.enc.json';
const SESSION_KEY = 'cocolab-research-unlocked';

const b64ToBytes = (b64) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

let payloadPromise = null;
function fetchPayload() {
  // Start the download while the user is still typing — by the time they hit
  // enter the bytes are usually already here, so unlock feels instant.
  payloadPromise ||= fetch(PAYLOAD_URL, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`Could not load research payload (${r.status})`);
    return r.json();
  });
  return payloadPromise;
}

/** Resolves with the decrypted data object, or throws on a bad password. */
export async function unlock(password) {
  const payload = await fetchPayload();
  const key = await deriveKey(
    password,
    b64ToBytes(payload.salt),
    payload.iterations
  );
  // Throws OperationError if the GCM auth tag does not verify — i.e. wrong password.
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.iv) },
    key,
    b64ToBytes(payload.ct)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Wires up the gate form. Calls onUnlock(data) once the password is right.
 * The password (not the plaintext) is held in sessionStorage so a reload
 * inside the same tab does not re-prompt, and closing the tab forgets it.
 */
export function initGate(onUnlock) {
  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-input');
  const submit = document.getElementById('gate-submit');
  const status = document.getElementById('gate-status');

  fetchPayload().catch(() => {}); // warm the cache; real errors surface on submit

  function setStatus(msg, isError = false) {
    status.textContent = msg;
    status.classList.toggle('is-error', isError);
  }

  async function attempt(password, { silent = false } = {}) {
    if (!password) return false;
    submit.disabled = true;
    if (!silent) setStatus('Decrypting…');
    try {
      const data = await unlock(password);
      sessionStorage.setItem(SESSION_KEY, password);
      setStatus('');
      gate.classList.add('is-gone');
      document.body.classList.remove('locked');
      setTimeout(() => { gate.hidden = true; }, 720);
      onUnlock(data);
      return true;
    } catch (err) {
      submit.disabled = false;
      sessionStorage.removeItem(SESSION_KEY);
      if (silent) return false;
      // A network/parse failure is a different problem from a wrong password.
      const isNetwork = err instanceof TypeError || /payload/i.test(err.message || '');
      if (isNetwork) {
        setStatus('Could not reach the research file. Check your connection.', true);
      } else {
        gate.classList.add('is-wrong');
        setTimeout(() => gate.classList.remove('is-wrong'), 500);
        setStatus('That password is not right.', true);
        input.select();
      }
      return false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(input.value.trim());
  });

  input.addEventListener('input', () => {
    if (status.classList.contains('is-error')) setStatus('');
  });

  // Same-tab reload: re-derive from the remembered password rather than
  // persisting the decrypted research anywhere.
  const remembered = sessionStorage.getItem(SESSION_KEY);
  if (remembered) {
    attempt(remembered, { silent: true }).then((ok) => {
      if (ok) gate.classList.add('is-instant');
      else input.focus();
    });
  } else {
    input.focus();
  }
}
