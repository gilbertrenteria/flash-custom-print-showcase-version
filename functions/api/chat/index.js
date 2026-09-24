// Public endpoint the site's chat widget calls. Every visitor gets a
// sessionId (generated client-side, in sessionStorage) and every message --
// visitor, AI, or a Flash team member typing from the dashboard -- is
// persisted to D1 under that session. That's what makes it possible for a
// human to take over a conversation at any point: while a session is in
// "human" mode this endpoint stops calling the AI entirely, and the widget
// picks up the human's replies by polling GET /api/chat/[sessionId].
//
// The AI also runs the whole answer -> confirm -> quote flow itself: it
// asks a natural "did that help?" check when it feels right, and once it
// has a name, a way to reach the visitor, which division, and what they
// need, it hands back a hidden tag that this endpoint turns into a real
// quote (and matching order) -- same tables, same notifications as the
// on-site quote form, just tagged source:'chat'.
import { json, newId } from '../../_lib/auth.js';
import { notifyEmail, notifySms, notifyCustomer } from '../../_lib/notify.js';

const MAX_ATTACHMENT_BASE64_CHARS = 11 * 1024 * 1024;

// If a Flash team member takes over a chat and then goes quiet, hand it
// back to the AI after this long so the visitor is never left waiting.
const STALE_HUMAN_MS = 6 * 60 * 1000; // 6 minutes
// Only one "new chat" alert per visitor within this window, even if they
// open several chat sessions back to back.
const ALERT_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes

const SYSTEM_PROMPT_BASE = `You are FlashChat, the AI assistant on the Flash Custom Apparel / Flash Signs
website (Houston, TX). If you ever introduce yourself, say "I'm FlashChat" -- never "Flash assistant"
or any other name. Flash has two divisions: Custom Apparel (screen print, embroidery, DTF) and Custom
Signs (yard signs, banners, business cards). Signs order minimums: Yard Signs 10-sign minimum,
Business Cards 500-card minimum.

Never refer to any team member by name (not "Gilbert" or anyone else) -- always say "Flash", "our
team", or "we". Keep replies short (2-4 sentences unless you're listing a couple of quick questions).

How to run the conversation, in order:
1. Answer the visitor's question helpfully and briefly using the info you have. For anything about
   exact pricing, don't invent numbers -- that's what the quote is for.
2. After a real answer (not just a greeting), when it feels natural -- not after every single message,
   and never twice in a row -- check in once with something like "Did that answer what you needed?"
   Keep it light. Don't repeat this check once you've already asked it for the current topic.
3. When the visitor seems satisfied, is clearly ready to move forward, or a note below tells you they
   clicked "Request a Quote" -- smoothly start gathering what's needed for a quote: their name, the
   best way to reach them (email OR phone, either is fine, never insist on both), which division this
   is for (Apparel or Signs), what they need, and whether there's a rush or deadline. Ask for these
   naturally, a couple at a time, never as a rigid form, and never force it if they just want to keep
   asking questions.
4. Once you have a name, at least one contact method, the division, and a real description of what
   they need, end your reply with a short confirmation sentence (for example: "Got it -- I've sent
   this over to Flash, you'll hear back soon!") AND, as the very last line of your message, include
   this exact hidden tag with the collected info as compact JSON (the visitor never sees this literal
   text, so never mention it out loud or describe it):
<<QUOTE:{"name":"...","email":"...","phone":"...","division":"apparel or signs","details":"...","rush":true or false}>>
   Leave "email" or "phone" as an empty string "" if the visitor only gave you one of them. Set "rush"
   to true only if they said something is urgent/rushed/has a tight deadline, otherwise false. Only
   ever include this tag ONCE per conversation -- if a quote was already submitted (you'll be told
   below), never output it again even if they mention more details; just acknowledge the extra detail
   and say you'll pass it along.
5. Immediately after the visitor's message directly answers your "did that help?" check (and only
   then, not on other messages), add a hidden status tag as its own line at the end of your reply:
<<STATUS:resolved>>   if they confirmed it helped / they're satisfied
<<STATUS:unresolved>>  if they said it didn't help, they're still confused, or they ask for a person`;

const QUOTE_TAG_RE = /<<QUOTE:(\{[\s\S]*?\})>>/;
const STATUS_TAG_RE = /<<STATUS:(resolved|unresolved)>>/;

function stripTags(text) {
  return text.replace(QUOTE_TAG_RE, '').replace(STATUS_TAG_RE, '').trim();
}

async function getOrCreateSession(env, sessionId, page) {
  const now = new Date().toISOString();
  const ins = await env.DB.prepare(
    `INSERT INTO chat_sessions (id, mode, last_page, started_at, last_message_at, unread_count, resolution, quote_submitted)
     VALUES (?, 'ai', ?, ?, ?, 0, 'pending', 0)
     ON CONFLICT(id) DO NOTHING`
  ).bind(sessionId, page, now, now).run();
  const isNew = !!(ins && ins.meta && ins.meta.changes);
  const row = await env.DB.prepare(
    `SELECT mode, quote_submitted, resolution FROM chat_sessions WHERE id = ?`
  ).bind(sessionId).first();
  return {
    mode: row ? row.mode : 'ai',
    isNew: isNew,
    quoteSubmitted: !!(row && row.quote_submitted),
    resolution: row ? row.resolution : 'pending',
  };
}

// Auto-hand a stale "human" chat back to the AI if a Flash team member took
// over but hasn't replied in STALE_HUMAN_MS. Returns the effective mode to
// use for THIS request.
async function resolveEffectiveMode(env, sessionId, mode) {
  if (mode !== 'human') return mode;
  const lastAgent = await env.DB.prepare(
    `SELECT created_at FROM chat_messages WHERE session_id = ? AND role = 'agent' ORDER BY created_at DESC LIMIT 1`
  ).bind(sessionId).first();
  const lastAgentAt = lastAgent ? new Date(lastAgent.created_at).getTime() : 0;
  if (Date.now() - lastAgentAt > STALE_HUMAN_MS) {
    await env.DB.prepare(`UPDATE chat_sessions SET mode = 'ai' WHERE id = ?`).bind(sessionId).run();
    return 'ai';
  }
  return mode;
}

// At most one "new chat" alert per visitor within ALERT_THROTTLE_MS, even if
// they open several sessions in a row. Keyed on the same sessionId (that's
// the closest thing to a stable visitor identity we have client-side).
async function shouldAlertForNewChat(env, sessionId) {
  const key = sessionId;
  const now = Date.now();
  const row = await env.DB.prepare(`SELECT last_alert_at FROM chat_alert_throttle WHERE visitor_key = ?`).bind(key).first();
  if (row && row.last_alert_at && now - new Date(row.last_alert_at).getTime() < ALERT_THROTTLE_MS) {
    return false;
  }
  const nowIso = new Date(now).toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_alert_throttle (visitor_key, last_alert_at) VALUES (?, ?)
     ON CONFLICT(visitor_key) DO UPDATE SET last_alert_at = excluded.last_alert_at`
  ).bind(key, nowIso).run();
  return true;
}

function decideDivisionKey(division) {
  return division === 'signs' ? 'signs' : 'apparel';
}

// A photo/logo the visitor attached mid-conversation (paperclip button in
// the chat input) rides along automatically when the quote fires -- same
// "real email attachment" behavior as the on-site quote form, just sourced
// from chat_attachments instead of the form POST body.
async function takeChatAttachment(env, sessionId) {
  const row = await env.DB.prepare(
    `SELECT name, data FROM chat_attachments WHERE session_id = ?`
  ).bind(sessionId).first();
  if (!row || !row.name || !row.data) return undefined;
  return [{ filename: row.name, content: row.data }];
}

async function submitQuoteFromChat(context, sessionId, raw, lang) {
  const { env } = context;
  let q;
  try { q = JSON.parse(raw); } catch (e) { return false; }
  const name = (q && q.name ? String(q.name) : '').trim().slice(0, 200);
  const email = (q && q.email ? String(q.email) : '').trim().slice(0, 200);
  const phone = (q && q.phone ? String(q.phone) : '').trim().slice(0, 60);
  const details = (q && q.details ? String(q.details) : '').trim().slice(0, 4000);
  const division = decideDivisionKey(q && q.division);
  const rush = !!(q && q.rush);
  if (!name || (!email && !phone) || !details) return false; // not enough to act on

  const id = newId();
  const now = new Date().toISOString();
  const subjectLabel = (division === 'signs' ? 'Signs' : 'Apparel') + ' — via chat';

  await env.DB.prepare(
    `INSERT INTO quotes (id, name, email, phone, subject_label, breakdown, rush, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'chat', ?)`
  ).bind(id, name, email || null, phone || null, subjectLabel, details, rush ? 1 : 0, now).run();

  const orderId = 'from-quote-' + id;
  // Lands in "New Inquiry", not "Quoted" -- the AI gathered enough to send
  // this to the team, but nobody has actually priced it yet. It becomes
  // "Quoted" once a real dollar figure is entered on the dashboard.
  await env.DB.prepare(
    `INSERT INTO orders (id, customer, division, description, contact_email, contact_phone, notes, stage, is_example, from_quote_id, source, contact_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'New Inquiry', 0, ?, 'chat', ?, ?, ?)`
  ).bind(orderId, name, division, details, email || '', phone || '', rush ? 'RUSH REQUESTED' : '', id, 'Messaged FlashChat on the website.', now, now).run();

  await env.DB.prepare(`UPDATE chat_sessions SET quote_submitted = 1 WHERE id = ?`).bind(sessionId).run();

  const attachments = await takeChatAttachment(env, sessionId);

  context.waitUntil(notifyEmail(
    env,
    'New Quote via Chat — ' + subjectLabel.replace(' — via chat', '') + ' — ' + name,
    details + (rush ? '\n\nRUSH REQUESTED' : '') + '\n\nContact: ' + (email || '(none given)') + (phone ? ' / ' + phone : ''),
    attachments
  ));
  context.waitUntil(notifySms(
    env,
    'Flash: new quote via chat from ' + name + '. Check the dashboard.'
  ));
  // Let the CUSTOMER know it went through too, not just the team.
  notifyCustomer(context, env, { name: name, email: email, phone: phone, lang: lang });
  return true;
}

async function flagUnresolved(context, sessionId, page) {
  const { env } = context;
  context.waitUntil(notifyEmail(
    env,
    'Visitor needs help in chat',
    'A visitor said the assistant\'s answer didn\'t help' + (page ? ' on ' + page : '') + '. Open the dashboard to jump in.'
  ));
  context.waitUntil(notifySms(
    env,
    'Flash: a site visitor needs help in chat -- the AI answer didn\'t resolve it. Open the dashboard.'
  ));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }

  const sessionId = (body.sessionId || '').trim();
  const message = (body.message || '').trim().slice(0, 2000);
  const page = (body.page || '').trim().slice(0, 200);
  const lang = body.lang === 'es' ? 'es' : 'en';
  const quoteShortcut = !!body.quoteShortcut;
  const attachmentName = (body.attachmentName || '').trim();
  const attachmentData = typeof body.attachmentData === 'string' ? body.attachmentData : '';
  if (!sessionId || !message) return json({ error: 'missing_fields' }, { status: 400 });

  const session = await getOrCreateSession(env, sessionId, page);
  const now = new Date().toISOString();

  // A photo/logo attached via the chat's paperclip button -- stash it
  // against this session so it's there to grab whenever the quote actually
  // fires (which message that happens on isn't known ahead of time).
  if (attachmentName && attachmentData && attachmentData.length <= MAX_ATTACHMENT_BASE64_CHARS) {
    await env.DB.prepare(
      `INSERT INTO chat_attachments (session_id, name, data, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET name = excluded.name, data = excluded.data, created_at = excluded.created_at`
    ).bind(sessionId, attachmentName, attachmentData, now).run();
  }

  await env.DB.prepare(
    `INSERT INTO chat_messages (id, session_id, role, text, created_at) VALUES (?, ?, 'visitor', ?, ?)`
  ).bind(newId(), sessionId, message, now).run();
  await env.DB.prepare(
    `UPDATE chat_sessions SET last_page = ?, last_message_at = ?, unread_count = unread_count + 1 WHERE id = ?`
  ).bind(page, now, sessionId).run();

  if (session.isNew) {
    // First message of a brand-new conversation -- ping the team so someone
    // can jump in live, same best-effort email/SMS pattern as new quotes.
    // Throttled per visitor so a burst of chats doesn't spam alerts.
    if (await shouldAlertForNewChat(env, sessionId)) {
      context.waitUntil(notifyEmail(
        env,
        'New live chat on your site',
        'A visitor started a chat' + (page ? ' on ' + page : '') + ':\n\n"' + message + '"\n\nOpen the dashboard to jump in.'
      ));
      context.waitUntil(notifySms(
        env,
        'Flash: new site chat started. "' + message.slice(0, 80) + '" -- open the dashboard to join.'
      ));
    }
  }

  const effectiveMode = await resolveEffectiveMode(env, sessionId, session.mode);

  if (effectiveMode === 'human') {
    // A real person owns this conversation right now -- don't let the AI reply.
    return json({ sessionId: sessionId, mode: 'human', reply: null });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json({ sessionId: sessionId, mode: effectiveMode, reply: null, error: 'not_configured' });
  }

  const { results: history } = await env.DB.prepare(
    `SELECT role, text FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 12`
  ).bind(sessionId).all();
  const turns = history.reverse().map(function (m) {
    return { role: m.role === 'visitor' ? 'user' : 'assistant', content: m.text };
  });

  let systemPrompt = SYSTEM_PROMPT_BASE + '\nReply in ' + (lang === 'es' ? 'Spanish' : 'English') + '.';
  systemPrompt += '\n\nSession state: quote_already_submitted=' + (session.quoteSubmitted ? 'true' : 'false') + '.';
  if (session.quoteSubmitted) {
    systemPrompt += ' A quote has already been sent for this conversation -- never output another <<QUOTE:...>> tag, even if they share more details; just acknowledge it and say you\'ll pass it along.';
  }
  if (quoteShortcut) {
    systemPrompt += session.quoteSubmitted
      ? '\nThe visitor just clicked "Request a Quote" again. Let them know it\'s already been sent to the team and ask if there\'s anything else you can help with.'
      : '\nThe visitor just clicked a "Request a Quote" button. Skip ahead -- go straight to collecting their name, a contact method, division, what they need, and rush timing, a couple questions at a time.';
  }

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // Check https://docs.claude.com/en/docs/about-claude/models for the
        // current model ID before you deploy -- this changes over time and
        // an outdated one will fail with a 404 from Anthropic's API.
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system: systemPrompt,
        messages: turns,
      }),
    });
  } catch (e) {
    return json({ sessionId: sessionId, mode: effectiveMode, reply: null, error: 'upstream_unreachable' });
  }

  if (!resp.ok) {
    return json({ sessionId: sessionId, mode: effectiveMode, reply: null, error: 'upstream_error' });
  }
  const data = await resp.json();
  const rawText = (data.content || []).map(function (b) { return b.text || ''; }).join('');

  const quoteMatch = rawText.match(QUOTE_TAG_RE);
  const statusMatch = rawText.match(STATUS_TAG_RE);
  const visibleText = stripTags(rawText) || rawText;

  if (quoteMatch && !session.quoteSubmitted) {
    context.waitUntil(submitQuoteFromChat(context, sessionId, quoteMatch[1], lang));
  }
  if (statusMatch) {
    const status = statusMatch[1];
    context.waitUntil(env.DB.prepare(`UPDATE chat_sessions SET resolution = ? WHERE id = ?`).bind(status, sessionId).run());
    if (status === 'unresolved') {
      context.waitUntil(flagUnresolved(context, sessionId, page));
    }
  }

  await env.DB.prepare(
    `INSERT INTO chat_messages (id, session_id, role, text, created_at) VALUES (?, ?, 'ai', ?, ?)`
  ).bind(newId(), sessionId, visibleText, new Date().toISOString()).run();

  return json({ sessionId: sessionId, mode: effectiveMode, reply: visibleText });
}
