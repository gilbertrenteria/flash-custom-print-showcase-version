// Gate every /api/* route except the public ones behind the dashboard login.
import { isAuthenticated, json } from '../_lib/auth.js';

const PUBLIC_EXACT = ['/api/quotes', '/api/login', '/api/logout', '/api/chat', '/api/session', '/api/presence'];

// /api/chat/<sessionId> is also public -- it's how a visitor's own browser
// polls their own conversation thread. Everything else under /api/live/*
// (the dashboard's visitor/chat views) stays behind the login gate below.
function isPublicPath(pathname) {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  if (pathname.indexOf('/api/chat/') === 0) return true;
  return false;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (isPublicPath(url.pathname)) {
    return next();
  }

  if (!context.env.ADMIN_KEY) {
    return json({ error: 'server_not_configured', message: 'ADMIN_KEY secret is not set.' }, { status: 500 });
  }

  const ok = await isAuthenticated(request, context.env.ADMIN_KEY);
  if (!ok) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  return next();
}
