import { json } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const { request, env, params } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  const now = new Date().toISOString();
  const existing = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(params.id).first();
  if (!existing) return json({ error: 'not_found' }, { status: 404 });
  await env.DB.prepare(
    `UPDATE orders SET customer=?, division=?, description=?, qty=?, amount=?, contact_email=?, contact_phone=?, needed_by=?, notes=?, stage=?, source=?, contact_note=?, quoted_for=?, quoted_at=?, lost_reason=?, lost_note=?, vendor_id=?, vendor_cost=?, updated_at=? WHERE id=?`
  ).bind(
    body.customer, body.division || 'apparel', body.description,
    body.qty || null, body.amount || null, body.contactEmail || null, body.contactPhone || null,
    body.neededBy || null, body.notes || null, body.stage || 'New Inquiry',
    body.source || 'manual', body.contactNote || null, body.quotedFor || null, body.quotedAt || null,
    body.lostReason || null, body.lostNote || null, body.vendorId || null, body.vendorCost || null,
    now, params.id
  ).run();
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
