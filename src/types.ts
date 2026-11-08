export type Env = {
  DB: D1Database;
  POSTERS: R2Bucket;
  ASSETS: Fetcher;
  /** "magic" (Resend magic-link sessions, production) or "dev" (trusts DEV_USER_EMAIL). */
  AUTH_MODE?: string;
  DEV_USER_EMAIL?: string;
  /** Comma-separated emails auto-provisioned as admins on first sign-in. */
  ADMIN_EMAILS?: string;
  /** Secret (wrangler secret put RESEND_API_KEY / .dev.vars locally). */
  RESEND_API_KEY?: string;
  /** Sender for sign-in emails, e.g. "UNBLOCKED Judging <judging@example.com>". */
  MAIL_FROM?: string;
  /** Sender for artist emails (sign-in code, receipt, withdrawal). */
  MAIL_FROM_ARTISTS?: string;
  /** Secret used to HMAC artist sign-in codes (wrangler secret put ARTIST_CODE_SECRET). */
  ARTIST_CODE_SECRET?: string;
  /** "log" prints artist emails to the console instead of sending them (local dev). */
  ARTIST_EMAIL_MODE?: string;
};

export type Role = "admin" | "manager" | "judge";

export type UserRow = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

export type ContestStatus =
  | "draft"
  | "open"
  | "round1"
  | "round2"
  | "deliberation"
  | "complete"
  | "archived";

export const CONTEST_STATUSES: ContestStatus[] = [
  "draft",
  "open",
  "round1",
  "round2",
  "deliberation",
  "complete",
  "archived",
];

export type ContestRow = {
  id: number;
  slug: string;
  name: string;
  theme: string;
  description: string;
  status: ContestStatus;
  criteria: string;
  created_at: string;
  closes_at: string | null;
  judging_started_at: string | null;
  max_entries_per_artist: number | null;
};

export type SubmissionRow = {
  id: number;
  contest_id: number;
  public_id: string;
  title: string;
  artist_name: string;
  artist_email: string;
  country: string;
  concept: string;
  metadata: string;
  file_key: string | null;
  file_type: string | null;
  status: "submitted" | "disqualified";
  advanced: number;
  created_at: string;
  artist_id: number | null;
  entry_id: string | null;
  instagram: string;
  withdrawn_at: string | null;
  consent_version: string | null;
};

export type ArtistRow = {
  id: number;
  email: string;
  name: string;
  country: string;
  instagram: string;
  bio: string;
  photo_key: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

export type EntryStatus = "draft" | "submitted" | "withdrawn" | "discarded";

export type EntryAsset = { id: string; key: string; type: string; name: string; size: number };

export type EntryRow = {
  id: string;
  contest_id: number;
  artist_id: number;
  status: EntryStatus;
  title: string;
  concept: string;
  metadata: string;
  file_key: string | null;
  file_type: string | null;
  file_name: string | null;
  file_size: number | null;
  assets: string;
  version: number;
  submission_id: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  withdrawn_at: string | null;
  discarded_at: string | null;
};

export type EntryEventType =
  | "created"
  | "file_added"
  | "file_replaced"
  | "file_removed"
  | "submitted"
  | "withdrawn"
  | "restored"
  | "discarded"
  | "disqualified"
  | "requalified"
  | "advanced"
  | "unadvanced";

export type ApiKeyRow = {
  id: number;
  name: string;
  contest_id: number | null;
  signin_url: string | null;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: UserRow;
    apiKey: ApiKeyRow;
    artist: ArtistRow;
    contest: ContestRow;
  };
};
