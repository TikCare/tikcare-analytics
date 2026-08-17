// Transport: fetch(keepalive) normally; sendBeacon on page exit.
// Beacons can't set headers, so the ingest key goes in the body as text/plain
// (also makes it a CORS simple request — no preflight).

export async function send(url, key, events) {
  const res = await fetch(url, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json', 'x-ingest-key': key },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}`);
}

export function beacon(url, key, events) {
  try {
    if (!navigator.sendBeacon) return false;
    const blob = new Blob([JSON.stringify({ ingest_key: key, events })], { type: 'text/plain' });
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
}
