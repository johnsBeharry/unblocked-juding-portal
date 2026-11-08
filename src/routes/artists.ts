import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiKeyRow, AppEnv, ArtistRow, ContestRow, EntryAsset, EntryRow } from "../types";
import { emailShell, escapeHtml, sendEmail } from "../email";
import { eventStatement } from "../events";
import { MAX_ASSETS, MOTION_LIMIT, STATIC_LIMIT, detectFileType } from "../files";
import { CONSENT_VERSION, TERMS_VERSION, acceptingSubmissions, publicContest, withdrawalsOpen } from "../contest";
import { hmacHex, parseJsonObject, publicSubmissionId, randomToken, sha256Hex } from "../util";

/**
 * Artist accounts, synced drafts and withdrawal, under /api/v1.
 *
 * Every route needs a contest API key. Routes for a signed-in artist also need
 * X-Artist-Session, which the links Worker forwards from its HttpOnly cookie.
 * The portal only trusts that header together with a valid key, so a stolen
 * cookie can't be used against the portal directly.
 *
 * Drafts live in `entries`. A `submissions` row is created only when the
 * artist presses Submit, so judges never see unfinished work. Nothing here
 * deletes entries or submissions: withdrawing and discarding set a status
 * and a timestamp, and every change is written to entry_events.
 */
export const artists = new Hono<AppEnv>();

const CODE_TTL_MINUTES = 15;
const MAX_CODES_PER_WINDOW = 3;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_AFTER_SECONDS = 30;
const SESSION_TTL_DAYS = 30;
const MAX_DRAFTS_PER_CONTEST = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Poster fields an entry can hold. title and concept have their own columns. */
const META_FIELDS = [
  "year_designed",
  "designed_for",
  "client_name",
  "creation_method",
  "materials_used",
  "digital_programs",
  "printing_method",
] as const;
const FIELD_LIMITS: Record<string, number> = { title: 200, concept: 4000 };
const BIO_LIMIT = 1000;
const PHOTO_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

type Ctx = Context<AppEnv>;

// ---------- auth ----------

async function lookupKey(c: Ctx): Promise<ApiKeyRow | null> {
  const header = c.req.header("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7) : c.req.header("x-api-key") || "";
  if (!raw) return null;
  return c.env.DB.prepare(
    "SELECT id, name, contest_id, signin_url FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
  )
    .bind(await sha256Hex(raw))
    .first<ApiKeyRow>();
}

const requireKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = await lookupKey(c);
  if (!key) return c.json({ error: "invalid_api_key" }, 401);
  c.set("apiKey", key);
  await next();
};

const requireArtist: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = c.req.header("x-artist-session") || "";
  if (!raw) return c.json({ error: "unauthenticated" }, 401);
  const hash = await sha256Hex(raw);
  const artist = await c.env.DB.prepare(
    `SELECT a.* FROM artist_sessions s JOIN artists a ON a.id = s.artist_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  )
    .bind(hash)
    .first<ArtistRow>();
  if (!artist) return c.json({ error: "unauthenticated" }, 401);

  // Sliding 30-day session, refreshed at most once an hour to keep writes low.
  await c.env.DB.prepare(
    `UPDATE artist_sessions
       SET expires_at = datetime('now', '+${SESSION_TTL_DAYS} days'), last_seen_at = datetime('now')
     WHERE token_hash = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 hour'))`,
  )
    .bind(hash)
    .run();
  c.set("artist", artist);
  await next();
};

/** Loads the contest in the path and checks the key may act on it. */
const requireContest: MiddlewareHandler<AppEnv> = async (c, next) => {
  const contest = await c.env.DB.prepare("SELECT * FROM contests WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<ContestRow>();
  if (!contest || contest.status === "archived") return c.json({ error: "not_found" }, 404);
  const key = c.get("apiKey");
  if (key.contest_id !== null && key.contest_id !== contest.id) {
    return c.json({ error: "invalid_api_key" }, 401);
  }
  c.set("contest", contest);
  await next();
};

// ---------- shapes ----------

function profileJson(a: ArtistRow) {
  const termsAccepted = a.terms_version === TERMS_VERSION;
  return {
    email: a.email,
    name: a.name,
    country: a.country,
    instagram: a.instagram,
    bio: a.bio,
    hasPhoto: Boolean(a.photo_key),
    // Changes when the photo does, so the page can bust its cache.
    photoId: a.photo_key ? a.photo_key.split("/").pop()!.split(".")[0] : null,
    termsVersion: a.terms_version,
    termsAcceptedAt: a.terms_accepted_at,
    termsAccepted,
    complete: Boolean(a.name && a.country && termsAccepted),
  };
}

type ProfileInput = { name?: string; country?: string; instagram?: string; bio?: string; termsVersion?: string };

/** Reads profile fields from a request body. Only fields that are present are returned. */
function readProfile(body: Record<string, unknown>): { profile: ProfileInput } | { error: string } {
  const profile: ProfileInput = {};
  if (body.name !== undefined) profile.name = cleanText(body.name, 200);
  if (body.country !== undefined) profile.country = cleanText(body.country, 100);
  if (body.bio !== undefined) profile.bio = cleanText(body.bio, BIO_LIMIT);
  if (body.instagram !== undefined) {
    const handle = normalizeInstagram(body.instagram);
    if (handle === null) return { error: "invalid_instagram" };
    profile.instagram = handle;
  }
  if (body.acceptTerms !== undefined && body.acceptTerms !== null && body.acceptTerms !== false) {
    // The page sends the version it showed, so an outdated page can't accept newer terms.
    if (body.acceptTerms !== TERMS_VERSION) return { error: "terms_outdated" };
    profile.termsVersion = TERMS_VERSION;
  }
  return { profile };
}

/** JPG, PNG or WebP under 5 MB, checked by content. */
function detectPhoto(bytes: Uint8Array): string | null {
  const t = detectFileType(bytes);
  if (t && (t.ext === "jpg" || t.ext === "png")) return t.ext;
  const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
  if (bytes.length > 12 && tag(0) === "RIFF" && tag(8) === "WEBP") return "webp";
  return null;
}

function decodeBase64(data: string): Uint8Array | null {
  try {
    const bin = atob(data.replace(/^data:[^,]*,/, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function putPhoto(c: Ctx, key: string, bytes: Uint8Array, ext: string) {
  await c.env.POSTERS.put(key, bytes, { httpMetadata: { contentType: PHOTO_TYPES[ext] } });
}

function parseAssets(raw: string): EntryAsset[] {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

type EntryWithRef = EntryRow & { reference?: string | null };

function entryJson(e: EntryWithRef) {
  const meta = parseJsonObject(e.metadata);
  const fields: Record<string, string> = { title: e.title, concept: e.concept };
  for (const key of META_FIELDS) fields[key] = typeof meta[key] === "string" ? (meta[key] as string) : "";
  const missing = [!e.title && "title", !e.file_key && "file"].filter(Boolean);
  return {
    id: e.id,
    status: e.status,
    version: e.version,
    fields,
    file: e.file_key ? { name: e.file_name, type: e.file_type, size: e.file_size } : null,
    assets: parseAssets(e.assets).map(({ id, name, type, size }) => ({ id, name, type, size })),
    reference: e.reference ?? null,
    ready: e.status === "draft" && missing.length === 0,
    missing,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    submittedAt: e.submitted_at,
    withdrawnAt: e.withdrawn_at,
  };
}

async function loadEntry(c: Ctx, id: string): Promise<EntryWithRef | null> {
  return c.env.DB.prepare(
    `SELECT e.*, s.public_id AS reference FROM entries e
     LEFT JOIN submissions s ON s.id = e.submission_id
     WHERE e.id = ? AND e.artist_id = ? AND e.contest_id = ?`,
  )
    .bind(id, c.get("artist").id, c.get("contest").id)
    .first<EntryWithRef>();
}

/** Active (not withdrawn) submissions by this artist, including ones from the old form. */
async function usedCount(c: Ctx): Promise<number> {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM submissions WHERE contest_id = ? AND artist_id = ? AND withdrawn_at IS NULL",
  )
    .bind(c.get("contest").id, c.get("artist").id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

/** "@Name", "instagram.com/Name/" → "name". Returns null when it isn't a valid handle. */
export function normalizeInstagram(raw: unknown): string | null {
  let v = String(raw ?? "").trim();
  if (!v) return "";
  v = v
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "");
  v = v.split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(v) ? v : null;
}

// ---------- email ----------

async function sendArtistEmail(
  c: Ctx,
  opts: { to: string; artistId: number | null; kind: "signin" | "receipt" | "withdrawn"; subject: string; html: string },
): Promise<boolean> {
  let result: { ok: true; id?: string } | { ok: false; error: string };
  if (c.env.ARTIST_EMAIL_MODE === "log") {
    // Local dev: print instead of sending, so no real mail goes out.
    console.log(`[artist email] to=${opts.to} subject=${opts.subject}\n${opts.html}`);
    result = { ok: true, id: "logged" };
  } else {
    result = await sendEmail(c.env, {
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      from: c.env.MAIL_FROM_ARTISTS || c.env.MAIL_FROM,
    });
  }
  await c.env.DB.prepare(
    `INSERT INTO artist_emails (artist_id, email, kind, status, resend_id, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      opts.artistId,
      opts.to,
      opts.kind,
      result.ok ? "sent" : "failed",
      result.ok ? result.id ?? null : null,
      result.ok ? null : result.error,
    )
    .run();
  return result.ok;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function signinEmail(name: string, code: string, link: string | null, creating: boolean): string {
  const greeting = name ? `Hey ${escapeHtml(firstName(name))},` : "Hey,";
  const intro = creating
    ? `<p>Enter this code to confirm your email and join UNBLOCKED.</p>`
    : "";
  const linkPart = link
    ? `<p>→ <a href="${link}">${creating ? "Confirm your email and join" : "Sign in to UNBLOCKED"}</a></p>
    <p>If that doesn't work, paste this into your browser:<br>${link}</p>`
    : "";
  return emailShell(`
    <p>${greeting}</p>
    ${intro}
    <p>Your code is <strong>${spacedCode(code)}</strong>. It works once and expires in ${CODE_TTL_MINUTES} minutes.</p>
    ${linkPart}
    <p>Didn't request this? Just ignore it.</p>`);
}

function formLink(key: ApiKeyRow, hash: string): string | null {
  return key.signin_url ? `${key.signin_url.replace(/\/+$/, "")}${hash}` : null;
}

function closingLine(contest: ContestRow): string {
  if (!contest.closes_at) return "";
  // Emails can't know the reader's time zone, so state the time in UTC.
  const when = new Date(contest.closes_at).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `<p>Submissions close on ${escapeHtml(when)} UTC.</p>`;
}

function receiptEmail(
  artist: ArtistRow,
  contest: ContestRow,
  items: { title: string; reference: string }[],
  key: ApiKeyRow,
): { subject: string; html: string } {
  const n = items.length;
  const what = n === 1 ? `"${items[0].title}"` : `${n} posters`;
  const list = items.map((i) => `<li>${escapeHtml(i.title)} · ${escapeHtml(i.reference)}</li>`).join("");
  const link = formLink(key, "#posters");
  return {
    subject: `We received ${what} for ${contest.theme || contest.name}`,
    html: emailShell(`
      <p>Hey ${escapeHtml(firstName(artist.name) || "there")},</p>
      <p>Thanks, we received ${n === 1 ? "your poster" : "these posters"} for ${escapeHtml(contest.name)}:</p>
      <ul>${list}</ul>
      <p>Keep the reference${n === 1 ? "" : "s"} for your records.</p>
      ${link ? `<p>→ <a href="${link}">Submit another poster or view your entries</a></p>` : ""}
      ${closingLine(contest)}`),
  };
}

function withdrawnEmail(
  artist: ArtistRow,
  contest: ContestRow,
  title: string,
  reference: string,
  key: ApiKeyRow,
): { subject: string; html: string } {
  const link = formLink(key, "#posters");
  return {
    subject: `"${title}" was withdrawn`,
    html: emailShell(`
      <p>Hey ${escapeHtml(firstName(artist.name) || "there")},</p>
      <p>"${escapeHtml(title)}" (${escapeHtml(reference)}) was withdrawn from ${escapeHtml(contest.name)} on ${escapeHtml(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }))}. It won't be judged.</p>
      <p>Changed your mind? You can restore it from your entries while submissions are open${link ? `: <a href="${link}">view your entries</a>` : ""}.</p>
      ${closingLine(contest)}`),
  };
}

/** Sends after the response so a slow mail API never delays the artist. */
function later(c: Ctx, work: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(work.catch((err) => console.error("artist_email_failed", err)));
  } catch {
    work.catch((err) => console.error("artist_email_failed", err));
  }
}

// ---------- sign-in ----------

function randomCode(): string {
  // Uniform 000000–999999 (rejection sampling avoids modulo bias).
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

artists.post("/artists/codes", requireKey, async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = cleanText(body?.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 400);
  if (!c.env.ARTIST_CODE_SECRET) return c.json({ error: "artist_signin_not_configured" }, 500);

  const key = c.get("apiKey");
  const contest = await c.env.DB.prepare("SELECT id FROM contests WHERE slug = ?")
    .bind(cleanText(body?.contest, 100))
    .first<{ id: number }>();
  if (!contest) return c.json({ error: "contest_not_found" }, 404);
  if (key.contest_id !== null && key.contest_id !== contest.id) return c.json({ error: "invalid_api_key" }, 401);

  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n,
       CAST((julianday(MIN(created_at)) - julianday('now', '-${CODE_TTL_MINUTES} minutes')) * 86400 AS INTEGER) + 1 AS wait
     FROM artist_login_codes
     WHERE email = ? AND created_at > datetime('now', '-${CODE_TTL_MINUTES} minutes')`,
  )
    .bind(email)
    .first<{ n: number; wait: number | null }>();
  if ((recent?.n ?? 0) >= MAX_CODES_PER_WINDOW) {
    return c.json({ error: "too_many_codes", retryAfter: Math.max(1, recent?.wait ?? 60) }, 429);
  }

  // Details typed on the form travel with the code and are saved when the
  // email is verified, so nothing is lost if the link opens in another browser.
  let pending: ProfileInput | null = null;
  if (body?.profile && typeof body.profile === "object") {
    const read = readProfile(body.profile);
    if ("error" in read) return c.json({ error: read.error }, 400);
    pending = read.profile;
  }
  let photo: { bytes: Uint8Array; ext: string } | null = null;
  if (typeof body?.photo === "string" && body.photo) {
    const bytes = decodeBase64(body.photo);
    if (!bytes || !bytes.byteLength) return c.json({ error: "invalid_photo" }, 400);
    if (bytes.byteLength > STATIC_LIMIT) return c.json({ error: "file_too_large", limitBytes: STATIC_LIMIT }, 413);
    const ext = detectPhoto(bytes);
    if (!ext) return c.json({ error: "unsupported_file_type", accepted: ["jpg", "png", "webp"] }, 415);
    photo = { bytes, ext };
  }

  const code = randomCode();
  const linkToken = randomToken(32);
  let pendingPhotoKey: string | null = null;
  if (photo) {
    pendingPhotoKey = `artists/pending/${randomToken(16)}.${photo.ext}`;
    await putPhoto(c, pendingPhotoKey, photo.bytes, photo.ext);
  }
  // X-Client-IP is set by the links Worker; it's only trusted because a valid key came with it.
  const ip = cleanText(c.req.header("x-client-ip"), 64) || null;
  await c.env.DB.batch([
    // A new code cancels any older unused one for the same address.
    c.env.DB.prepare(
      "UPDATE artist_login_codes SET used_at = datetime('now') WHERE email = ? AND used_at IS NULL",
    ).bind(email),
    c.env.DB.prepare(
      `INSERT INTO artist_login_codes
         (email, code_hmac, link_token_hash, contest_id, ip, pending_profile, pending_photo_key, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+${CODE_TTL_MINUTES} minutes'))`,
    ).bind(
      email,
      await hmacHex(c.env.ARTIST_CODE_SECRET, `${email}:${code}`),
      await sha256Hex(linkToken),
      contest.id,
      ip,
      pending ? JSON.stringify(pending) : null,
      pendingPhotoKey,
    ),
  ]);

  const artist = await c.env.DB.prepare("SELECT id, name FROM artists WHERE email = ?")
    .bind(email)
    .first<{ id: number; name: string }>();
  const link = key.signin_url ? `${key.signin_url.replace(/\/+$/, "")}/signin?t=${linkToken}` : null;
  const sent = await sendArtistEmail(c, {
    to: email,
    artistId: artist?.id ?? null,
    kind: "signin",
    subject: `Your UNBLOCKED code: ${spacedCode(code)}`,
    html: signinEmail(artist?.name || pending?.name || "", code, link, !artist && !!pending),
  });
  if (!sent) return c.json({ error: "email_failed" }, 502);

  // Same answer for new and known addresses, so it reveals nothing about who entered.
  return c.json(
    { expiresInSeconds: CODE_TTL_MINUTES * 60, resendAfterSeconds: RESEND_AFTER_SECONDS },
    202,
  );
});

type CodeRow = {
  id: number;
  email: string;
  code_hmac: string;
  attempts: number;
  pending_profile: string | null;
  pending_photo_key: string | null;
};

artists.post("/artists/sessions", requireKey, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!c.env.ARTIST_CODE_SECRET) return c.json({ error: "artist_signin_not_configured" }, 500);

  let row: CodeRow | null = null;
  if (typeof body?.token === "string" && body.token) {
    row = await c.env.DB.prepare(
      `SELECT id, email, code_hmac, attempts, pending_profile, pending_photo_key FROM artist_login_codes
       WHERE link_token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    )
      .bind(await sha256Hex(body.token))
      .first<CodeRow>();
    if (!row || row.attempts >= MAX_CODE_ATTEMPTS) return c.json({ error: "code_expired" }, 410);
  } else {
    const email = cleanText(body?.email, 200).toLowerCase();
    const code = String(body?.code ?? "").replace(/\D/g, "");
    if (!EMAIL_RE.test(email) || code.length !== 6) return c.json({ error: "invalid_code", attemptsLeft: null }, 400);

    row = await c.env.DB.prepare(
      `SELECT id, email, code_hmac, attempts, pending_profile, pending_photo_key FROM artist_login_codes
       WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now')
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(email)
      .first<CodeRow>();
    if (!row) return c.json({ error: "code_expired" }, 410);
    if (row.attempts >= MAX_CODE_ATTEMPTS) return c.json({ error: "code_locked" }, 423);

    const expected = await hmacHex(c.env.ARTIST_CODE_SECRET, `${email}:${code}`);
    if (expected !== row.code_hmac) {
      const attempts = row.attempts + 1;
      await c.env.DB.prepare("UPDATE artist_login_codes SET attempts = ? WHERE id = ?")
        .bind(attempts, row.id)
        .run();
      if (attempts >= MAX_CODE_ATTEMPTS) return c.json({ error: "code_locked" }, 423);
      return c.json({ error: "invalid_code", attemptsLeft: MAX_CODE_ATTEMPTS - attempts }, 400);
    }
  }

  // Use the code exactly once, even if two requests race.
  const used = await c.env.DB.prepare(
    "UPDATE artist_login_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL",
  )
    .bind(row.id)
    .run();
  if (!used.meta.changes) return c.json({ error: "code_expired" }, 410);

  // The profile is created at verification, never when a code is only requested.
  const existing = await c.env.DB.prepare("SELECT * FROM artists WHERE email = ?")
    .bind(row.email)
    .first<ArtistRow>();
  let artist =
    existing ||
    (await c.env.DB.prepare("INSERT INTO artists (email) VALUES (?) RETURNING *")
      .bind(row.email)
      .first<ArtistRow>())!;
  const applied = await applyPending(c, artist, row, !existing);
  if (applied.length) {
    artist = (await c.env.DB.prepare("SELECT * FROM artists WHERE id = ?").bind(artist.id).first<ArtistRow>())!;
  }

  const rawSession = randomToken(32);
  const session = await c.env.DB.prepare(
    `INSERT INTO artist_sessions (token_hash, artist_id, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, datetime('now', '+${SESSION_TTL_DAYS} days'), datetime('now'), ?)
     RETURNING expires_at`,
  )
    .bind(await sha256Hex(rawSession), artist.id, cleanText(c.req.header("x-client-user-agent"), 300) || null)
    .first<{ expires_at: string }>();

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE artists SET last_seen_at = datetime('now') WHERE id = ?").bind(artist.id),
    // Link earlier submissions made with this address (old form, other clients).
    c.env.DB.prepare(
      "UPDATE submissions SET artist_id = ? WHERE artist_id IS NULL AND lower(trim(artist_email)) = ?",
    ).bind(artist.id, artist.email),
    // Expired credentials are not records and can be purged, like the judge tables.
    c.env.DB.prepare("DELETE FROM artist_sessions WHERE expires_at < datetime('now')"),
  ]);
  await purgeOldCodes(c);

  return c.json(
    {
      session: rawSession,
      expiresAt: session?.expires_at,
      artist: profileJson(artist),
      isNew: !existing,
      applied,
    },
    201,
  );
});

/**
 * Saves the details sent with the code. A new account takes all of them. An
 * existing account only gets fields that are still empty, so someone who
 * requests a code for another person's address can't overwrite their profile
 * even if that person later uses the code. Returns the fields saved.
 */
async function applyPending(c: Ctx, artist: ArtistRow, row: CodeRow, isNew: boolean): Promise<string[]> {
  const applied: string[] = [];
  let pending: ProfileInput = {};
  try {
    pending = row.pending_profile ? JSON.parse(row.pending_profile) : {};
  } catch {
    pending = {};
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of ["name", "country", "instagram", "bio"] as const) {
    const value = pending[field];
    if (!value) continue;
    if (!isNew && artist[field]) continue;
    sets.push(`${field} = ?`);
    values.push(value);
    applied.push(field);
  }
  if (pending.termsVersion === TERMS_VERSION && artist.terms_version !== TERMS_VERSION) {
    sets.push("terms_version = ?", "terms_accepted_at = datetime('now')");
    values.push(TERMS_VERSION);
    applied.push("terms");
  }
  if (row.pending_photo_key && (isNew || !artist.photo_key)) {
    const object = await c.env.POSTERS.get(row.pending_photo_key);
    if (object) {
      const ext = row.pending_photo_key.split(".").pop() || "jpg";
      const key = `artists/${artist.id}/photo-${randomToken(8)}.${ext}`;
      await c.env.POSTERS.put(key, await object.arrayBuffer(), { httpMetadata: object.httpMetadata });
      sets.push("photo_key = ?");
      values.push(key);
      applied.push("photo");
    }
  }
  if (row.pending_photo_key) await c.env.POSTERS.delete(row.pending_photo_key);
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE artists SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values, artist.id)
      .run();
  }
  return applied;
}

/** Old codes and the photos sent with them aren't records and can go after a day. */
async function purgeOldCodes(c: Ctx) {
  const old = await c.env.DB.prepare(
    "SELECT pending_photo_key FROM artist_login_codes WHERE expires_at < datetime('now', '-1 day') AND pending_photo_key IS NOT NULL",
  ).all<{ pending_photo_key: string }>();
  const keys = (old.results || []).map((r) => r.pending_photo_key);
  if (keys.length) await c.env.POSTERS.delete(keys);
  await c.env.DB.prepare("DELETE FROM artist_login_codes WHERE expires_at < datetime('now', '-1 day')").run();
}

/** For the sign-in link's confirm page: checks the token without using it up. */
artists.get("/artists/sessions/check", requireKey, async (c) => {
  const token = c.req.query("token") || "";
  if (!token) return c.json({ error: "code_expired" }, 410);
  const row = await c.env.DB.prepare(
    `SELECT email FROM artist_login_codes
     WHERE link_token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') AND attempts < ${MAX_CODE_ATTEMPTS}`,
  )
    .bind(await sha256Hex(token))
    .first<{ email: string }>();
  if (!row) return c.json({ error: "code_expired" }, 410);
  return c.json({ email: row.email });
});

artists.delete("/artists/session", requireKey, requireArtist, async (c) => {
  await c.env.DB.prepare("DELETE FROM artist_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(c.req.header("x-artist-session") || ""))
    .run();
  return c.body(null, 204);
});

// ---------- profile ----------

artists.get("/me", requireKey, requireArtist, (c) => c.json(profileJson(c.get("artist"))));

artists.patch("/me", requireKey, requireArtist, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
  const artist = c.get("artist");
  const read = readProfile(body);
  if ("error" in read) return c.json({ error: read.error }, 400);
  const p = read.profile;

  const row = await c.env.DB.prepare(
    `UPDATE artists SET name = ?, country = ?, instagram = ?, bio = ?,
       terms_version = ?, terms_accepted_at = CASE WHEN ? THEN datetime('now') ELSE terms_accepted_at END,
       updated_at = datetime('now')
     WHERE id = ? RETURNING *`,
  )
    .bind(
      p.name ?? artist.name,
      p.country ?? artist.country,
      p.instagram ?? artist.instagram,
      p.bio ?? artist.bio,
      p.termsVersion ?? artist.terms_version,
      p.termsVersion && p.termsVersion !== artist.terms_version ? 1 : 0,
      artist.id,
    )
    .first<ArtistRow>();
  return c.json(profileJson(row!));
});

/** Profile photo: raw JPG, PNG or WebP body under 5 MB. Replaces any earlier photo. */
artists.put("/me/photo", requireKey, requireArtist, async (c) => {
  const length = Number(c.req.header("content-length") || 0);
  if (length > STATIC_LIMIT) return c.json({ error: "file_too_large", limitBytes: STATIC_LIMIT }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength) return c.json({ error: "file_required" }, 400);
  if (bytes.byteLength > STATIC_LIMIT) return c.json({ error: "file_too_large", limitBytes: STATIC_LIMIT }, 413);
  const ext = detectPhoto(bytes);
  if (!ext) return c.json({ error: "unsupported_file_type", accepted: ["jpg", "png", "webp"] }, 415);
  const artist = c.get("artist");
  const key = `artists/${artist.id}/photo-${randomToken(8)}.${ext}`;
  await putPhoto(c, key, bytes, ext);
  const row = await c.env.DB.prepare(
    "UPDATE artists SET photo_key = ?, updated_at = datetime('now') WHERE id = ? RETURNING *",
  )
    .bind(key, artist.id)
    .first<ArtistRow>();
  // The old photo isn't a contest record, so it can go.
  if (artist.photo_key) await c.env.POSTERS.delete(artist.photo_key);
  return c.json(profileJson(row!));
});

artists.get("/me/photo", requireKey, requireArtist, (c) => streamObject(c, c.get("artist").photo_key));

artists.delete("/me/photo", requireKey, requireArtist, async (c) => {
  const artist = c.get("artist");
  const row = await c.env.DB.prepare(
    "UPDATE artists SET photo_key = NULL, updated_at = datetime('now') WHERE id = ? RETURNING *",
  )
    .bind(artist.id)
    .first<ArtistRow>();
  if (artist.photo_key) await c.env.POSTERS.delete(artist.photo_key);
  return c.json(profileJson(row!));
});

// ---------- entries ----------

artists.use("/contests/:slug/me/*", requireKey, requireArtist, requireContest);

artists.get("/contests/:slug/me/entries", async (c) => {
  const contest = c.get("contest");
  const artist = c.get("artist");
  const rows = await c.env.DB.prepare(
    `SELECT e.*, s.public_id AS reference FROM entries e
     LEFT JOIN submissions s ON s.id = e.submission_id
     WHERE e.contest_id = ? AND e.artist_id = ? AND e.status != 'discarded'
     ORDER BY e.created_at`,
  )
    .bind(contest.id, artist.id)
    .all<EntryWithRef>();

  // Posters sent before artist accounts existed (matched by email). Read-only here.
  const legacy = await c.env.DB.prepare(
    `SELECT public_id, title, created_at, withdrawn_at, file_type FROM submissions
     WHERE contest_id = ? AND artist_id = ? AND entry_id IS NULL ORDER BY id`,
  )
    .bind(contest.id, artist.id)
    .all<{ public_id: string; title: string; created_at: string; withdrawn_at: string | null; file_type: string | null }>();

  return c.json({
    entries: rows.results.map(entryJson),
    earlierSubmissions: legacy.results.map((s) => ({
      reference: s.public_id,
      title: s.title,
      status: s.withdrawn_at ? "withdrawn" : "submitted",
      submittedAt: s.created_at,
      withdrawnAt: s.withdrawn_at,
    })),
    used: await usedCount(c),
    max: contest.max_entries_per_artist,
    contest: publicContest(contest),
  });
});

function readFields(input: unknown): { columns: { title?: string; concept?: string }; meta: Record<string, string> } {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const columns: { title?: string; concept?: string } = {};
  const meta: Record<string, string> = {};
  if (fields.title !== undefined) columns.title = cleanText(fields.title, FIELD_LIMITS.title);
  if (fields.concept !== undefined) columns.concept = cleanText(fields.concept, FIELD_LIMITS.concept);
  for (const key of META_FIELDS) {
    if (fields[key] !== undefined) meta[key] = cleanText(fields[key], 500);
  }
  return { columns, meta };
}

artists.post("/contests/:slug/me/entries", async (c) => {
  const contest = c.get("contest");
  const artist = c.get("artist");
  const body = await c.req.json().catch(() => null);
  const id = String(body?.id || "");
  if (!UUID_RE.test(id)) return c.json({ error: "invalid_entry_id" }, 400);

  // A create replayed from the offline queue returns the existing entry.
  const existing = await c.env.DB.prepare("SELECT artist_id, contest_id FROM entries WHERE id = ?")
    .bind(id)
    .first<{ artist_id: number; contest_id: number }>();
  if (existing) {
    if (existing.artist_id !== artist.id || existing.contest_id !== contest.id) {
      return c.json({ error: "entry_id_taken" }, 409);
    }
    return c.json({ entry: entryJson((await loadEntry(c, id))!) }, 200);
  }

  if (!acceptingSubmissions(contest)) return c.json({ error: "submissions_closed" }, 409);
  const drafts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM entries WHERE contest_id = ? AND artist_id = ? AND status = 'draft'",
  )
    .bind(contest.id, artist.id)
    .first<{ n: number }>();
  if ((drafts?.n ?? 0) >= MAX_DRAFTS_PER_CONTEST) return c.json({ error: "too_many_drafts" }, 409);

  const { columns, meta } = readFields(body?.fields);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO entries (id, contest_id, artist_id, title, concept, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, contest.id, artist.id, columns.title ?? "", columns.concept ?? "", JSON.stringify(meta)),
    eventStatement(c.env.DB, { entryId: id, contestId: contest.id, artistId: artist.id, type: "created", actor: "artist" }),
  ]);
  return c.json({ entry: entryJson((await loadEntry(c, id))!) }, 201);
});

artists.patch("/contests/:slug/me/entries/:id", async (c) => {
  const entry = await loadEntry(c, c.req.param("id"));
  if (!entry || entry.status === "discarded") return c.json({ error: "not_found" }, 404);
  if (entry.status !== "draft") return c.json({ error: "entry_locked", entry: entryJson(entry) }, 409);

  const ifMatch = Number(c.req.header("if-match"));
  if (!Number.isInteger(ifMatch)) return c.json({ error: "if_match_required" }, 428);
  if (ifMatch !== entry.version) return c.json({ error: "version_conflict", entry: entryJson(entry) }, 409);

  const body = await c.req.json().catch(() => null);
  const { columns, meta } = readFields(body?.fields);
  const metadata = { ...parseJsonObject(entry.metadata), ...meta };

  const updated = await c.env.DB.prepare(
    `UPDATE entries SET title = ?, concept = ?, metadata = ?, version = version + 1, updated_at = datetime('now')
     WHERE id = ? AND version = ? AND status = 'draft'`,
  )
    .bind(columns.title ?? entry.title, columns.concept ?? entry.concept, JSON.stringify(metadata), entry.id, ifMatch)
    .run();
  const fresh = (await loadEntry(c, entry.id))!;
  if (!updated.meta.changes) {
    return c.json({ error: fresh.status === "draft" ? "version_conflict" : "entry_locked", entry: entryJson(fresh) }, 409);
  }
  return c.json({ version: fresh.version, entry: entryJson(fresh) });
});

/** Reads a raw upload (body = file bytes, X-File-Name = URI-encoded name) and checks it. */
async function readUpload(c: Ctx) {
  const length = Number(c.req.header("content-length") || 0);
  if (length > MOTION_LIMIT) return { error: c.json({ error: "file_too_large", limitBytes: MOTION_LIMIT }, 413) };
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.byteLength) return { error: c.json({ error: "file_required" }, 400) };
  const detected = detectFileType(bytes);
  if (!detected) {
    return { error: c.json({ error: "unsupported_file_type", accepted: ["jpg", "png", "gif", "pdf", "mp4"] }, 415) };
  }
  if (bytes.byteLength > detected.limit) {
    return { error: c.json({ error: "file_too_large", limitBytes: detected.limit }, 413) };
  }
  let name = "";
  try {
    name = decodeURIComponent(c.req.header("x-file-name") || "");
  } catch {
    name = "";
  }
  name = name.replace(/[\r\n"]/g, "").trim().slice(0, 200) || `file.${detected.ext}`;
  return { bytes, detected, name };
}

async function draftForUpload(c: Ctx) {
  const entry = await loadEntry(c, c.req.param("id")!);
  if (!entry || entry.status === "discarded") return { error: c.json({ error: "not_found" }, 404) };
  if (entry.status !== "draft") return { error: c.json({ error: "entry_locked", entry: entryJson(entry) }, 409) };
  return { entry };
}

const draftPrefix = (contestId: number, entryId: string) => `drafts/contest-${contestId}/${entryId}/`;

artists.put("/contests/:slug/me/entries/:id/file", async (c) => {
  const found = await draftForUpload(c);
  if (found.error) return found.error;
  const upload = await readUpload(c);
  if (upload.error) return upload.error;
  const { entry } = found;
  const contest = c.get("contest");

  // Every upload gets its own key, so a replaced file is kept, not overwritten.
  const key = `${draftPrefix(contest.id, entry.id)}poster-${randomToken(4)}.${upload.detected.ext}`;
  await c.env.POSTERS.put(key, upload.bytes, { httpMetadata: { contentType: upload.detected.mime } });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE entries SET file_key = ?, file_type = ?, file_name = ?, file_size = ?,
         version = version + 1, updated_at = datetime('now') WHERE id = ?`,
    ).bind(key, upload.detected.mime, upload.name, upload.bytes.byteLength, entry.id),
    eventStatement(c.env.DB, {
      entryId: entry.id,
      contestId: contest.id,
      artistId: entry.artist_id,
      type: entry.file_key ? "file_replaced" : "file_added",
      actor: "artist",
      detail: { name: upload.name, type: upload.detected.mime, size: upload.bytes.byteLength, previousKey: entry.file_key },
    }),
  ]);
  const fresh = (await loadEntry(c, entry.id))!;
  return c.json({ file: entryJson(fresh).file, version: fresh.version, entry: entryJson(fresh) });
});

artists.delete("/contests/:slug/me/entries/:id/file", async (c) => {
  const found = await draftForUpload(c);
  if (found.error) return found.error;
  const { entry } = found;
  if (entry.file_key) {
    // The file stays in R2; only the link from the draft is removed.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE entries SET file_key = NULL, file_type = NULL, file_name = NULL, file_size = NULL,
           version = version + 1, updated_at = datetime('now') WHERE id = ?`,
      ).bind(entry.id),
      eventStatement(c.env.DB, {
        entryId: entry.id,
        contestId: entry.contest_id,
        artistId: entry.artist_id,
        type: "file_removed",
        actor: "artist",
        detail: { key: entry.file_key },
      }),
    ]);
  }
  const fresh = (await loadEntry(c, entry.id))!;
  return c.json({ version: fresh.version, entry: entryJson(fresh) });
});

async function streamObject(c: Ctx, key: string | null | undefined, name?: string | null) {
  if (!key) return c.json({ error: "not_found" }, 404);
  const object = await c.env.POSTERS.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline${name ? `; filename="${name.replace(/[^\w.\- ]/g, "_")}"` : ""}`,
      etag: object.httpEtag,
    },
  });
}

/** Lets the list show a thumbnail on another device. Works for submitted entries too. */
artists.get("/contests/:slug/me/entries/:id/file", async (c) => {
  const entry = await loadEntry(c, c.req.param("id"));
  if (!entry) return c.json({ error: "not_found" }, 404);
  return streamObject(c, entry.file_key, entry.file_name);
});

artists.post("/contests/:slug/me/entries/:id/assets", async (c) => {
  const found = await draftForUpload(c);
  if (found.error) return found.error;
  const { entry } = found;
  const assets = parseAssets(entry.assets);
  if (assets.length >= MAX_ASSETS) return c.json({ error: "too_many_assets", max: MAX_ASSETS }, 409);
  const upload = await readUpload(c);
  if (upload.error) return upload.error;

  const id = randomToken(4);
  const key = `${draftPrefix(entry.contest_id, entry.id)}asset-${id}.${upload.detected.ext}`;
  await c.env.POSTERS.put(key, upload.bytes, { httpMetadata: { contentType: upload.detected.mime } });
  const asset: EntryAsset = { id, key, type: upload.detected.mime, name: upload.name, size: upload.bytes.byteLength };
  assets.push(asset);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE entries SET assets = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?",
    ).bind(JSON.stringify(assets), entry.id),
    eventStatement(c.env.DB, {
      entryId: entry.id,
      contestId: entry.contest_id,
      artistId: entry.artist_id,
      type: "file_added",
      actor: "artist",
      detail: { asset: true, id, name: asset.name, type: asset.type, size: asset.size },
    }),
  ]);
  const fresh = (await loadEntry(c, entry.id))!;
  const json = entryJson(fresh);
  return c.json({ asset: json.assets.find((a) => a.id === id), assets: json.assets, version: fresh.version, entry: json }, 201);
});

artists.delete("/contests/:slug/me/entries/:id/assets/:assetId", async (c) => {
  const found = await draftForUpload(c);
  if (found.error) return found.error;
  const { entry } = found;
  const assets = parseAssets(entry.assets);
  const removed = assets.find((a) => a.id === c.req.param("assetId"));
  if (removed) {
    // Unlinked from the entry; the file stays in R2.
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE entries SET assets = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?",
      ).bind(JSON.stringify(assets.filter((a) => a !== removed)), entry.id),
      eventStatement(c.env.DB, {
        entryId: entry.id,
        contestId: entry.contest_id,
        artistId: entry.artist_id,
        type: "file_removed",
        actor: "artist",
        detail: { asset: true, id: removed.id, key: removed.key },
      }),
    ]);
  }
  const fresh = (await loadEntry(c, entry.id))!;
  const json = entryJson(fresh);
  return c.json({ assets: json.assets, version: fresh.version, entry: json });
});

artists.get("/contests/:slug/me/entries/:id/assets/:assetId", async (c) => {
  const entry = await loadEntry(c, c.req.param("id"));
  if (!entry) return c.json({ error: "not_found" }, 404);
  const asset = parseAssets(entry.assets).find((a) => a.id === c.req.param("assetId"));
  return streamObject(c, asset?.key, asset?.name);
});

// ---------- submit / withdraw / restore / discard ----------

type SubmitResult =
  | { id: string; reference: string; title: string; alreadySubmitted: boolean }
  | { id: string; error: string; status: number; missing?: string[] };

async function newPublicId(c: Ctx, slug: string): Promise<string> {
  // 3 random bytes can collide; check first and retry (the UNIQUE index is the backstop).
  for (let i = 0; i < 3; i++) {
    const id = publicSubmissionId(slug);
    const taken = await c.env.DB.prepare("SELECT 1 FROM submissions WHERE public_id = ?").bind(id).first();
    if (!taken) return id;
  }
  return publicSubmissionId(slug);
}

async function copyObject(c: Ctx, from: string, to: string): Promise<void> {
  const object = await c.env.POSTERS.get(from);
  if (!object) throw new Error(`missing_object:${from}`);
  await c.env.POSTERS.put(to, await object.arrayBuffer(), { httpMetadata: object.httpMetadata });
}

async function submitEntry(c: Ctx, entryId: string, used: { n: number }): Promise<SubmitResult> {
  const contest = c.get("contest");
  const artist = c.get("artist");
  const entry = await loadEntry(c, entryId);
  if (!entry || entry.status === "discarded") return { id: entryId, error: "not_found", status: 404 };
  // Pressing Submit twice returns the same reference instead of a duplicate.
  if (entry.status === "submitted" && entry.reference) {
    return { id: entryId, reference: entry.reference, title: entry.title, alreadySubmitted: true };
  }
  if (entry.status !== "draft") return { id: entryId, error: "entry_locked", status: 409 };

  const missing = [!entry.title && "title", !entry.file_key && "file"].filter(Boolean) as string[];
  if (missing.length) return { id: entryId, error: "entry_incomplete", status: 422, missing };

  const max = contest.max_entries_per_artist;
  if (max !== null && used.n >= max) return { id: entryId, error: "submission_limit_reached", status: 409 };

  // Copy the draft files to today's naming. The draft copies are kept.
  const publicId = await newPublicId(c, contest.slug);
  const ext = (entry.file_key!.split(".").pop() || "bin").toLowerCase();
  const fileKey = `contest-${contest.id}/${publicId}.${ext}`;
  const assets = parseAssets(entry.assets);
  const assetKeys: string[] = [];
  try {
    await copyObject(c, entry.file_key!, fileKey);
    for (const [index, asset] of assets.entries()) {
      const key = `contest-${contest.id}/${publicId}-asset-${index + 1}.${(asset.key.split(".").pop() || "bin").toLowerCase()}`;
      await copyObject(c, asset.key, key);
      assetKeys.push(key);
    }
  } catch (err) {
    console.error("submit_copy_failed", err);
    return { id: entryId, error: "file_missing", status: 409 };
  }

  const meta = parseJsonObject(entry.metadata);
  const metadata: Record<string, string> = {};
  for (const key of META_FIELDS) if (typeof meta[key] === "string" && meta[key]) metadata[key] = meta[key] as string;
  if (assetKeys.length) metadata.asset_keys = JSON.stringify(assetKeys);

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO submissions
           (contest_id, public_id, title, artist_name, artist_email, country, concept, metadata,
            file_key, file_type, artist_id, entry_id, instagram, consent_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        contest.id,
        publicId,
        entry.title,
        artist.name,
        artist.email,
        artist.country,
        entry.concept,
        JSON.stringify(metadata),
        fileKey,
        entry.file_type,
        artist.id,
        entry.id,
        artist.instagram,
        CONSENT_VERSION,
      ),
      c.env.DB.prepare(
        `UPDATE entries SET status = 'submitted',
           submission_id = (SELECT id FROM submissions WHERE entry_id = ?),
           submitted_at = datetime('now'), version = version + 1, updated_at = datetime('now')
         WHERE id = ? AND status = 'draft'`,
      ).bind(entry.id, entry.id),
      c.env.DB.prepare(
        `INSERT INTO entry_events (entry_id, submission_id, contest_id, artist_id, type, actor, detail)
         VALUES (?, (SELECT id FROM submissions WHERE entry_id = ?), ?, ?, 'submitted', 'artist', ?)`,
      ).bind(entry.id, entry.id, contest.id, artist.id, JSON.stringify({ consentVersion: CONSENT_VERSION, publicId })),
    ]);
  } catch (err) {
    // A concurrent submit of the same entry hits the unique entry_id index.
    const again = await loadEntry(c, entryId);
    if (again?.status === "submitted" && again.reference) {
      return { id: entryId, reference: again.reference, title: again.title, alreadySubmitted: true };
    }
    console.error("submit_failed", err);
    return { id: entryId, error: "submit_failed", status: 500 };
  }
  used.n += 1;
  return { id: entryId, reference: publicId, title: entry.title, alreadySubmitted: false };
}

async function submitPreflight(c: Ctx, consentVersion: unknown): Promise<Response | null> {
  const contest = c.get("contest");
  const artist = c.get("artist");
  if (!acceptingSubmissions(contest)) return c.json({ error: "submissions_closed", status: contest.status }, 409);
  if (consentVersion !== CONSENT_VERSION) {
    return c.json({ error: "consent_outdated", consentVersion: CONSENT_VERSION }, 409);
  }
  if (!artist.name || !artist.country) return c.json({ error: "profile_incomplete" }, 422);
  if (artist.terms_version !== TERMS_VERSION) {
    return c.json({ error: "terms_not_accepted", termsVersion: TERMS_VERSION }, 422);
  }
  return null;
}

function sendReceipt(c: Ctx, results: SubmitResult[]) {
  const fresh = results.filter((r): r is Extract<SubmitResult, { reference: string }> => "reference" in r && !r.alreadySubmitted);
  if (!fresh.length) return;
  const artist = c.get("artist");
  const mail = receiptEmail(artist, c.get("contest"), fresh, c.get("apiKey"));
  later(c, sendArtistEmail(c, { to: artist.email, artistId: artist.id, kind: "receipt", ...mail }));
}

/** Submit several ready drafts in one press. One receipt email per press. */
artists.post("/contests/:slug/me/submissions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const blocked = await submitPreflight(c, body?.consentVersion);
  if (blocked) return blocked;
  const ids: string[] = Array.isArray(body?.entryIds) ? [...new Set(body.entryIds.map(String))] as string[] : [];
  if (!ids.length || ids.length > MAX_DRAFTS_PER_CONTEST) return c.json({ error: "entry_ids_required" }, 400);

  const used = { n: await usedCount(c) };
  const results: SubmitResult[] = [];
  for (const id of ids) results.push(await submitEntry(c, id, used));
  sendReceipt(c, results);

  return c.json({
    results: results.map((r) =>
      "reference" in r
        ? { id: r.id, reference: r.reference, alreadySubmitted: r.alreadySubmitted }
        : { id: r.id, error: r.error, ...(r.missing ? { missing: r.missing } : {}) },
    ),
    used: used.n,
    max: c.get("contest").max_entries_per_artist,
  });
});

artists.post("/contests/:slug/me/entries/:id/submit", async (c) => {
  const body = await c.req.json().catch(() => null);
  const blocked = await submitPreflight(c, body?.consentVersion);
  if (blocked) return blocked;
  const result = await submitEntry(c, c.req.param("id"), { n: await usedCount(c) });
  sendReceipt(c, [result]);
  if ("reference" in result) return c.json({ reference: result.reference }, result.alreadySubmitted ? 200 : 201);
  return c.json({ error: result.error, ...(result.missing ? { missing: result.missing } : {}) }, result.status as 404);
});

artists.post("/contests/:slug/me/entries/:id/withdraw", async (c) => {
  const contest = c.get("contest");
  const entry = await loadEntry(c, c.req.param("id"));
  if (!entry || entry.status === "discarded") return c.json({ error: "not_found" }, 404);
  if (entry.status === "withdrawn") return c.json({ entry: entryJson(entry) });
  if (entry.status !== "submitted" || !entry.submission_id) return c.json({ error: "entry_locked" }, 409);
  if (!withdrawalsOpen(contest)) return c.json({ error: "withdrawals_closed" }, 409);

  const body = await c.req.json().catch(() => null);
  const reason = cleanText(body?.reason, 500) || null;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE submissions SET withdrawn_at = datetime('now') WHERE id = ? AND withdrawn_at IS NULL",
    ).bind(entry.submission_id),
    c.env.DB.prepare(
      `UPDATE entries SET status = 'withdrawn', withdrawn_at = datetime('now'),
         version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'submitted'`,
    ).bind(entry.id),
    eventStatement(c.env.DB, {
      entryId: entry.id,
      submissionId: entry.submission_id,
      contestId: contest.id,
      artistId: entry.artist_id,
      type: "withdrawn",
      actor: "artist",
      reason,
    }),
  ]);

  const artist = c.get("artist");
  const mail = withdrawnEmail(artist, contest, entry.title, entry.reference || "", c.get("apiKey"));
  later(c, sendArtistEmail(c, { to: artist.email, artistId: artist.id, kind: "withdrawn", ...mail }));
  return c.json({ entry: entryJson((await loadEntry(c, entry.id))!) });
});

artists.post("/contests/:slug/me/entries/:id/restore", async (c) => {
  const contest = c.get("contest");
  const entry = await loadEntry(c, c.req.param("id"));
  if (!entry || entry.status === "discarded") return c.json({ error: "not_found" }, 404);
  if (entry.status === "submitted") return c.json({ entry: entryJson(entry) });
  if (entry.status !== "withdrawn" || !entry.submission_id) return c.json({ error: "entry_locked" }, 409);
  if (!acceptingSubmissions(contest)) return c.json({ error: "submissions_closed" }, 409);
  const max = contest.max_entries_per_artist;
  if (max !== null && (await usedCount(c)) >= max) return c.json({ error: "submission_limit_reached" }, 409);

  // Same reference as before; it goes back into the judging pool.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE submissions SET withdrawn_at = NULL WHERE id = ?").bind(entry.submission_id),
    c.env.DB.prepare(
      `UPDATE entries SET status = 'submitted', withdrawn_at = NULL,
         version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'withdrawn'`,
    ).bind(entry.id),
    eventStatement(c.env.DB, {
      entryId: entry.id,
      submissionId: entry.submission_id,
      contestId: contest.id,
      artistId: entry.artist_id,
      type: "restored",
      actor: "artist",
    }),
  ]);
  return c.json({ entry: entryJson((await loadEntry(c, entry.id))!) });
});

/** Soft delete for drafts only. Submitted entries use withdraw. */
artists.delete("/contests/:slug/me/entries/:id", async (c) => {
  const entry = await loadEntry(c, c.req.param("id"));
  if (!entry) return c.json({ error: "not_found" }, 404);
  if (entry.status === "discarded") return c.json({ ok: true });
  if (entry.status !== "draft") return c.json({ error: "entry_locked" }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE entries SET status = 'discarded', discarded_at = datetime('now'),
         version = version + 1, updated_at = datetime('now') WHERE id = ? AND status = 'draft'`,
    ).bind(entry.id),
    eventStatement(c.env.DB, {
      entryId: entry.id,
      contestId: entry.contest_id,
      artistId: entry.artist_id,
      type: "discarded",
      actor: "artist",
    }),
  ]);
  return c.json({ ok: true });
});
