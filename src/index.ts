import { Hono } from "hono";
import type { AppEnv } from "./types";
import { csrfGuard, requireUser } from "./auth";
import { auth } from "./routes/auth";
import { portal } from "./routes/portal";
import { admin } from "./routes/admin";
import { external } from "./routes/external";
import { artists } from "./routes/artists";
import { docs } from "./routes/docs";

const app = new Hono<AppEnv>();

// External submission API: API-key auth, no cookies.
app.route("/api/v1", external);
// Artist accounts, synced drafts and withdrawal (API key + X-Artist-Session).
app.route("/api/v1", artists);

// Public API docs, no auth.
app.route("/", docs);

// Magic-link sign-in/out — registered before the session gate below.
app.route("/", auth);

// Portal + admin APIs: session-authenticated, CSRF-guarded.
app.use("/api/*", csrfGuard, requireUser);
app.route("/api", portal);
app.route("/api/admin", admin);

// Poster files from R2. Keys look like "contest-<id>/<public-id>.<ext>";
// judges may only fetch files for contests they are on the panel of, and only
// for entries still in the judging pool (not withdrawn or disqualified).
// Staff can open every file. Draft files live under drafts/ and never match.
app.get("/files/*", csrfGuard, requireUser, async (c) => {
  const key = c.req.path.replace(/^\/files\//, "");
  const match = /^contest-(\d+)\//.exec(key);
  if (!match) return c.json({ error: "not_found" }, 404);

  const user = c.get("user");
  if (user.role === "judge") {
    const onPanel = await c.env.DB.prepare(
      "SELECT 1 AS ok FROM contest_judges WHERE contest_id = ? AND user_id = ?",
    )
      .bind(Number(match[1]), user.id)
      .first();
    if (!onPanel) return c.json({ error: "forbidden" }, 403);
    const inPool = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM judging_pool
       WHERE contest_id = ? AND (file_key = ? OR instr(metadata, ?) > 0)`,
    )
      // Supporting files are listed in metadata.asset_keys (a JSON string).
      .bind(Number(match[1]), key, key)
      .first();
    if (!inPool) return c.json({ error: "forbidden" }, 403);
  }

  const object = await c.env.POSTERS.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      etag: object.httpEtag,
    },
  });
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
