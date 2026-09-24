import { isAuthenticated, json } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.ADMIN_KEY) return json({ loggedIn: false });
  const ok = await isAuthenticated(request, env.ADMIN_KEY);
  return json({ loggedIn: ok });
}
