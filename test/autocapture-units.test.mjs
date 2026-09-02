// Unit tests for autocapture's pure helpers (v1.5.0: allClickables +
// exposure). These run against hand-rolled element stubs — no DOM library,
// consistent with the package's zero-dependency philosophy. The delegated
// listener + IntersectionObserver wiring is exercised in a real browser via
// the consuming app (HealthSeer dev) rather than simulated here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readTrackProps, domPath, autoElementId } from '../src/autocapture.js';

// Minimal element stub: enough surface for the three helpers.
// attrs — plain object; children get parentElement/previousElementSibling
// wired by appendTo().
function makeEl(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    id: attrs.id ?? '',
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    parentElement: null,
    previousElementSibling: null,
    getAttribute(name) {
      const a = this.attributes.find((x) => x.name === name);
      return a ? a.value : null;
    },
    hasAttribute(name) {
      return this.attributes.some((x) => x.name === name);
    },
  };
  return el;
}

function appendTo(parent, ...children) {
  let prev = null;
  for (const c of children) {
    c.parentElement = parent;
    c.previousElementSibling = prev;
    prev = c;
  }
  return parent;
}

test('readTrackProps converts data-track-* to snake_case and skips both marker attributes', () => {
  const el = makeEl('button', {
    'data-track-id': 'home_scan_cta',
    'data-track-view': 'home_scan_section',
    'data-track-provider-id': 'p1',
    'data-track-tab': 'vitals',
    class: 'btn',
  });
  assert.deepEqual(readTrackProps(el), { provider_id: 'p1', tab: 'vitals' });
});

test('domPath walks up to body with nth-of-type only where needed', () => {
  const body = makeEl('body');
  const main = makeEl('main');
  const s1 = makeEl('section');
  const s2 = makeEl('section');
  const btn = makeEl('button');
  appendTo(body, main);
  appendTo(main, s1, s2);
  appendTo(s2, btn);
  assert.equal(domPath(btn), 'main>section:nth-of-type(2)>button');
});

test('autoElementId precedence: data-track-id > id > data-testid > name > auto: path', () => {
  const withAll = makeEl('button', {
    'data-track-id': 'explicit',
    id: 'dom-id',
    'data-testid': 'test-id',
    name: 'the-name',
  });
  assert.equal(autoElementId(withAll), 'explicit');

  const withId = makeEl('button', { id: 'dom-id', 'data-testid': 'test-id' });
  assert.equal(autoElementId(withId), 'dom-id');

  const withTestId = makeEl('button', { 'data-testid': 'test-id', name: 'the-name' });
  assert.equal(autoElementId(withTestId), 'test-id');

  const withName = makeEl('input', { name: 'the-name' });
  assert.equal(autoElementId(withName), 'the-name');

  const bare = makeEl('button');
  appendTo(makeEl('body'), bare); // parent chain ends at body
  assert.equal(autoElementId(bare), 'auto:button');
});

test('autoElementId auto: fallback is capped at the ingest element_id limit (128)', () => {
  // Build a deep chain: domPath caps at 8 levels, but verify the slice too.
  let node = makeEl('div');
  const leaf = makeEl('button');
  let cur = node;
  for (let i = 0; i < 10; i++) {
    const child = makeEl('div');
    appendTo(cur, child);
    cur = child;
  }
  appendTo(cur, leaf);
  const id = autoElementId(leaf);
  assert.ok(id.startsWith('auto:'));
  assert.ok(id.length <= 128, `element_id must fit ingest's 128-char cap, got ${id.length}`);
});
