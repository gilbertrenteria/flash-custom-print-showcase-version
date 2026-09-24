// Dashboard-only (auth-gated by _middleware.js): hand a conversation back to
// the AI after Gilbert is done chatting with that visitor.
import { json } from '../../../../_lib/auth.js';

export async function onRequestPost(context) {
  const { env, params } = context;
  await env.DB.prepare(`UPDATE chat_sessions SET mode = 'ai' WHERE id = ?`).bind(params.id).run();
  return json({ ok: true });
}
