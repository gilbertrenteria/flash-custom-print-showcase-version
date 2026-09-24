// Dashboard-only (auth-gated by _middleware.js): canned responses Gilbert
// manages himself (add/edit/reorder) and uses as one-tap chips when replying
// to a live chat. Managed from Settings, and usable right from the Live tab.
import { json, newId } from '../../_lib/auth.js';

function row(r) {
  return { id: r.id, text: r.text, sortOrder: r.sort_order, createdAt: r.created_at };
}

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare('SELECT * FROM quick_replies ORDER BY sort_order ASC, created_at ASC').all();
  return json(results.map(row));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  const text = (body.text || '').trim().slice(0, 500);
  if (!text) return json({ error: 'missing_fields' }, { status: 400 });
  const { results: maxRows } = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM quick_replies').all();
  const nextOrder = (maxRows[0] ? maxRows[0].m : -1) + 1;
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO quick_replies (id, text, sort_order, created_at) VALUES (?, ?, ?, ?)`
  ).bind(id, text, nextOrder, now).run();
  return json({ id: id });
}
