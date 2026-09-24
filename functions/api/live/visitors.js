// Dashboard-only (auth-gated by _middleware.js): who's on the site right now.
// ?division=apparel|signs optionally narrows to one division's pages.
import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const division = url.searchParams.get('division');
  const cutoff = new Date(Date.now() - 60000).toISOString(); // active in the last 60s

  let query = `SELECT session_id, page, first_seen, last_seen FROM visitors WHERE last_seen >= ?`;
  const binds = [cutoff];
  if (division === 'apparel' || division === 'signs') {
    query += ` AND page LIKE ?`;
    binds.push(division + '%');
  }
  query += ` ORDER BY last_seen DESC`;

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  return json({
    visitors: results.map(function (r) {
      return { sessionId: r.session_id, page: r.page, firstSeen: r.first_seen, lastSeen: r.last_seen };
    }),
  });
}
