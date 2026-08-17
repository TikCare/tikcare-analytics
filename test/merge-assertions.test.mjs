// PLAN-0815-analytics-dashboard §1.1 merge self-check: the two behavioral
// assertions the merged SDK must pass, proving the merge kept BOTH
// divergent features (MindVault's consent layer, Scribe's drop-count
// recovery) rather than losing one while taking the other.
//
// Zero test-framework dependency beyond Node's own built-ins (node:test,
// node:assert) — consistent with the package's zero-dependency, zero-build
// philosophy. Run with: node --test test/
//
// DOM/browser globals are stubbed minimally, just enough for init()'s
// configureQueue()/attachAutocapture() to not throw (they call
// window/document.addEventListener) and for transport.js's send()/beacon()
// to be interceptable instead of hitting a real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// queue.js's configureQueue() starts a real setInterval to periodically
// flush — correct behavior for a browser tab, but it would keep Node's
// event loop (and this test run) alive forever, since these tests call
// flush() explicitly and never need the periodic timer to fire. Stub
// setInterval to a no-op BEFORE importing the module under test.
globalThis.setInterval = () => 0;

// id.js reads localStorage (anonymous_id) and sessionStorage (session_id) —
// neither exists in plain Node. A trivial in-memory Storage-shape stub is
// enough; id.js only ever calls getItem/setItem.
function makeStorageStub() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}
globalThis.localStorage = makeStorageStub();
globalThis.sessionStorage = makeStorageStub();

globalThis.window = { addEventListener() {} };
globalThis.document = {
  addEventListener() {},
  visibilityState: 'visible',
};
// Node 21+ ships its own read-only `navigator` global — plain assignment
// throws. Redefine it so beacon() sees a controllable stub.
Object.defineProperty(globalThis, 'navigator', {
  value: { sendBeacon() { return false; } },
  configurable: true,
  writable: true,
});

// Captures every POST body transport.send() would have made, keyed by call
// order, and lets a test control whether a given call succeeds or fails —
// this is what lets test (b) simulate "the batch permanently failed".
let fetchQueue = [];
let sentBodies = [];
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sentBodies.push(body);
  const outcome = fetchQueue.shift() ?? 'ok';
  if (outcome === 'fail') return { ok: false, status: 500 };
  return { ok: true, status: 200 };
};

const { init, track, flush } = await import('../src/index.js');

test('(a) an event sent after consent is declined carries no user_id/anonymous_id', async () => {
  sentBodies = [];
  fetchQueue = [];
  init({
    url: 'https://example.test/ingest',
    ingestKey: 'test-key',
    environment: 'test',
    getIdentity: () => ({ userId: '11111111-1111-1111-1111-111111111111' }),
    getIdentityConsent: () => false, // explicit refusal
    getPagePath: () => '/talk',
    enabled: () => true,
  });

  track('chat_message_sent', { turn_index: 1 });
  await flush();

  assert.equal(sentBodies.length, 1, 'expected exactly one flushed batch');
  const [event] = sentBodies[0].events;
  assert.equal(event.user_id, null,
    'user_id must be stripped when identity consent is refused');
  assert.equal(event.anonymous_id, undefined,
    'anonymous_id must be stripped too — refusal strips everything durable, ' +
    'per the mock_id policy (only session_id may survive)');
  assert.ok(event.session_id, 'session_id must still be present (in-session only)');
});

test('(b) a permanently-failed batch\'s drop count rides the next successful batch', async () => {
  sentBodies = [];

  // First flush: both the initial send and the one retry fail => permanent
  // failure => settleBatch(batch, false) => droppedSinceLast absorbs it.
  fetchQueue = ['fail', 'fail'];
  init({
    url: 'https://example.test/ingest',
    ingestKey: 'test-key',
    environment: 'test',
    getIdentity: () => ({}),
    getIdentityConsent: () => false,
    getPagePath: () => '/talk',
    enabled: () => true,
  });
  track('chat_message_sent', { turn_index: 1 });
  await flush();
  assert.equal(sentBodies.length, 2, 'expected the initial send + one retry');

  // Second flush: succeeds outright. Its event must carry the drop count
  // claimed from the batch that never landed.
  fetchQueue = ['ok'];
  track('chat_message_sent', { turn_index: 2 });
  await flush();
  assert.equal(sentBodies.length, 3);

  const [recoveredEvent] = sentBodies[2].events;
  assert.equal(recoveredEvent.properties.dropped_since_last, 1,
    'the permanently-dropped event from batch 1 must surface as ' +
    'dropped_since_last on the next successfully-delivered event, not ' +
    'silently vanish (Scribe\'s claimDropCount/settleBatch mechanism — ' +
    'MindVault\'s takeDropCount() loses this when the carrying batch ' +
    'itself is the one that drops)');
});
