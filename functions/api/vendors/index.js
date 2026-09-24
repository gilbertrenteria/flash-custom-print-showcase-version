import { json, newId } from '../../_lib/auth.js';

function row(r) {
  return { id: r.id, name: r.name, specialty: r.specialty, contact: r.contact, notes: r.notes, createdAt: r.created_at };
}

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare('SELECT * FROM vendors ORDER BY created_at DESC').all();
  return json(results.map(row));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  if (!body.name) return json({ error: 'missing_fields' }, { status: 400 });
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO vendors (id, name, specialty, contact, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, body.name, body.specialty || null, body.contact || null, body.notes || null, now).run();
  return json({ id: id });
}
