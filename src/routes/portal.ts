import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, ContestRow, SubmissionRow } from "../types";
import { computeResults } from "../results";
import { parseCriteria, parseJsonObject } from "../util";

export const portal = new Hono<AppEnv>();

async function contestForJudge(
  c: Context<AppEnv>,
  contestId: string,
): Promise<{ contest: ContestRow; onPanel: boolean } | null> {
  const contest = await c.env.DB.prepare("SELECT * FROM contests WHERE id = ?")
    .bind(Number(contestId))
    .first<ContestRow>();
  if (!contest) return null;
  const user = c.get("user");
  const panelRow = await c.env.DB.prepare(
    "SELECT 1 AS onpanel FROM contest_judges WHERE contest_id = ? AND user_id = ?",
  )
    .bind(contest.id, user.id)
    .first();
  return { contest, onPanel: Boolean(panelRow) };
}

portal.get("/me", async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?")
    .bind(user.id)
    .run();

  const contests =
    user.role === "judge"
      ? await c.env.DB.prepare(
          `SELECT ct.id, ct.slug, ct.name, ct.theme, ct.status FROM contests ct
           JOIN contest_judges cj ON cj.contest_id = ct.id
           WHERE cj.user_id = ? AND ct.status != 'archived'
           ORDER BY ct.created_at DESC`,
        )
          .bind(user.id)
          .all()
      : await c.env.DB.prepare(
          "SELECT id, slug, name, theme, status FROM contests WHERE status != 'archived' ORDER BY created_at DESC",
        ).all();

  return c.json({ user, contests: contests.results });
});

portal.get("/contests/:id", async (c) => {
  const found = await contestForJudge(c, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const { contest, onPanel } = found;
  const user = c.get("user");
  const isStaff = user.role === "admin" || user.role === "manager";
  if (!onPanel && !isStaff) return c.json({ error: "forbidden" }, 403);

  const criteria = parseCriteria(contest.criteria);
  const judgingStarted = !["draft", "open"].includes(contest.status);

  const subs = judgingStarted
    ? await c.env.DB.prepare(
        "SELECT * FROM submissions WHERE contest_id = ? AND status = 'submitted' ORDER BY id",
      )
        .bind(contest.id)
        .all<SubmissionRow>()
    : { results: [] as SubmissionRow[] };

  // Round 1 is judged blind: artist identity is withheld until the contest
  // moves past round1 (staff always see it in the admin console instead).
  const revealArtist = contest.status !== "round1";
  const submissions = subs.results.map((s) => ({
    id: s.id,
    publicId: s.public_id,
    title: s.title,
    artistName: revealArtist ? s.artist_name : "",
    country: revealArtist ? s.country : "",
    concept: s.concept,
    metadata: revealArtist ? parseJsonObject(s.metadata) : {},
    fileUrl: s.file_key ? `/files/${s.file_key}` : null,
    fileType: s.file_type,
    advanced: Boolean(s.advanced),
  }));

  const votes = await c.env.DB.prepare(
    `SELECT v.submission_id, v.decision FROM round1_votes v
     JOIN submissions s ON s.id = v.submission_id
     WHERE s.contest_id = ? AND v.judge_id = ?`,
  )
    .bind(contest.id, user.id)
    .all<{ submission_id: number; decision: string }>();

  const ratings = await c.env.DB.prepare(
    `SELECT r.submission_id, r.ratings FROM round2_ratings r
     JOIN submissions s ON s.id = r.submission_id
     WHERE s.contest_id = ? AND r.judge_id = ?`,
  )
    .bind(contest.id, user.id)
    .all<{ submission_id: number; ratings: string }>();

  const judgeCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM contest_judges WHERE contest_id = ?",
  )
    .bind(contest.id)
    .first<{ n: number }>();

  const showResults = ["deliberation", "complete"].includes(contest.status);

  return c.json({
    contest: {
      id: contest.id,
      slug: contest.slug,
      name: contest.name,
      theme: contest.theme,
      description: contest.description,
      status: contest.status,
      criteria,
    },
    onPanel,
    judgeCount: judgeCount?.n ?? 0,
    submissions,
    myVotes: Object.fromEntries(votes.results.map((v) => [v.submission_id, v.decision])),
    myRatings: Object.fromEntries(
      ratings.results.map((r) => [r.submission_id, parseJsonObject(r.ratings)]),
    ),
    results: showResults ? await computeResults(c.env, contest.id, criteria) : null,
  });
});

portal.post("/contests/:id/votes", async (c) => {
  const found = await contestForJudge(c, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const { contest, onPanel } = found;
  if (!onPanel) return c.json({ error: "forbidden" }, 403);
  if (contest.status !== "round1") return c.json({ error: "round1_not_active" }, 409);

  const body = await c.req.json().catch(() => null);
  const submissionId = Number(body?.submissionId);
  const decision = body?.decision;
  if (!Number.isInteger(submissionId) || !["yes", "no"].includes(decision)) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const sub = await c.env.DB.prepare(
    "SELECT id FROM submissions WHERE id = ? AND contest_id = ? AND status = 'submitted'",
  )
    .bind(submissionId, contest.id)
    .first();
  if (!sub) return c.json({ error: "submission_not_found" }, 404);

  await c.env.DB.prepare(
    `INSERT INTO round1_votes (submission_id, judge_id, decision) VALUES (?, ?, ?)
     ON CONFLICT (submission_id, judge_id)
     DO UPDATE SET decision = excluded.decision, updated_at = datetime('now')`,
  )
    .bind(submissionId, c.get("user").id, decision)
    .run();

  return c.json({ ok: true });
});

portal.post("/contests/:id/ratings", async (c) => {
  const found = await contestForJudge(c, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const { contest, onPanel } = found;
  if (!onPanel) return c.json({ error: "forbidden" }, 403);
  if (contest.status !== "round2") return c.json({ error: "round2_not_active" }, 409);

  const body = await c.req.json().catch(() => null);
  const submissionId = Number(body?.submissionId);
  const ratings = body?.ratings;
  const criteria = parseCriteria(contest.criteria);

  if (
    !Number.isInteger(submissionId) ||
    !ratings ||
    typeof ratings !== "object" ||
    Array.isArray(ratings)
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const clean: Record<string, number> = {};
  for (const criterion of criteria) {
    const score = Number(ratings[criterion]);
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      return c.json({ error: "invalid_rating", criterion }, 400);
    }
    clean[criterion] = score;
  }

  const sub = await c.env.DB.prepare(
    "SELECT id FROM submissions WHERE id = ? AND contest_id = ? AND status = 'submitted' AND advanced = 1",
  )
    .bind(submissionId, contest.id)
    .first();
  if (!sub) return c.json({ error: "submission_not_found" }, 404);

  await c.env.DB.prepare(
    `INSERT INTO round2_ratings (submission_id, judge_id, ratings) VALUES (?, ?, ?)
     ON CONFLICT (submission_id, judge_id)
     DO UPDATE SET ratings = excluded.ratings, updated_at = datetime('now')`,
  )
    .bind(submissionId, c.get("user").id, JSON.stringify(clean))
    .run();

  return c.json({ ok: true });
});
