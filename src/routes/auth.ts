import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { SESSION_COOKIE, adminEmails, csrfGuard } from "../auth";
import { emailShell, escapeHtml, sendEmail, verifyUnsubscribeToken } from "../email";
import { randomToken, sha256Hex } from "../util";

/**
 * Magic-link sign-in: POST /api/auth/request-link emails a one-time link via
 * Resend. Signing in is a two-step exchange, not a single GET:
 *   GET  /auth/callback  validates the token and shows a "confirm" button —
 *                        it does NOT consume the token or create a session.
 *   POST /auth/callback  consumes the token and creates the session.
 * This matters because corporate mail gateways and email clients (Outlook
 * Safe Links, etc.) prefetch links to scan them, which would silently burn
 * a one-time token on a GET before the user ever clicks it. Only an explicit
 * button click (POST) can complete sign-in.
 *
 * Tokens and sessions are stored as SHA-256 hashes only. The request endpoint
 * answers identically for invited and unknown emails so it can't be used to
 * probe who is on a panel.
 */
export const auth = new Hono<AppEnv>();

auth.use("*", csrfGuard);

const LINK_TTL_MINUTES = 15;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_LINKS_PER_WINDOW = 3;

function loginEmail(name: string, link: string): string {
  return emailShell(`
    <p style="margin:0 0 16px">Hey ${escapeHtml(name)},</p>
    <p style="margin:0 0 16px">Here's your one-time link to sign in to the judging portal. It works once and expires in ${LINK_TTL_MINUTES} minutes.</p>
    <p style="margin:0 0 20px">→ <a href="${link}" style="color:#2850fe;text-decoration:underline">Sign in to UNBLOCKED Judging</a></p>
    <p style="margin:0 0 16px;font-size:13px;color:#767676">If that doesn't work, paste this into your browser:<br>${link}</p>
    <p style="margin:0;font-size:13px;color:#767676">Didn't request this? Just ignore it.</p>`);
}

auth.post("/api/auth/request-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid_email" }, 400);

  let user = await c.env.DB.prepare("SELECT id, name FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: number; name: string }>();
  if (!user && adminEmails(c.env.ADMIN_EMAILS).includes(email)) {
    user = await c.env.DB.prepare(
      "INSERT INTO users (email, name, role) VALUES (?, ?, 'admin') RETURNING id, name",
    )
      .bind(email, email.split("@")[0])
      .first<{ id: number; name: string }>();
  }
  // Uninvited emails get the same response as invited ones — just no email.
  if (!user) return c.json({ ok: true });

  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM auth_tokens
     WHERE email = ? AND created_at > datetime('now', '-${LINK_TTL_MINUTES} minutes')`,
  )
    .bind(email)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_WINDOW) return c.json({ error: "too_many_requests" }, 429);

  const rawToken = randomToken(32);
  await c.env.DB.prepare(
    `INSERT INTO auth_tokens (email, token_hash, expires_at)
     VALUES (?, ?, datetime('now', '+${LINK_TTL_MINUTES} minutes'))`,
  )
    .bind(email, await sha256Hex(rawToken))
    .run();

  const link = `${new URL(c.req.url).origin}/auth/callback?token=${rawToken}`;
  const name = user!.name || email.split("@")[0];
  const sent = await sendEmail(c.env, {
    to: email,
    subject: "Your sign-in link",
    html: loginEmail(name, link),
  });
  if (!sent.ok) return c.json({ error: sent.error }, 502);
  return c.json({ ok: true });
});

async function validTokenLookup(c: { env: AppEnv["Bindings"] }, rawToken: string) {
  if (!rawToken) return null;
  return c.env.DB.prepare(
    `SELECT id, email FROM auth_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
  )
    .bind(await sha256Hex(rawToken))
    .first<{ id: number; email: string }>();
}

function confirmPage(rawToken: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Confirm sign-in — UNBLOCKED Judging</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="t-app-shell" style="grid-template-columns:1fr">
      <section class="o-portal-gate">
        <article class="t-gate-panel login-card">
          <span class="a-section-tag">Sign in</span>
          <h2>Confirm it's you</h2>
          <p>For security, links aren't enough on their own — some email apps open them automatically to scan for safety. Click below to finish signing in.</p>
          <form class="o-login-form" method="POST" action="/auth/callback">
            <input type="hidden" name="token" value="${escapeHtml(rawToken)}">
            <button class="a-action-trigger a-action-trigger--primary" type="submit">Complete sign-in</button>
          </form>
        </article>
      </section>
    </main>
  </body>
</html>`;
}

auth.get("/auth/callback", async (c) => {
  const rawToken = c.req.query("token") || "";
  const token = await validTokenLookup(c, rawToken);
  if (!token) return c.redirect("/?auth=invalid");
  return c.html(confirmPage(rawToken));
});

auth.post("/auth/callback", async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const rawToken = typeof form.token === "string" ? form.token : "";
  const token = await validTokenLookup(c, rawToken);
  if (!token) return c.redirect("/?auth=invalid");

  await c.env.DB.prepare("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?")
    .bind(token.id)
    .run();
  const user = await c.env.DB.prepare("SELECT id, role FROM users WHERE email = ?")
    .bind(token.email)
    .first<{ id: number; role: string }>();
  if (!user) return c.redirect("/?auth=invalid");

  const rawSession = randomToken(32);
  await c.env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_TTL_SECONDS} seconds'))`,
  )
    .bind(await sha256Hex(rawSession), user.id)
    .run();

  // Opportunistic cleanup of expired credentials.
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  await c.env.DB.prepare("DELETE FROM auth_tokens WHERE expires_at < datetime('now', '-1 day')").run();

  setCookie(c, SESSION_COOKIE, rawSession, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect(user.role === "judge" ? "/" : "/admin.html");
});

/**
 * One-click unsubscribe, same GET-confirms/POST-commits shape as the sign-in
 * link above and for the same reason: a GET that mutated state would let
 * mail-scanner link prefetching silently opt people out of invite emails.
 */
function unsubscribeConfirmPage(email: string, token: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unsubscribe — UNBLOCKED Judging</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="t-app-shell" style="grid-template-columns:1fr">
      <section class="o-portal-gate">
        <article class="t-gate-panel login-card">
          <span class="a-section-tag">Unsubscribe</span>
          <h2>Stop these emails?</h2>
          <p>${escapeHtml(email)} won't get invite or welcome emails going forward. This doesn't affect your sign-in link — you can always come back and sign in.</p>
          <form class="o-login-form" method="POST" action="/email/unsubscribe">
            <input type="hidden" name="email" value="${escapeHtml(email)}">
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            <button class="a-action-trigger a-action-trigger--primary" type="submit">Unsubscribe me</button>
          </form>
        </article>
      </section>
    </main>
  </body>
</html>`;
}

function unsubscribeDonePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unsubscribed — UNBLOCKED Judging</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="t-app-shell" style="grid-template-columns:1fr">
      <section class="o-portal-gate">
        <article class="t-gate-panel login-card">
          <span class="a-section-tag">Unsubscribe</span>
          <h2>You're unsubscribed</h2>
          <p>You won't get invite or welcome emails going forward.</p>
        </article>
      </section>
    </main>
  </body>
</html>`;
}

auth.get("/email/unsubscribe", async (c) => {
  const email = (c.req.query("email") || "").trim().toLowerCase();
  const token = c.req.query("token") || "";
  if (!email || !(await verifyUnsubscribeToken(c.env, email, token))) {
    return c.redirect("/?auth=invalid");
  }
  return c.html(unsubscribeConfirmPage(email, token));
});

auth.post("/email/unsubscribe", async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const email = (typeof form.email === "string" ? form.email : "").trim().toLowerCase();
  const token = typeof form.token === "string" ? form.token : "";
  if (!email || !(await verifyUnsubscribeToken(c.env, email, token))) {
    return c.redirect("/?auth=invalid");
  }
  await c.env.DB.prepare("UPDATE users SET opted_out_at = datetime('now') WHERE email = ?")
    .bind(email)
    .run();
  return c.html(unsubscribeDonePage());
});

auth.post("/api/auth/logout", async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (raw) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(raw))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
