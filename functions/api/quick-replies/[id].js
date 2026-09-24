import { json } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const { request, env, params } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  const sets = [];
  const binds = [];
  if (typeof body.text === 'string') {
    const text = body.text.trim().slice(0, 500);
    if (!text) return json({ error: 'missing_fields' }, { status: 400 });
    sets.push('text = ?');
    binds.push(text);
  }
  if (typeof body.sortOrder === 'number') {
    sets.push('sort_order = ?');
    binds.push(body.sortOrder);
  }
  if (!sets.length) return json({ error: 'missing_fields' }, { status: 400 });
  binds.push(params.id);
  await env.DB.prepare(`UPDATE quick_replies SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  await env.DB.prepare('DELETE FROM quick_replies WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
