import type { EntryEventType } from "./types";

export type EntryEvent = {
  entryId?: string | null;
  submissionId?: number | null;
  contestId: number;
  artistId?: number | null;
  type: EntryEventType;
  actor: "artist" | "admin" | "system";
  actorUserId?: number | null;
  reason?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * One row in entry_events, the append-only history used for statistics and
 * review. Returned as a statement so callers can put it in the same
 * DB.batch() as the change it records (D1 runs a batch as a transaction).
 */
export function eventStatement(db: D1Database, ev: EntryEvent): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO entry_events
         (entry_id, submission_id, contest_id, artist_id, type, actor, actor_user_id, reason, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ev.entryId ?? null,
      ev.submissionId ?? null,
      ev.contestId,
      ev.artistId ?? null,
      ev.type,
      ev.actor,
      ev.actorUserId ?? null,
      ev.reason ? ev.reason.slice(0, 500) : null,
      JSON.stringify(ev.detail || {}),
    );
}
