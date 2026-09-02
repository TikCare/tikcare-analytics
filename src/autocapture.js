// Click autocapture + element exposure: delegated listeners on document.
// capture:true — React handlers calling stopPropagation() still get captured.
// closest() — markers can sit on containers; svg/span click targets resolve up.
//
// Two modes for clicks:
//   default        — opt-in: no data-track-id attribute → no event.
//   allClickables  — every button/link/[role=button]/submit/summary reports,
//                    element_id falling back to id/data-testid/name, else an
//                    'auto:' DOM path (see autoElementId).
//
// HARD RULE either way: never read element TEXT or aria-label — in health
// apps both routinely contain PHI (reminder names, symptoms, medication).
// Auto ids come only from developer-authored attributes or DOM structure.

const CLICKABLE_SELECTOR =
  '[data-track-id], button, a[href], [role="button"], input[type="button"], input[type="submit"], summary';

export function readTrackProps(el) {
  const props = {};
  for (const attr of el.attributes) {
    if (
      attr.name.startsWith('data-track-') &&
      attr.name !== 'data-track-id' &&
      attr.name !== 'data-track-view'
    ) {
      // data-track-provider-id → provider_id: property keys must match the
      // ingest whitelist, which uses snake_case.
      props[attr.name.slice('data-track-'.length).replace(/-/g, '_')] = attr.value;
    }
  }
  return props;
}

// Structural path fallback, e.g. main>section:nth-of-type(2)>button.
// Deliberately attribute/text-free. UNSTABLE across UI refactors — anything
// worth tracking long-term should still get an explicit data-track-id; the
// 'auto:' prefix exists so dashboards can tell the two apart.
export function domPath(el) {
  const parts = [];
  let node = el;
  for (let depth = 0; node && node.tagName && depth < 8; depth++) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    let idx = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) idx++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(idx > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    node = node.parentElement;
  }
  return parts.join('>');
}

// Priority: explicit marker → stable developer-authored attributes → DOM path.
// Ingest hard-caps element_id at 128 chars; slice client-side to match.
export function autoElementId(el) {
  return (
    el.getAttribute('data-track-id') ||
    el.id ||
    el.getAttribute('data-testid') ||
    el.getAttribute('name') ||
    ('auto:' + domPath(el)).slice(0, 128)
  );
}

export function attachAutocapture(track, opts = {}) {
  const selector = opts.allClickables ? CLICKABLE_SELECTOR : '[data-track-id]';
  document.addEventListener(
    'click',
    (e) => {
      try {
        const target = e.target;
        const el = target && target.closest ? target.closest(selector) : null;
        if (!el) return;
        // An explicitly-marked ancestor wins over an anonymous clickable, so
        // a data-track-id placed on a container keeps working in allClickables
        // mode exactly as it does in default mode.
        const marked =
          el.hasAttribute('data-track-id') ? el : el.closest('[data-track-id]') || el;
        track('element_clicked', readTrackProps(marked), {
          element_id: autoElementId(marked),
        });
      } catch {
        /* analytics must never break the app */
      }
    },
    { capture: true, passive: true },
  );
}

// Exposure capture: element_viewed, fired once per mounted element after it
// has been ≥50% visible for dwellMs continuously. Two modes:
//   default      — opt-in: only [data-track-view] elements are observed.
//   all          — every clickable (same selector as click autocapture) is
//                  observed too; element_id falls back through autoElementId,
//                  so unmarked buttons report 'auto:' DOM paths. Exposure
//                  volume dwarfs clicks — expect roughly (buttons per page ×
//                  page views) events; keep an eye on ingest cost.
// A data-track-view attribute always wins as the element_id, so key sections
// keep a stable, human-readable name in either mode.
// SPA route changes need no reset hook: React remounts the page's elements as
// new nodes, so revisiting a page re-fires naturally, while persistent chrome
// (nav bars) fires once.
export function attachExposure(track, opts = {}) {
  if (
    typeof IntersectionObserver === 'undefined' ||
    typeof MutationObserver === 'undefined'
  ) {
    return; // old WebView etc. — exposure is best-effort, never a crash
  }
  const dwellMs = opts.dwellMs ?? 1000;
  const selector = opts.all
    ? `[data-track-view], ${CLICKABLE_SELECTOR}`
    : '[data-track-view]';
  const seen = new WeakSet();
  const timers = new WeakMap();

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        try {
          const el = entry.target;
          if (seen.has(el)) {
            io.unobserve(el);
            continue;
          }
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (!timers.has(el)) {
              timers.set(
                el,
                setTimeout(() => {
                  seen.add(el);
                  timers.delete(el);
                  io.unobserve(el);
                  track('element_viewed', readTrackProps(el), {
                    element_id: el.getAttribute('data-track-view') || autoElementId(el),
                  });
                }, dwellMs),
              );
            }
          } else {
            const t = timers.get(el);
            if (t !== undefined) {
              clearTimeout(t);
              timers.delete(el);
            }
          }
        } catch {
          /* analytics must never break the app */
        }
      }
    },
    { threshold: [0.5] },
  );

  const scan = (root) => {
    try {
      if (root.matches && root.matches(selector) && !seen.has(root)) {
        io.observe(root);
      }
      if (root.querySelectorAll) {
        for (const el of root.querySelectorAll(selector)) {
          if (!seen.has(el)) io.observe(el);
        }
      }
    } catch {
      /* ignore detached/exotic nodes */
    }
  };

  const start = () => {
    try {
      scan(document.body);
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) scan(n);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch {
      /* analytics must never break the app */
    }
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
