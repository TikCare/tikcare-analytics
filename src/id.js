// Identifier minting. UUIDv7 (time-prefixed) per plan §5.2 — crypto.randomUUID()
// is v4 and hurts B-tree locality on the append-only events table.

function formatUuid(b) {
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  // 48-bit ms timestamp via number math (Date.now() < 2^53; bitwise ops would
  // truncate to 32 bits, and BigInt trips this repo's ES2019 eslint env)
  const ts = Date.now();
  b[0] = Math.floor(ts / 2 ** 40) % 256;
  b[1] = Math.floor(ts / 2 ** 32) % 256;
  b[2] = Math.floor(ts / 2 ** 24) % 256;
  b[3] = Math.floor(ts / 2 ** 16) % 256;
  b[4] = Math.floor(ts / 2 ** 8) % 256;
  b[5] = ts % 256;
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  return formatUuid(b);
}

const ANON_KEY = 'tc_anon_id';
const SESSION_KEY = 'tc_session_id';
const SESSION_TS_KEY = 'tc_session_ts';
const SESSION_IDLE_MS = 30 * 60 * 1000;

export function getAnonymousId() {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// True when the anonymous_id already existed before this init — retention input.
export function isReturning() {
  try {
    return localStorage.getItem(ANON_KEY) !== null;
  } catch {
    return false;
  }
}

export function getSessionId() {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(SESSION_TS_KEY) || 0);
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id || now - last > SESSION_IDLE_MS) {
      id = newId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
    return id;
  } catch {
    return null;
  }
}
