// Dashboard-only (auth-gated by _middleware.js): full thread for one chat
// session. Reading it also clears that session's unread badge.
import { json } from '../../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = params.id;

  const { results } = await env.DB.prepare(
    `SELECT id, role, text, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500`
  ).bind(id).all();
  await env.DB.prepare(`UPDATE chat_sessions SET unread_count = 0 WHERE id = ?`).bind(id).run();

  return json({
    messages: results.map(function (m) {
      return { id: m.id, role: m.role, text: m.text, createdAt: m.created_at };
    }),
  });
}
