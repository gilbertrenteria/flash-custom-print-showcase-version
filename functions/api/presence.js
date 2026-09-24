// Public: the site pings this every ~20s per visitor (see the presence IIFE
// in public/index.html) so the dashboard's Live tab can show who's on the
// site right now and which page they're on.
//
// It also does two more things, but only on a visitor's very FIRST ping of
// this browser session (never on the repeat 20s heartbeats, so this never
// turns into a text every 20 seconds while someone browses), and only when
// the visitor doesn't look like a bot/crawler:
//   1. logs a row to visits_log (source/landing page) for the dashboard's
//      traffic + conversion charts.
//   2. sends Gilbert a one-time text that someone new is on the site.
import { json } from '../_lib/auth.js';
import { notifySms } from '../_lib/notify.js';

// Known crawler/bot/link-preview user agents, plus common scripting/HTTP
// client signatures. Deliberately conservative (misses some obscure bots)
// rather than risking a false positive on a real visitor's browser.
const BOT_UA_PATTERN = /bot|crawl|spider|slurp|crawler|facebookexternalhit|preview|headless|phantom|curl|wget|python-requests|scrapy|axios|okhttp|go-http-client|ahrefs|semrush|mj12bot|dotbot|petalbot|bingpreview|whatsapp|telegrambot|discordbot|slackbot|pingdom|uptimerobot|monitor/i;

function isLikelyBot(userAgent) {
  // No UA at all is unusual for a real browser and common for scripts --
  // treat it the same as a recognized bot signature.
  if (!userAgent) return true;
  return BOT_UA_PATTERN.test(userAgent);
}

const KNOWN_UTM_SOURCES = {
  instagram: 'Instagram', ig: 'Instagram',
  facebook: 'Facebook', fb: 'Facebook',
  whatsapp: 'WhatsApp',
  flyer: 'Flyer', card: 'Business Card', qr: 'QR Code', email: 'Email',
  text: 'Text/SMS', nextdoor: 'Nextdoor', yelp: 'Yelp', chamber: 'Chamber Event',
  google: 'Google',
};

function deriveSource(referrer, utmSource) {
  if (utmSource) {
    const key = utmSource.toLowerCase();
    if (KNOWN_UTM_SOURCES[key]) return KNOWN_UTM_SOURCES[key];
    return utmSource.slice(0, 40);
  }
  if (!referrer) return 'Direct';
  try {
    var host = new URL(referrer).hostname.replace(/^www\./, '');
    if (host.indexOf('instagram') !== -1) return 'Instagram';
    if (host.indexOf('facebook') !== -1 || host.indexOf('fb.com') !== -1) return 'Facebook';
    if (host.indexOf('google') !== -1) return 'Google';
    if (host.indexOf('bing') !== -1) return 'Bing';
    if (host.indexOf('yelp') !== -1) return 'Yelp';
    if (host.indexOf('nextdoor') !== -1) return 'Nextdoor';
    if (host.indexOf('yahoo') !== -1) return 'Yahoo';
    return host;
  } catch (e) {
    return 'Direct';
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }

  const sessionId = (body.sessionId || '').trim();
  const page = (body.page || '/').trim().slice(0, 200);
  const referrer = (body.referrer || '').trim().slice(0, 300);
  const utmSource = (body.utmSource || '').trim().slice(0, 60);
  if (!sessionId) return json({ error: 'missing_fields' }, { status: 400 });

  // Bots/crawlers never touch the visitors table, visits_log, the Live tab,
  // or the text alert -- they're simply ignored, as if the ping never came in.
  const userAgent = request.headers.get('User-Agent') || '';
  if (isLikelyBot(userAgent)) {
    return json({ ok: true });
  }

  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT session_id FROM visitors WHERE session_id = ?`
  ).bind(sessionId).first();

  await env.DB.prepare(
    `INSERT INTO visitors (session_id, page, first_seen, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET page = excluded.page, last_seen = excluded.last_seen`
  ).bind(sessionId, page, now, now).run();

  if (!existing) {
    const source = deriveSource(referrer, utmSource);
    context.waitUntil(
      env.DB.prepare(
        `INSERT INTO visits_log (id, session_id, landing_page, referrer, source, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind('v_' + sessionId, sessionId, page, referrer, source, now).run().catch(function () {})
    );
    context.waitUntil(notifySms(
      env,
      'Flash: someone new just landed on your site (' + page + (source && source !== 'Direct' ? ', via ' + source : '') + ').'
    ));
  }

  return json({ ok: true });
}
