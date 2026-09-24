// Dashboard-only (auth-gated by _middleware.js): delete a chat conversation
// and all its messages -- for clearing out AI-only chats nobody ever needed
// to act on.
import { json } from '../../../../_lib/auth.js';

export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = params.id;
  await env.DB.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM chat_sessions WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}
