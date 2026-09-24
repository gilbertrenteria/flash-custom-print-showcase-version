// Shared auth helpers for Cloudflare Pages Functions.
// A single shared password (the ADMIN_KEY secret) protects the dashboard.
// On successful login we hand back a signed, httpOnly cookie -- signed with
// HMAC-SHA256 using ADMIN_KEY as the secret, so nothing needs a database
// row and the signature can't be forged without knowing ADMIN_KEY.

const COOKIE_NAME = 'flash_session';
const SESSION_DAYS = 30;

async function hmac(value, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function makeSessionCookie(secret) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = String(exp);
  const sig = await hmac(payload, secret);
  const value = `${payload}.${sig}`;
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';').map(function (p) { return p.trim(); });
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    if (p.slice(0, idx) === name) return decodeURIComponent(p.slice(idx + 1));
  }
  return null;
}

export async function isAuthenticated(request, secret) {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot === -1) return false;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = await hmac(payload, secret);
  if (expected !== sig) return false;
  if (Number(payload) < Date.now()) return false;
  return true;
}

export function json(data, init) {
  init = init || {};
  const headers = Object.assign({ 'content-type': 'application/json' }, init.headers || {});
  return new Response(JSON.stringify(data), Object.assign({}, init, { headers: headers }));
}

export function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}
