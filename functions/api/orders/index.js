import { json, newId } from '../../_lib/auth.js';

function row(r) {
  return {
    id: r.id,
    customer: r.customer,
    division: r.division,
    description: r.description,
    qty: r.qty,
    amount: r.amount,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    neededBy: r.needed_by,
    notes: r.notes,
    stage: r.stage,
    isExample: !!r.is_example,
    source: r.source,
    contactNote: r.contact_note,
    quotedFor: r.quoted_for,
    quotedAt: r.quoted_at,
    lostReason: r.lost_reason,
    lostNote: r.lost_note,
    vendorId: r.vendor_id,
    vendorCost: r.vendor_cost,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  return json(results.map(row));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  if (!body.customer || !body.description) {
    return json({ error: 'missing_fields' }, { status: 400 });
  }
  const id = newId();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO orders (id, customer, division, description, qty, amount, contact_email, contact_phone, needed_by, notes, stage, is_example, source, contact_note, quoted_for, quoted_at, lost_reason, lost_note, vendor_id, vendor_cost, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, body.customer, body.division || 'apparel', body.description,
    body.qty || null, body.amount || null, body.contactEmail || null, body.contactPhone || null,
    body.neededBy || null, body.notes || null, body.stage || 'New Inquiry',
    body.source || 'manual', body.contactNote || null, body.quotedFor || null, body.quotedAt || null,
    body.lostReason || null, body.lostNote || null, body.vendorId || null, body.vendorCost || null,
    now, now
  ).run();
  return json({ id: id });
}
