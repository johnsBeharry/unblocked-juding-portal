import type { Env } from "./types";
import { hmacHex } from "./util";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch] as string);
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    `<a href="$2">$1</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/==([^=]+)==/g, "<mark>$1</mark>");
  return out;
}

/**
 * Minimal markdown -> HTML for email bodies: paragraphs, `**bold**`,
 * `==highlight==`, `[text](url)` links (http/https/mailto only), and `- `
 * bullet lists. No raw HTML passthrough — everything is escaped before
 * formatting. No inline styling — relies entirely on the email client's
 * own defaults so it reads as a plain note, not a designed HTML email.
 */
export function renderMarkdown(source: string): string {
  const blocks = source.trim().split(/\n\s*\n/).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith("- "))) {
        const items = lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

/**
 * Wraps rendered body HTML with zero styling — no background, no colors,
 * no fonts, no card. Just bare tags so it renders using whatever the
 * recipient's mail client shows by default, like a plain note from a
 * person. Always signs off "Bests, Johns"; pass `unsubscribeUrl` to add
 * the one-click unsubscribe line (omit it for emails a recipient can't
 * function without, like the sign-in link).
 */
export function emailShell(bodyHtml: string, opts: { unsubscribeUrl?: string } = {}): string {
  const unsubscribe = opts.unsubscribeUrl
    ? `<p><a href="${opts.unsubscribeUrl}">Unsubscribe</a></p>`
    : "";
  return `<!doctype html>
<html>
  <body>
    ${bodyHtml}
    <p>Bests,<br>Johns</p>
    ${unsubscribe}
  </body>
</html>`;
}

/**
 * Deterministic per-recipient unsubscribe token: HMAC(RESEND_API_KEY, email).
 * No extra secret to provision, and it's only ever checked against emails
 * we're about to send — a forged token just opts someone out early.
 */
async function unsubscribeToken(env: Env, email: string): Promise<string> {
  return hmacHex(env.RESEND_API_KEY || "unblocked-judging-dev-secret", email.toLowerCase());
}

export async function unsubscribeUrl(env: Env, origin: string, email: string): Promise<string> {
  const token = await unsubscribeToken(env, email);
  return `${origin}/email/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

export async function verifyUnsubscribeToken(env: Env, email: string, token: string): Promise<boolean> {
  if (!token) return false;
  return (await unsubscribeToken(env, email)) === token;
}

export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: "email_not_configured" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "UNBLOCKED Judging <onboarding@resend.dev>",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    console.error("resend_error", res.status, await res.text().catch(() => ""));
    return { ok: false, error: `resend_${res.status}` };
  }
  return { ok: true };
}
