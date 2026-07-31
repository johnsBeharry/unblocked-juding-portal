import type { Env } from "./types";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch] as string);
}

const LINK_COLOR = "#2850fe";

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    `<a href="$2" style="color:${LINK_COLOR};text-decoration:underline">$1</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

/**
 * Minimal markdown -> HTML for email bodies: paragraphs, `**bold**`,
 * `[text](url)` links (http/https/mailto only), and `- ` bullet lists.
 * No raw HTML passthrough — everything is escaped before formatting.
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
 * Wraps rendered body HTML in a plain, client-agnostic email shell: white
 * background, Inter with system fallback, blue links, no branded chrome.
 */
export function emailShell(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;color:#1a1a1a;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 20px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#767676;">UNBLOCKED Judging</p>
      ${bodyHtml}
      <p style="margin:32px 0 0;font-size:12px;color:#9a9a9a;">You're receiving this because you have an account on the UNBLOCKED judging portal.</p>
    </div>
  </body>
</html>`;
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
