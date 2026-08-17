// Opt-in click autocapture: one delegated listener on document.
// capture:true — React handlers calling stopPropagation() still get captured.
// closest() — markers can sit on containers; svg/span click targets resolve up.
// No data-track-id attribute → no event. Never reads button text (PHI).

function readTrackProps(el) {
  const props = {};
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-track-') && attr.name !== 'data-track-id') {
      // data-track-provider-id → provider_id: property keys must match the
      // ingest whitelist, which uses snake_case.
      props[attr.name.slice('data-track-'.length).replace(/-/g, '_')] = attr.value;
    }
  }
  return props;
}

export function attachAutocapture(track) {
  document.addEventListener(
    'click',
    (e) => {
      try {
        const target = e.target;
        const el = target && target.closest ? target.closest('[data-track-id]') : null;
        if (!el) return;
        track('element_clicked', readTrackProps(el), {
          element_id: el.getAttribute('data-track-id'),
        });
      } catch {
        /* analytics must never break the app */
      }
    },
    { capture: true, passive: true },
  );
}
