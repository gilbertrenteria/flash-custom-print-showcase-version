// Public endpoint the "Shop" product customizer posts to. This widget never
// collects a customer name/email, so it can't satisfy /api/quotes' required
// fields or the orders table's schema -- this is a lightweight notify-only
// endpoint (no D1 write), just forwarding the order details (and an optional
// design-file attachment) to the shop's inbox.
import { json } from '../_lib/auth.js';
import { notifyEmail, notifySms } from '../_lib/notify.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }

  const itemName = (body.itemName || '').trim();
  const breakdown = (body.breakdown || '').trim();
  if (!itemName || !breakdown) {
    return json({ error: 'missing_fields' }, { status: 400 });
  }
  // honeypot: a hidden field real visitors never fill in
  if (body.website) {
    return json({ ok: true }); // silently accept and drop -- don't tip off bots
  }

  const attachmentName = (body.attachmentName || '').trim();
  const attachmentData = typeof body.attachmentData === 'string' ? body.attachmentData : '';
  const MAX_ATTACHMENT_BASE64_CHARS = 11 * 1024 * 1024;
  let attachments;
  if (attachmentName && attachmentData && attachmentData.length <= MAX_ATTACHMENT_BASE64_CHARS) {
    attachments = [{ filename: attachmentName, content: attachmentData }];
  }

  context.waitUntil(notifyEmail(
    env,
    'New Shop Order Request — ' + itemName,
    breakdown,
    attachments
  ));
  context.waitUntil(notifySms(
    env,
    'Flash: new shop order request for ' + itemName + '. Check email for details.'
  ));

  return json({ ok: true });
}
