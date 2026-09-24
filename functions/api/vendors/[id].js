import { json } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const { request, env, params } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  await env.DB.prepare(
    `UPDATE vendors SET name=?, specialty=?, contact=?, notes=? WHERE id=?`
  ).bind(body.name, body.specialty || null, body.contact || null, body.notes || null, params.id).run();
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  await env.DB.prepare('DELETE FROM vendors WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
