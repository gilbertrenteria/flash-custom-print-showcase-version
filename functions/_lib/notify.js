// Shared best-effort notification helpers (email via Resend, SMS via Twilio).
// Both fail silently -- a notification is never allowed to block or fail the
// request that triggered it. Each one independently no-ops if its own set of
// env vars isn't configured yet, so quotes/chat work fine before either is
// set up.

export async function notifyEmail(env, subject, text, attachments) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL || !env.RESEND_FROM) return;
  try {
    const payload = { from: env.RESEND_FROM, to: env.NOTIFY_EMAIL, subject: subject, text: text };
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments;
    }
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // best-effort only
  }
}

export async function notifySms(env, body) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER || !env.NOTIFY_PHONE) return;
  try {
    const auth = btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
    const form = new URLSearchParams({ To: env.NOTIFY_PHONE, From: env.TWILIO_FROM_NUMBER, Body: body });
    await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (e) {
    // best-effort only
  }
}

// ---- Customer-facing confirmations -----------------------------------
// The two functions above always notify the BUSINESS (env.NOTIFY_EMAIL /
// env.NOTIFY_PHONE). These two notify the CUSTOMER themselves, at the
// contact info they gave us, so they know their request actually went
// through instead of just trusting a "submitted" message in the browser.
// Same fail-soft rules: no key/contact -> silently skip, never throws.

// Best-effort US/Canada E.164 normalizer. Good enough for the phone
// numbers real visitors type into a web form; anything that doesn't look
// like a 10 or 11-digit NANP number is left alone (and Twilio will just
// reject it silently via notifySms's own try/catch, same as today).
export function normalizePhoneE164(raw) {
  const digits = (raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if ((raw || '').trim().startsWith('+')) return raw.trim();
  return '';
}

const CUSTOMER_COPY = {
  en: {
    subject: 'Got it — Flash Custom Apparel & Signs',
    email: function (name) {
      return 'Hey ' + (name || 'there') + ',\n\n' +
        'Thanks for reaching out to Flash! We got your request and someone from our team will follow up with you directly, usually the same day.\n\n' +
        'Need to add anything or have a question in the meantime? Just reply to this email, or call/text us at (555) 555-0100.\n\n' +
        '— Flash Custom Apparel & Signs';
    },
    sms: function (name) {
      return 'Flash: Hey ' + (name || 'there') + ' — we got your request! We\'ll follow up soon, usually same day. Questions? Call/text (555) 555-0100.';
    },
  },
  es: {
    subject: 'Recibido — Flash Custom Apparel & Signs',
    email: function (name) {
      return 'Hola ' + (name || '') + ',\n\n' +
        'Gracias por contactar a Flash. Recibimos tu solicitud y alguien de nuestro equipo te contactará directamente, normalmente el mismo día.\n\n' +
        '¿Necesitas agregar algo o tienes una pregunta mientras tanto? Responde este correo, o llámanos/escríbenos al (555) 555-0100.\n\n' +
        '— Flash Custom Apparel & Signs';
    },
    sms: function (name) {
      return 'Flash: ¡Hola ' + (name || '') + '! Recibimos tu solicitud. Te contactaremos pronto, normalmente el mismo día. Preguntas? (555) 555-0100.';
    },
  },
};

export async function notifyCustomerEmail(env, opts) {
  const email = (opts && opts.email || '').trim();
  if (!env.RESEND_API_KEY || !env.RESEND_FROM || !email) return;
  const copy = CUSTOMER_COPY[opts.lang === 'es' ? 'es' : 'en'];
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: email,
        subject: copy.subject,
        text: copy.email(opts.name),
      }),
    });
  } catch (e) {
    // best-effort only
  }
}

export async function notifyCustomerSms(env, opts) {
  const phone = normalizePhoneE164(opts && opts.phone);
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER || !phone) return;
  const copy = CUSTOMER_COPY[opts.lang === 'es' ? 'es' : 'en'];
  try {
    const auth = btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
    const form = new URLSearchParams({ To: phone, From: env.TWILIO_FROM_NUMBER, Body: copy.sms(opts.name) });
    await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (e) {
    // best-effort only
  }
}

// Convenience wrapper: fire both customer confirmations (email + SMS, each
// independently no-op'ing if that channel isn't set up / no contact given)
// without the call site needing to know about either channel individually.
export function notifyCustomer(context, env, opts) {
  context.waitUntil(notifyCustomerEmail(env, opts));
  context.waitUntil(notifyCustomerSms(env, opts));
}
