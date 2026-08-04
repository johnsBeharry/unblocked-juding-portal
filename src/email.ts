import type { Env } from "./types";
import { hmacHex } from "./util";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch] as string);
}

const LINK_COLOR = "#2850fe";
const HIGHLIGHT_BG = "#fff3a0";

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    `<a href="$2" style="color:${LINK_COLOR};text-decoration:underline">$1</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/==([^=]+)==/g, `<mark style="background:${HIGHLIGHT_BG};padding:0 2px">$1</mark>`);
  return out;
}

/**
 * Minimal markdown -> HTML for email bodies: paragraphs, `**bold**`,
 * `==highlight==`, `[text](url)` links (http/https/mailto only), and `- `
 * bullet lists. No raw HTML passthrough — everything is escaped before
 * formatting.
 */
export function renderMarkdown(source: string): string {
  const blocks = source.trim().split(/\n\s*\n/).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith("- "))) {
        const items = lines.map((l) => `<li style="margin:0 0 6px">${inline(l.slice(2))}</li>`).join("");
        return `<ul style="margin:0 0 16px;padding-left:20px">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px">${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

/**
 * Wraps rendered body HTML in a plain, personal-feeling email shell: white
 * background, left-aligned, no card/banner/branding — reads like a note
 * from a person, not a system. Always signs off "Bests, Johns"; pass
 * `unsubscribeUrl` to add the one-click unsubscribe line (omit it for
 * emails a recipient can't function without, like the sign-in link).
 */
export function emailShell(bodyHtml: string, opts: { unsubscribeUrl?: string } = {}): string {
  const unsubscribe = opts.unsubscribeUrl
    ? `<p style="margin:20px 0 0;font-size:12px;color:#9a9a9a;"><a href="${opts.unsubscribeUrl}" style="color:#9a9a9a;text-decoration:underline">Unsubscribe</a></p>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Inter,Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:0;padding:40px 24px;color:#101010;font-size:16px;line-height:1.65;text-align:left;">
      ${bodyHtml}
      <p style="margin:32px 0 0">Bests,<br>Johns</p>
      ${unsubscribe}
    </div>
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
