import type { ContestRow } from "./types";

/**
 * Version of the submission terms shown in the form. Bump it when the
 * consent wording changes; submits with an older version get 409
 * consent_outdated so the artist sees the new terms first.
 */
export const CONSENT_VERSION = "2026-11-08";

/** Version of the Terms of Service and Privacy Policy an account agrees to. */
export const TERMS_VERSION = "2026-11-08";

/** True once closes_at (ISO 8601, UTC) has passed. No closing date = never. */
export function isPastClosing(contest: Pick<ContestRow, "closes_at">, now = Date.now()): boolean {
  if (!contest.closes_at) return false;
  const closes = Date.parse(contest.closes_at);
  return Number.isFinite(closes) && closes <= now;
}

/** New entries and restores are allowed only while open and before the closing date. */
export function acceptingSubmissions(contest: ContestRow): boolean {
  return contest.status === "open" && !isPastClosing(contest);
}

/**
 * Artists can withdraw only while the contest is open and judging has never
 * started. judging_started_at is set once and never cleared, so moving a
 * contest back from Round 1 to Open does not reopen withdrawals.
 */
export function withdrawalsOpen(contest: ContestRow): boolean {
  return contest.status === "open" && !contest.judging_started_at;
}

export function publicContest(contest: ContestRow) {
  return {
    slug: contest.slug,
    name: contest.name,
    theme: contest.theme,
    description: contest.description,
    acceptingSubmissions: acceptingSubmissions(contest),
    closesAt: contest.closes_at,
    maxEntriesPerArtist: contest.max_entries_per_artist,
    withdrawalsOpen: withdrawalsOpen(contest),
    consentVersion: CONSENT_VERSION,
    termsVersion: TERMS_VERSION,
  };
}
