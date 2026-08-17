// Static page/device context, collected once per event assembly.
// No PHI: no page_title, no element_text, referrer/paths query-stripped.

function stripQuery(url) {
  if (!url) return null;
  return url.split(/[?#]/)[0];
}

export function collectContext() {
  const ctx = {};
  try {
    ctx.user_agent = navigator.userAgent ? navigator.userAgent.slice(0, 1024) : null;
    ctx.locale = navigator.language || null;
    ctx.screen_width = window.screen ? window.screen.width : null;
    ctx.screen_height = window.screen ? window.screen.height : null;
    ctx.referrer = stripQuery(document.referrer) || null;
  } catch {
    /* analytics must never break the app */
  }
  return ctx;
}

export function collectUtm() {
  const utm = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = params.get(key);
      if (v) utm[key] = v.slice(0, 256);
    }
  } catch {
    /* noop */
  }
  return utm;
}
