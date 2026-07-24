import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { SESSION_COOKIE, adminEmails, csrfGuard } from "../auth";
import { randomToken, sha256Hex } from "../util";

/**
 * Magic-link sign-in: POST /api/auth/request-link emails a one-time link via
 * Resend; GET /auth/callback exchanges it for a session cookie.
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

function loginEmail(link: string): string {
  return `<!doctype html>
<div style="margin:0 auto;max-width:460px;padding:36px 24px;background:#101010;border-radius:10px;font-family:Inter,system-ui,sans-serif">
  <p style="margin:0 0 24px;color:#f4a8c0;font-size:22px;font-weight:800;letter-spacing:.02em">UNBLOCKED</p>
  <p style="margin:0 0 8px;color:#f6eef2;font-size:16px;font-weight:700">Sign in to the judging portal</p>
  <p style="margin:0 0 24px;color:#cba9ba;font-size:14px;line-height:1.5">
    This link signs you in once and expires in ${LINK_TTL_MINUTES} minutes.
    If you didn't request it, you can ignore this email.</p>
  <a href="${link}" style="display:inline-block;padding:13px 22px;background:#2850fe;border-radius:8px;color:#ffffff;font-size:14px;font-weight:800;text-decoration:none">Sign in</a>
  <p style="margin:24px 0 0;color:#967d89;font-size:12px;line-height:1.5;word-break:break-all">
    Or paste this link into your browser:<br>${link}</p>
</div>`;
}

auth.post("/api/auth/request-link", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid_email" }, 400);

  let user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!user && adminEmails(c.env.ADMIN_EMAILS).includes(email)) {
    user = await c.env.DB.prepare(
      "INSERT INTO users (email, name, role) VALUES (?, ?, 'admin') RETURNING id",
    )
      .bind(email, email.split("@")[0])
      .first();
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

  if (!c.env.RESEND_API_KEY) return c.json({ error: "email_not_configured" }, 500);

  const rawToken = randomToken(32);
  await c.env.DB.prepare(
    `INSERT INTO auth_tokens (email, token_hash, expires_at)
     VALUES (?, ?, datetime('now', '+${LINK_TTL_MINUTES} minutes'))`,
  )
    .bind(email, await sha256Hex(rawToken))
    .run();

  const link = `${new URL(c.req.url).origin}/auth/callback?token=${rawToken}`;
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: c.env.MAIL_FROM || "UNBLOCKED Judging <onboarding@resend.dev>",
      to: [email],
      subject: "Your UNBLOCKED judging sign-in link",
      html: loginEmail(link),
    }),
  });
  if (!sent.ok) {
    console.error("resend_error", sent.status, await sent.text());
    return c.json({ error: "email_send_failed" }, 502);
  }
  return c.json({ ok: true });
});

auth.get("/auth/callback", async (c) => {
  const rawToken = c.req.query("token") || "";
  const token = rawToken
    ? await c.env.DB.prepare(
        `SELECT id, email FROM auth_tokens
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
      )
        .bind(await sha256Hex(rawToken))
        .first<{ id: number; email: string }>()
    : null;
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
