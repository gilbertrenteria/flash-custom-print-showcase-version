// Public endpoint the marketing site's quote form posts to. Writes the raw
// quote AND immediately creates a matching order on the dashboard board
// (stage "Quoted") -- no polling/sync job needed, this is real-time.
import { json, newId } from '../_lib/auth.js';
import { notifyEmail, notifySms, notifyCustomer } from '../_lib/notify.js';

function decideDivision(subjectLabel) {
  const s = (subjectLabel || '').toLowerCase();
  if (s.includes('signs') && !s.includes('apparel')) return 'signs';
  return 'apparel';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const breakdown = (body.breakdown || '').trim();
  if (!name || !email || !breakdown) {
    return json({ error: 'missing_fields' }, { status: 400 });
  }
  // honeypot: a hidden field real visitors never fill in
  if (body.website) {
    return json({ ok: true }); // silently accept and drop -- don't tip off bots
  }

  const id = newId();
  const now = new Date().toISOString();
  const phone = (body.phone || '').trim();
  const subjectLabel = (body.subjectLabel || '').trim();
  const rush = body.rush ? 1 : 0;
  const lang = body.lang === 'es' ? 'es' : 'en';

  await env.DB.prepare(
    `INSERT INTO quotes (id, name, email, phone, subject_label, breakdown, rush, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, email, phone, subjectLabel, breakdown, rush, now).run();

  const orderId = 'from-quote-' + id;
  const division = decideDivision(subjectLabel);
  // Lands in "New Inquiry", not "Quoted" -- submitting this form only means
  // the visitor asked for a price, not that Flash has actually given them
  // one yet. It only becomes "Quoted" once a real dollar figure is entered
  // on the dashboard.
  await env.DB.prepare(
    `INSERT INTO orders (id, customer, division, description, contact_email, contact_phone, notes, stage, is_example, from_quote_id, contact_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'New Inquiry', 0, ?, ?, ?, ?)`
  ).bind(orderId, name, division, breakdown, email, phone, rush ? 'RUSH REQUESTED' : '', id, 'Submitted the on-site quote form.', now, now).run();

  const attachmentName = (body.attachmentName || '').trim();
  const attachmentData = typeof body.attachmentData === 'string' ? body.attachmentData : '';
  const MAX_ATTACHMENT_BASE64_CHARS = 11 * 1024 * 1024;
  let attachments;
  if (attachmentName && attachmentData && attachmentData.length <= MAX_ATTACHMENT_BASE64_CHARS) {
    attachments = [{ filename: attachmentName, content: attachmentData }];
  }

  context.waitUntil(notifyEmail(
    env,
    'New Quote Request — ' + (subjectLabel || 'Flash') + ' — ' + name,
    breakdown,
    attachments
  ));
  context.waitUntil(notifySms(
    env,
    'Flash: new quote from ' + name + ' (' + (subjectLabel || 'general') + '). Check the dashboard.'
  ));
  // Let the CUSTOMER know it went through too, not just the team -- same
  // contact info they just gave us, best-effort (never blocks the response).
  notifyCustomer(context, env, { name: name, email: email, phone: phone, lang: lang });

  return json({ ok: true, id: id });
}
