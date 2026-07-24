import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, ContestRow } from "../types";
import { publicSubmissionId, sha256Hex } from "../util";

/**
 * Public API for the external submission system (spice-lake figma site).
 * Authenticated with API keys created in the admin console — never with
 * Cloudflare Access. See docs/external-api.md.
 */
export const external = new Hono<AppEnv>();

const STATIC_LIMIT = 5 * 1024 * 1024; // jpg/png/pdf
const MOTION_LIMIT = 20 * 1024 * 1024; // gif/mp4
const MAX_ASSETS = 3;

type Detected = { mime: string; ext: string; limit: number };

function detectFileType(bytes: Uint8Array): Detected | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", limit: STATIC_LIMIT };
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return { mime: "image/png", ext: "png", limit: STATIC_LIMIT };
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ext: "gif", limit: MOTION_LIMIT };
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf", limit: STATIC_LIMIT };
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) return { mime: "video/mp4", ext: "mp4", limit: MOTION_LIMIT };
  return null;
}

async function authenticateKey(c: Context<AppEnv>, contestId: number): Promise<boolean> {
  const header = c.req.header("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7) : c.req.header("x-api-key") || "";
  if (!raw) return false;
  const hash = await sha256Hex(raw);
  const key = await c.env.DB.prepare(
    `SELECT id FROM api_keys
     WHERE key_hash = ? AND revoked_at IS NULL AND (contest_id IS NULL OR contest_id = ?)`,
  )
    .bind(hash, contestId)
    .first();
  return Boolean(key);
}

external.get("/contests/:slug", async (c) => {
  const contest = await c.env.DB.prepare(
    "SELECT id, slug, name, theme, description, status FROM contests WHERE slug = ?",
  )
    .bind(c.req.param("slug"))
    .first<ContestRow>();
  if (!contest || contest.status === "archived") return c.json({ error: "not_found" }, 404);
  return c.json({
    slug: contest.slug,
    name: contest.name,
    theme: contest.theme,
    description: contest.description,
    acceptingSubmissions: contest.status === "open",
  });
});

external.post("/contests/:slug/submissions", async (c) => {
  const contest = await c.env.DB.prepare("SELECT * FROM contests WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<ContestRow>();
  if (!contest) return c.json({ error: "not_found" }, 404);

  if (!(await authenticateKey(c, contest.id))) {
    return c.json({ error: "invalid_api_key" }, 401);
  }
  if (contest.status !== "open") {
    return c.json({ error: "submissions_closed", status: contest.status }, 409);
  }

  const contentLength = Number(c.req.header("content-length") || 0);
  if (contentLength > MOTION_LIMIT + MAX_ASSETS * MOTION_LIMIT + 1024 * 1024) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return c.json({ error: "expected_multipart_form_data" }, 400);
  }

  const text = (name: string, max = 500) => String(form.get(name) || "").trim().slice(0, max);
  const title = text("title", 200);
  if (!title) return c.json({ error: "title_required" }, 400);

  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectFileType(fileBytes);
  if (!detected) return c.json({ error: "unsupported_file_type", accepted: ["jpg", "png", "gif", "pdf", "mp4"] }, 415);
  if (fileBytes.byteLength > detected.limit) {
    return c.json({ error: "file_too_large", limitBytes: detected.limit }, 413);
  }

  const publicId = publicSubmissionId(contest.slug);
  const fileKey = `contest-${contest.id}/${publicId}.${detected.ext}`;

  // Optional supporting assets (same accepted types/limits).
  const assetKeys: string[] = [];
  const assets = form.getAll("assets").filter((a): a is File => a instanceof File);
  if (assets.length > MAX_ASSETS) return c.json({ error: "too_many_assets", max: MAX_ASSETS }, 400);
  const assetUploads: { key: string; bytes: Uint8Array; mime: string }[] = [];
  for (const [index, asset] of assets.entries()) {
    const bytes = new Uint8Array(await asset.arrayBuffer());
    const kind = detectFileType(bytes);
    if (!kind) return c.json({ error: "unsupported_asset_type", asset: asset.name }, 415);
    if (bytes.byteLength > kind.limit) {
      return c.json({ error: "asset_too_large", asset: asset.name, limitBytes: kind.limit }, 413);
    }
    const key = `contest-${contest.id}/${publicId}-asset-${index + 1}.${kind.ext}`;
    assetUploads.push({ key, bytes, mime: kind.mime });
    assetKeys.push(key);
  }

  const metadata: Record<string, string> = {};
  const metadataFields = [
    "year_designed",
    "designed_for",
    "client_name",
    "creation_method",
    "materials_used",
    "digital_programs",
    "printing_method",
    "age",
  ];
  for (const field of metadataFields) {
    const value = text(field);
    if (value) metadata[field] = value;
  }
  if (assetKeys.length) metadata.asset_keys = JSON.stringify(assetKeys);

  await c.env.POSTERS.put(fileKey, fileBytes, { httpMetadata: { contentType: detected.mime } });
  for (const upload of assetUploads) {
    await c.env.POSTERS.put(upload.key, upload.bytes, { httpMetadata: { contentType: upload.mime } });
  }

  await c.env.DB.prepare(
    `INSERT INTO submissions
       (contest_id, public_id, title, artist_name, artist_email, country, concept, metadata, file_key, file_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      contest.id,
      publicId,
      title,
      text("artist_name", 200),
      text("artist_email", 200),
      text("country", 100),
      text("concept", 4000),
      JSON.stringify(metadata),
      fileKey,
      detected.mime,
    )
    .run();

  return c.json({ id: publicId, status: "submitted" }, 201);
});
