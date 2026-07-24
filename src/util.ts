export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 24): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Short human-friendly submission id, e.g. "OWN-4F2A9C" for slug "ownership-2026". */
export function publicSubmissionId(contestSlug: string): string {
  const prefix = contestSlug.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "SUB";
  return `${prefix}-${randomToken(3).toUpperCase()}`;
}

export function parseCriteria(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((c) => typeof c === "string") && parsed.length > 0) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return ["Theme Relevance", "Concept", "Execution", "Creativity"];
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  return {};
}
