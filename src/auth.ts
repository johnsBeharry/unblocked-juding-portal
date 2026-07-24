import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv, Role, UserRow } from "./types";
import { sha256Hex } from "./util";

export const SESSION_COOKIE = "ub_session";

/**
 * Authenticates the request and loads the app user.
 *
 * AUTH_MODE="magic" (production): a server-side session referenced by an
 * HttpOnly cookie, created by the magic-link flow in routes/auth.ts.
 * AUTH_MODE="dev" (local only): trusts DEV_USER_EMAIL / x-dev-user and
 * auto-provisions ADMIN_EMAILS as admins.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.AUTH_MODE === "dev") {
    const email = (c.req.header("x-dev-user") || c.env.DEV_USER_EMAIL || "").toLowerCase();
    if (!email) return c.json({ error: "unauthenticated" }, 401);

    let user = await c.env.DB.prepare("SELECT id, email, name, role FROM users WHERE email = ?")
      .bind(email)
      .first<UserRow>();
    if (!user && adminEmails(c.env.ADMIN_EMAILS).includes(email)) {
      user = await c.env.DB.prepare(
        "INSERT INTO users (email, name, role) VALUES (?, ?, 'admin') RETURNING id, email, name, role",
      )
        .bind(email, email.split("@")[0])
        .first<UserRow>();
    }
    if (!user) return c.json({ error: "not_invited", email }, 403);
    c.set("user", user);
    return next();
  }

  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return c.json({ error: "unauthenticated" }, 401);

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  )
    .bind(await sha256Hex(raw))
    .first<UserRow>();
  if (!user) return c.json({ error: "unauthenticated" }, 401);

  c.set("user", user);
  await next();
};

export function adminEmails(configured: string | undefined): string[] {
  return (configured || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Role gate; "manager" also admits admins. */
export function requireRole(role: Exclude<Role, "judge">): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    const allowed = role === "manager" ? user.role === "manager" || user.role === "admin" : user.role === "admin";
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

/**
 * Blocks cross-site mutating requests. The session cookie is SameSite=Lax,
 * but this also covers top-level cross-site POSTs.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") {
      return c.json({ error: "cross_site_request_blocked" }, 403);
    }
  }
  await next();
};
