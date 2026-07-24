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
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: UserRow;
  };
};
