// Dashboard-only (auth-gated by _middleware.js): traffic, conversion, and
// source numbers for the Overview tab's Site Traffic section. Built from
// visits_log (one row per unique visitor session's first-ever ping) and
// quotes (one row per submitted quote).
import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const DAYS = 14;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date(startOfDay.getTime() - (DAYS - 1) * 86400000).toISOString();
  const since30d = new Date(startOfDay.getTime() - 29 * 86400000).toISOString();

  const [dailyRows, visits30dRow, quotes30dRow, sourceRows] = await Promise.all([
    env.DB.prepare(
      `SELECT substr(created_at,1,10) AS day, COUNT(*) AS count
       FROM visits_log WHERE created_at >= ? GROUP BY day ORDER BY day`
    ).bind(dayStart).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM visits_log WHERE created_at >= ?`
    ).bind(since30d).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM quotes WHERE created_at >= ?`
    ).bind(since30d).first(),
    env.DB.prepare(
      `SELECT COALESCE(NULLIF(source,''),'Direct') AS source, COUNT(*) AS count
       FROM visits_log WHERE created_at >= ? GROUP BY source ORDER BY count DESC LIMIT 6`
    ).bind(since30d).all(),
  ]);

  const todayKey = startOfDay.toISOString().slice(0, 10);
  const dailyMap = {};
  (dailyRows.results || []).forEach(function (r) { dailyMap[r.day] = r.count; });
  const daily = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(startOfDay.getTime() - (DAYS - 1 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, count: dailyMap[key] || 0 });
  }
  const visitsToday = dailyMap[todayKey] || 0;
  const visits7d = daily.slice(-7).reduce(function (s, d) { return s + d.count; }, 0);
  const visits30d = (visits30dRow && visits30dRow.count) || 0;
  const quotes30d = (quotes30dRow && quotes30dRow.count) || 0;
  const conversionRate30d = visits30d > 0 ? (quotes30d / visits30d) * 100 : 0;

  return json({
    dailyVisits: daily,
    visitsToday: visitsToday,
    visits7d: visits7d,
    visits30d: visits30d,
    quotes30d: quotes30d,
    conversionRate30d: conversionRate30d,
    topSources: (sourceRows.results || []).map(function (r) { return { source: r.source, count: r.count }; }),
  });
}
