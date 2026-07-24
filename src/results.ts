import type { Env, SubmissionRow } from "./types";
import { parseJsonObject } from "./util";

export type ResultRow = {
  submissionId: number;
  publicId: string;
  title: string;
  artistName: string;
  country: string;
  average: number | null;
  judgesRated: number;
  perCriterion: Record<string, number | null>;
};

/**
 * Aggregates Round 2 ratings across the panel for a contest's advanced
 * submissions. Average = mean of every criterion score from every judge.
 */
export async function computeResults(
  env: Env,
  contestId: number,
  criteria: string[],
): Promise<ResultRow[]> {
  const subs = await env.DB.prepare(
    "SELECT * FROM submissions WHERE contest_id = ? AND advanced = 1 AND status = 'submitted'",
  )
    .bind(contestId)
    .all<SubmissionRow>();

  const ratings = await env.DB.prepare(
    `SELECT r.submission_id, r.ratings FROM round2_ratings r
     JOIN submissions s ON s.id = r.submission_id
     WHERE s.contest_id = ? AND s.advanced = 1 AND s.status = 'submitted'`,
  )
    .bind(contestId)
    .all<{ submission_id: number; ratings: string }>();

  const bySubmission = new Map<number, Record<string, unknown>[]>();
  for (const row of ratings.results) {
    const list = bySubmission.get(row.submission_id) || [];
    list.push(parseJsonObject(row.ratings));
    bySubmission.set(row.submission_id, list);
  }

  const rows: ResultRow[] = subs.results.map((sub) => {
    const judgeRatings = bySubmission.get(sub.id) || [];
    const perCriterion: Record<string, number | null> = {};
    let total = 0;
    let count = 0;
    for (const criterion of criteria) {
      let critTotal = 0;
      let critCount = 0;
      for (const rating of judgeRatings) {
        const score = Number(rating[criterion]);
        if (Number.isFinite(score) && score >= 1 && score <= 10) {
          critTotal += score;
          critCount += 1;
        }
      }
      perCriterion[criterion] = critCount ? critTotal / critCount : null;
      total += critTotal;
      count += critCount;
    }
    return {
      submissionId: sub.id,
      publicId: sub.public_id,
      title: sub.title,
      artistName: sub.artist_name,
      country: sub.country,
      average: count ? total / count : null,
      judgesRated: judgeRatings.length,
      perCriterion,
    };
  });

  rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  return rows;
}
