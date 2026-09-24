// Dashboard-only (auth-gated by _middleware.js): Gilbert types a reply here.
// Sending one automatically takes the conversation away from the AI (mode
// flips to 'human') -- that's the "jump in at any point" behavior.
import { json, newId } from '../../../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const id = params.id;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }

  const text = (body.text || '').trim().slice(0, 2000);
  if (!text) return json({ error: 'missing_fields' }, { status: 400 });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, session_id, role, text, created_at) VALUES (?, ?, 'agent', ?, ?)`
  ).bind(newId(), id, text, now).run();
  await env.DB.prepare(
    `UPDATE chat_sessions SET mode = 'human', last_message_at = ?, unread_count = 0 WHERE id = ?`
  ).bind(now, id).run();

  return json({ ok: true });
}
