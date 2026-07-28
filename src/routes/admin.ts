import { Hono } from "hono";
import type { AppEnv, ContestRow, ContestStatus, SubmissionRow } from "../types";
import { CONTEST_STATUSES } from "../types";
import { requireRole } from "../auth";
import { emailShell, renderMarkdown, sendEmail } from "../email";
import { computeResults } from "../results";
import { parseCriteria, parseJsonObject, randomToken, sha256Hex, slugify } from "../util";

export const admin = new Hono<AppEnv>();

admin.use("*", requireRole("manager"));

async function getContest(c: { env: AppEnv["Bindings"] }, id: string): Promise<ContestRow | null> {
  return c.env.DB.prepare("SELECT * FROM contests WHERE id = ?").bind(Number(id)).first<ContestRow>();
}

admin.get("/contests", async (c) => {
  const contests = await c.env.DB.prepare(
    `SELECT ct.*,
       (SELECT COUNT(*) FROM submissions s WHERE s.contest_id = ct.id AND s.status = 'submitted') AS submission_count,
       (SELECT COUNT(*) FROM contest_judges cj WHERE cj.contest_id = ct.id) AS judge_count
     FROM contests ct ORDER BY ct.created_at DESC`,
  ).all();
  return c.json({ contests: contests.results });
});

admin.post("/contests", async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = String(body?.name || "").trim();
  if (!name) return c.json({ error: "name_required" }, 400);

  const slug = slugify(String(body?.slug || name));
  if (!slug) return c.json({ error: "invalid_slug" }, 400);

  const criteria = Array.isArray(body?.criteria)
    ? body.criteria.map((s: unknown) => String(s).trim()).filter(Boolean)
    : null;

  const existing = await c.env.DB.prepare("SELECT id FROM contests WHERE slug = ?").bind(slug).first();
  if (existing) return c.json({ error: "slug_taken" }, 409);

  const row = await c.env.DB.prepare(
    `INSERT INTO contests (slug, name, theme, description, criteria)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      slug,
      name,
      String(body?.theme || "").trim(),
      String(body?.description || "").trim(),
      JSON.stringify(criteria && criteria.length ? criteria : parseCriteria("")),
    )
    .first<ContestRow>();

  return c.json({ contest: row }, 201);
});

admin.patch("/contests/:id", async (c) => {
  const contest = await getContest(c, c.req.param("id"));
  if (!contest) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_request" }, 400);

  const nextStatus = body.status as ContestStatus | undefined;
  if (nextStatus !== undefined) {
    if (!CONTEST_STATUSES.includes(nextStatus)) return c.json({ error: "invalid_status" }, 400);
    if (nextStatus === "round2") {
      const advanced = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM submissions WHERE contest_id = ? AND advanced = 1 AND status = 'submitted'",
      )
        .bind(contest.id)
        .first<{ n: number }>();
      if (!advanced?.n) return c.json({ error: "no_advanced_submissions" }, 409);
    }
  }

  const name = body.name !== undefined ? String(body.name).trim() : contest.name;
  if (!name) return c.json({ error: "name_required" }, 400);
  const criteria = Array.isArray(body.criteria)
    ? JSON.stringify(body.criteria.map((s: unknown) => String(s).trim()).filter(Boolean))
    : contest.criteria;

  const row = await c.env.DB.prepare(
    `UPDATE contests SET name = ?, theme = ?, description = ?, criteria = ?, status = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(
      name,
      body.theme !== undefined ? String(body.theme).trim() : contest.theme,
      body.description !== undefined ? String(body.description).trim() : contest.description,
      criteria,
      nextStatus ?? contest.status,
      contest.id,
    )
    .first<ContestRow>();

  return c.json({ contest: row });
});

admin.get("/contests/:id", async (c) => {
  const contest = await getContest(c, c.req.param("id"));
  if (!contest) return c.json({ error: "not_found" }, 404);
  const criteria = parseCriteria(contest.criteria);

  const judges = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, cj.added_at,
       (SELECT COUNT(*) FROM round1_votes v JOIN submissions s ON s.id = v.submission_id
        WHERE s.contest_id = ? AND v.judge_id = u.id) AS round1_votes,
       (SELECT COUNT(*) FROM round2_ratings r JOIN submissions s ON s.id = r.submission_id
        WHERE s.contest_id = ? AND r.judge_id = u.id AND s.advanced = 1) AS round2_ratings,
       (SELECT created_at FROM invite_emails ie WHERE ie.user_id = u.id AND ie.status = 'sent'
        ORDER BY ie.id DESC LIMIT 1) AS invite_sent_at
     FROM contest_judges cj JOIN users u ON u.id = cj.user_id
     WHERE cj.contest_id = ? ORDER BY u.email`,
  )
    .bind(contest.id, contest.id, contest.id)
    .all();

  const submissions = await c.env.DB.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM round1_votes v WHERE v.submission_id = s.id AND v.decision = 'yes') AS yes_votes,
       (SELECT COUNT(*) FROM round1_votes v WHERE v.submission_id = s.id AND v.decision = 'no') AS no_votes,
       (SELECT COUNT(*) FROM round2_ratings r WHERE r.submission_id = s.id) AS ratings_count
     FROM submissions s WHERE s.contest_id = ? ORDER BY s.id`,
  )
    .bind(contest.id)
    .all<SubmissionRow & { yes_votes: number; no_votes: number; ratings_count: number }>();

  return c.json({
    contest: { ...contest, criteria },
    judges: judges.results,
    submissions: submissions.results.map((s) => ({
      ...s,
      metadata: parseJsonObject(s.metadata),
      fileUrl: s.file_key ? `/files/${s.file_key}` : null,
    })),
    results: await computeResults(c.env, contest.id, criteria),
  });
});

admin.post("/contests/:id/judges", async (c) => {
  const contest = await getContest(c, c.req.param("id"));
  if (!contest) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid_email" }, 400);

  const existing = await c.env.DB.prepare("SELECT id, email, name, role FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: number }>();
  const user =
    existing ||
    (await c.env.DB.prepare(
      "INSERT INTO users (email, name, role) VALUES (?, ?, 'judge') RETURNING id, email, name, role",
    )
      .bind(email, String(body?.name || "").trim())
      .first<{ id: number }>());

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO contest_judges (contest_id, user_id) VALUES (?, ?)",
  )
    .bind(contest.id, user!.id)
    .run();

  const invited = await c.env.DB.prepare(
    "SELECT 1 FROM invite_emails WHERE user_id = ? AND status = 'sent'",
  )
    .bind(user!.id)
    .first();

  return c.json({ ok: true, user, isNewUser: !existing, inviteSent: Boolean(invited) }, 201);
});

admin.delete("/contests/:id/judges/:userId", async (c) => {
  const contest = await getContest(c, c.req.param("id"));
  if (!contest) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM contest_judges WHERE contest_id = ? AND user_id = ?")
    .bind(contest.id, Number(c.req.param("userId")))
    .run();
  return c.json({ ok: true });
});

admin.post("/contests/:id/advance", async (c) => {
  const contest = await getContest(c, c.req.param("id"));
  if (!contest) return c.json({ error: "not_found" }, 404);
  if (!["round1", "round2"].includes(contest.status)) {
    return c.json({ error: "advance_only_during_judging" }, 409);
  }

  const body = await c.req.json().catch(() => null);
  const ids: number[] = Array.isArray(body?.submissionIds)
    ? body.submissionIds.map(Number).filter(Number.isInteger)
    : [];

  await c.env.DB.prepare("UPDATE submissions SET advanced = 0 WHERE contest_id = ?")
    .bind(contest.id)
    .run();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    await c.env.DB.prepare(
      `UPDATE submissions SET advanced = 1
       WHERE contest_id = ? AND status = 'submitted' AND id IN (${placeholders})`,
    )
      .bind(contest.id, ...ids)
      .run();
  }
  return c.json({ ok: true, advanced: ids.length });
});

admin.post("/submissions/:id/status", async (c) => {
  const body = await c.req.json().catch(() => null);
  const status = body?.status;
  if (!["submitted", "disqualified"].includes(status)) return c.json({ error: "invalid_status" }, 400);
  const result = await c.env.DB.prepare("UPDATE submissions SET status = ? WHERE id = ?")
    .bind(status, Number(c.req.param("id")))
    .run();
  if (!result.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

admin.get("/contests/:id/export.csv", async (c) => {
  const contest = await getContest(c, c.req.param("id"));
  if (!contest) return c.json({ error: "not_found" }, 404);
  const criteria = parseCriteria(contest.criteria);
  const results = await computeResults(c.env, contest.id, criteria);

  const quote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["rank", "id", "title", "artist", "country", "average", "judges_rated", ...criteria];
  const lines = [header.map(quote).join(",")];
  results.forEach((r, i) => {
    lines.push(
      [
        i + 1,
        r.publicId,
        r.title,
        r.artistName,
        r.country,
        r.average?.toFixed(2) ?? "",
        r.judgesRated,
        ...criteria.map((crit) => r.perCriterion[crit]?.toFixed(2) ?? ""),
      ]
        .map(quote)
        .join(","),
    );
  });

  return c.body(lines.join("\n"), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${contest.slug}-results.csv"`,
  });
});

// ---- admin-only: user + API key management ----

admin.get("/users", requireRole("admin"), async (c) => {
  const users = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_seen_at,
       (SELECT created_at FROM invite_emails ie WHERE ie.user_id = u.id AND ie.status = 'sent'
        ORDER BY ie.id DESC LIMIT 1) AS invite_sent_at
     FROM users u ORDER BY u.role, u.email`,
  ).all();
  return c.json({ users: users.results });
});

admin.post("/users", requireRole("admin"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const role = body?.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "invalid_email" }, 400);
  if (!["admin", "manager", "judge"].includes(role)) return c.json({ error: "invalid_role" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();

  const user = await c.env.DB.prepare(
    `INSERT INTO users (email, name, role) VALUES (?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET role = excluded.role,
       name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END
     RETURNING id, email, name, role`,
  )
    .bind(email, String(body?.name || "").trim(), role)
    .first<{ id: number }>();

  const invited = await c.env.DB.prepare(
    "SELECT 1 FROM invite_emails WHERE user_id = ? AND status = 'sent'",
  )
    .bind(user!.id)
    .first();

  return c.json({ user, isNewUser: !existing, inviteSent: Boolean(invited) }, 201);
});

admin.post("/users/:id/invite-email", async (c) => {
  const target = await c.env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .first<{ id: number; email: string }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => null);
  const subject = String(body?.subject || "").trim().slice(0, 200);
  const message = String(body?.body || "").trim().slice(0, 5000);
  if (!subject || !message) return c.json({ error: "subject_and_body_required" }, 400);

  const result = await sendEmail(c.env, {
    to: target.email,
    subject,
    html: emailShell(renderMarkdown(message)),
  });

  await c.env.DB.prepare(
    `INSERT INTO invite_emails (user_id, subject, body, status, error, sent_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      target.id,
      subject,
      message,
      result.ok ? "sent" : "failed",
      result.ok ? null : result.error,
      c.get("user").id,
    )
    .run();

  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

admin.get("/keys", requireRole("admin"), async (c) => {
  const keys = await c.env.DB.prepare(
    `SELECT k.id, k.name, k.contest_id, k.created_at, k.revoked_at, ct.slug AS contest_slug
     FROM api_keys k LEFT JOIN contests ct ON ct.id = k.contest_id
     ORDER BY k.created_at DESC`,
  ).all();
  return c.json({ keys: keys.results });
});

admin.post("/keys", requireRole("admin"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = String(body?.name || "").trim();
  if (!name) return c.json({ error: "name_required" }, 400);

  let contestId: number | null = null;
  if (body?.contestId) {
    const contest = await getContest(c, String(body.contestId));
    if (!contest) return c.json({ error: "contest_not_found" }, 404);
    contestId = contest.id;
  }

  const rawKey = `ubk_${randomToken(24)}`;
  await c.env.DB.prepare("INSERT INTO api_keys (name, key_hash, contest_id) VALUES (?, ?, ?)")
    .bind(name, await sha256Hex(rawKey), contestId)
    .run();

  // The raw key is returned exactly once and never stored.
  return c.json({ key: rawKey, name, contestId }, 201);
});

admin.delete("/keys/:id", requireRole("admin"), async (c) => {
  await c.env.DB.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .run();
  return c.json({ ok: true });
});
