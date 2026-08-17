// In-memory queue: flush at 20 events or every 10 s. One retry per batch,
// then drop and count — the drop counter rides out on the next batch as
// properties.dropped_since_last (v2 fix: no silent data loss).
// event_id is minted BEFORE events reach here (at track() time) and is never
// regenerated, so retries and beacons dedupe server-side.
import { send, beacon } from './transport.js';

const FLUSH_AT = 20;
const FLUSH_MS = 10 * 1000;

let queue = [];
let droppedSinceLast = 0;
// event_id → drop count that event carries as dropped_since_last. The counter
// is only truly cleared once the carrying batch gets a confirmed 2xx; on
// permanent failure the claimed count is re-added so it rides the next batch.
let pendingClaims = new Map();
let timer = null;
let cfg = null;
let exitHooked = false;

export function configureQueue(config) {
  cfg = config;
  if (!timer) timer = setInterval(() => { void flushQueue(); }, FLUSH_MS);
  if (!exitHooked) {
    exitHooked = true;
    const onExit = () => { drain(); };
    window.addEventListener('pagehide', onExit);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onExit();
    });
  }
}

export function claimDropCount(eventId) {
  const n = droppedSinceLast;
  droppedSinceLast = 0;
  if (n > 0) pendingClaims.set(eventId, n);
  return n;
}

// Resolve a batch's claimed drop counts: forget them on delivery, restore them
// (plus the batch itself) to the counter on permanent failure.
function settleBatch(batch, delivered) {
  let restored = 0;
  for (const ev of batch) {
    const claimed = pendingClaims.get(ev.event_id);
    if (claimed) {
      pendingClaims.delete(ev.event_id);
      if (!delivered) restored += claimed;
    }
  }
  if (!delivered) droppedSinceLast += restored + batch.length;
}

export function enqueue(event) {
  queue.push(event);
  if (queue.length >= FLUSH_AT) void flushQueue();
}

export async function flushQueue() {
  if (!cfg || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await send(cfg.url, cfg.ingestKey, batch);
    settleBatch(batch, true);
  } catch {
    try {
      await send(cfg.url, cfg.ingestKey, batch); // one retry, same event_ids
      settleBatch(batch, true);
    } catch {
      settleBatch(batch, false);
    }
  }
}

function drain() {
  if (!cfg || queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (beacon(cfg.url, cfg.ingestKey, batch)) {
    settleBatch(batch, true); // beacon accepted — best signal we get on exit
  } else {
    // beacon unavailable/refused — best-effort keepalive fetch, fire and forget
    send(cfg.url, cfg.ingestKey, batch)
      .then(() => { settleBatch(batch, true); })
      .catch(() => { settleBatch(batch, false); });
  }
}
