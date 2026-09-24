import { makeSessionCookie, json } from '../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ADMIN_KEY) {
    return json({ error: 'server_not_configured' }, { status: 500 });
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  const password = (body && body.password) || '';
  if (password !== env.ADMIN_KEY) {
    return json({ error: 'invalid_password' }, { status: 401 });
  }
  const cookie = await makeSessionCookie(env.ADMIN_KEY);
  return json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
}
