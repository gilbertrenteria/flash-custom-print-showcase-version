import { json } from '../_lib/auth.js';

function row(r) {
  if (!r) return {};
  return {
    divisions: r.divisions, location: r.location, yearsInBusiness: r.years_in_business,
    legalStatus: r.legal_status, contact: r.contact, model: r.model, supplier: r.supplier,
    volume: r.volume, acquisitionToday: r.acquisition_today, growthGoal: r.growth_goal,
    pricingNotes: r.pricing_notes, marketingSiteUrl: r.marketing_site_url,
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  const r = await env.DB.prepare('SELECT * FROM business_info WHERE id = 1').first();
  return json(row(r));
}

export async function onRequestPut(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_request' }, { status: 400 }); }
  await env.DB.prepare(
    `UPDATE business_info SET divisions=?, location=?, years_in_business=?, legal_status=?, contact=?, model=?, supplier=?, volume=?, acquisition_today=?, growth_goal=?, pricing_notes=?, marketing_site_url=? WHERE id=1`
  ).bind(
    body.divisions || '', body.location || '', body.yearsInBusiness || '', body.legalStatus || '',
    body.contact || '', body.model || '', body.supplier || '', body.volume || '',
    body.acquisitionToday || '', body.growthGoal || '', body.pricingNotes || '', body.marketingSiteUrl || ''
  ).run();
  return json({ ok: true });
}
