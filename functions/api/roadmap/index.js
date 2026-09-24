import { json, newId } from '../../_lib/auth.js';

function row(r) {
  return { id: r.id, title: r.title, category: r.category, status: r.status, notes: r.notes, createdAt: r.created_at };
}

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare('SELECT * FROM roadmap_items ORDER BY created_at ASC').all();
  return json(results.map(row));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  if (!body.title) return json({ error: 'missing_fields' }, { status: 400 });
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO roadmap_items (id, title, category, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, body.title, body.category || null, body.status || 'idea', body.notes || null, now).run();
  return json({ id: id });
}
