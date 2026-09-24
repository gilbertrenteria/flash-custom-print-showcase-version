// Dashboard-only (auth-gated by _middleware.js): recent chat conversations,
// newest activity first. ?days=1|3|7|15|30 controls the lookback window
// (defaults to 1 day if missing or not one of those values).
// ?division=apparel|signs narrows to one division's pages.
// ?q=<text> searches the full chat history (message text) across ALL time,
// ignoring the days window, so nothing old gets missed.
import { json } from '../../../_lib/auth.js';

const ALLOWED_DAYS = [1, 3, 7, 15, 30];

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let days = parseInt(url.searchParams.get('days'), 10);
  if (!ALLOWED_DAYS.includes(days)) days = 1;
  const division = url.searchParams.get('division');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);

  const binds = [];
  let where = '1=1';

  if (q) {
    where += ` AND s.id IN (SELECT session_id FROM chat_messages WHERE text LIKE ?)`;
    binds.push('%' + q + '%');
  } else {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    where += ` AND s.last_message_at >= ?`;
    binds.push(cutoff);
  }
  if (division === 'apparel' || division === 'signs') {
    where += ` AND s.last_page LIKE ?`;
    binds.push(division + '%');
  }

  const { results } = await env.DB.prepare(
    `SELECT s.id, s.mode, s.last_page, s.started_at, s.last_message_at, s.unread_count, s.resolution, s.quote_submitted,
       (SELECT text FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_text,
       (SELECT role FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC LIMIT 1) as last_role,
       (SELECT COUNT(1) FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'agent') as agent_msg_count
     FROM chat_sessions s
     WHERE ${where}
     ORDER BY s.last_message_at DESC
     LIMIT 100`
  ).bind(...binds).all();

  return json({
    days: days,
    sessions: results.map(function (r) {
      return {
        id: r.id,
        mode: r.mode,
        lastPage: r.last_page,
        startedAt: r.started_at,
        lastMessageAt: r.last_message_at,
        unreadCount: r.unread_count,
        lastText: r.last_text,
        lastRole: r.last_role,
        // true once a Flash team member has actually replied in this
        // conversation at least once -- lets the dashboard flag "no action"
        // chats (AI-only, nobody needed to jump in) as safe to clear out.
        hadHumanReply: (r.agent_msg_count || 0) > 0,
        // true once the AI auto-submitted a quote for this conversation.
        quoteSubmitted: !!r.quote_submitted,
        // 'pending' | 'resolved' | 'unresolved' -- whether the visitor
        // confirmed the AI's answer actually helped.
        resolution: r.resolution || 'pending',
      };
    }),
  });
}
