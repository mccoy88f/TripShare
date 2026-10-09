import type { Locale } from '@tripshare/shared';

export type EmailTemplate =
  | { kind: 'verify-email'; url: string; name: string }
  | { kind: 'reset-password'; url: string; name: string }
  | { kind: 'set-password'; url: string; name: string }
  | { kind: 'magic-link'; url: string }
  | { kind: 'test' };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Copy = { subject: string; title: string; body: string; cta?: string; footer?: string };

function copy(t: EmailTemplate, locale: Locale, appName: string): Copy {
  const it = locale === 'it';
  switch (t.kind) {
    case 'verify-email':
      return it
        ? {
            subject: `Conferma il tuo indirizzo email · ${appName}`,
            title: `Ciao ${t.name}, benvenuto su ${appName}!`,
            body: 'Conferma il tuo indirizzo email per attivare l\'account e iniziare a organizzare i tuoi viaggi.',
            cta: 'Conferma email',
            footer: 'Se non hai creato tu l\'account, ignora questa email.',
          }
        : {
            subject: `Confirm your email address · ${appName}`,
            title: `Hi ${t.name}, welcome to ${appName}!`,
            body: 'Confirm your email address to activate your account and start planning your trips.',
            cta: 'Confirm email',
            footer: 'If you did not create this account, you can ignore this email.',
          };
    case 'reset-password':
      return it
        ? {
            subject: `Reimposta la password · ${appName}`,
            title: `Ciao ${t.name}`,
            body: 'Abbiamo ricevuto una richiesta per reimpostare la tua password. Il link scade tra un\'ora.',
            cta: 'Reimposta password',
            footer: 'Se non l\'hai chiesto tu, ignora questa email: la password resta invariata.',
          }
        : {
            subject: `Reset your password · ${appName}`,
            title: `Hi ${t.name}`,
            body: 'We received a request to reset your password. The link expires in one hour.',
            cta: 'Reset password',
            footer: 'If you did not ask for this, ignore this email: your password stays the same.',
          };
    case 'set-password':
      return it
        ? {
            subject: `Il tuo account amministratore · ${appName}`,
            title: `Ciao ${t.name}`,
            body: `È stato creato il tuo account super admin su ${appName}. Imposta la password per accedere. Il link scade tra un'ora: se scade, usa "Password dimenticata" nella pagina di accesso.`,
            cta: 'Imposta password',
          }
        : {
            subject: `Your administrator account · ${appName}`,
            title: `Hi ${t.name}`,
            body: `Your super admin account on ${appName} has been created. Set a password to sign in. The link expires in one hour: if it does, use "Forgot password" on the sign-in page.`,
            cta: 'Set password',
          };
    case 'magic-link':
      return it
        ? {
            subject: `Il tuo link di accesso · ${appName}`,
            title: 'Accedi con un clic',
            body: 'Usa questo link per accedere. Scade tra 5 minuti e funziona una sola volta.',
            cta: 'Accedi',
            footer: 'Se non l\'hai chiesto tu, ignora questa email.',
          }
        : {
            subject: `Your sign-in link · ${appName}`,
            title: 'Sign in with one click',
            body: 'Use this link to sign in. It expires in 5 minutes and works only once.',
            cta: 'Sign in',
            footer: 'If you did not ask for this, ignore this email.',
          };
    case 'test':
      return it
        ? {
            subject: `Email di prova · ${appName}`,
            title: 'La configurazione SMTP funziona',
            body: `Questa è un'email di prova inviata dal pannello di amministrazione di ${appName}.`,
          }
        : {
            subject: `Test email · ${appName}`,
            title: 'SMTP is working',
            body: `This is a test email sent from the ${appName} admin panel.`,
          };
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderEmail(t: EmailTemplate, locale: Locale, appName: string): RenderedEmail {
  const c = copy(t, locale, appName);
  const url = 'url' in t ? t.url : undefined;
  const button =
    url && c.cta
      ? `<p style="margin:28px 0"><a href="${escape(url)}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${escape(c.cta)}</a></p>
<p style="font-size:13px;color:#64748b">${locale === 'it' ? 'Se il pulsante non funziona, copia questo link nel browser:' : 'If the button does not work, paste this link into your browser:'}<br><a href="${escape(url)}" style="color:#0d9488;word-break:break-all">${escape(url)}</a></p>`
      : '';
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
<div style="font-size:22px;font-weight:700;margin-bottom:16px">🧳 ${escape(appName)}</div>
<div style="background:#fff;border-radius:16px;padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">${escape(c.title)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0">${escape(c.body)}</p>
${button}
${c.footer ? `<p style="font-size:13px;color:#64748b;margin:20px 0 0">${escape(c.footer)}</p>` : ''}
</div></div></body></html>`;
  const text = [c.title, '', c.body, url ? `\n${c.cta}: ${url}` : '', c.footer ? `\n${c.footer}` : '']
    .join('\n')
    .trim();
  return { subject: c.subject, html, text };
}
