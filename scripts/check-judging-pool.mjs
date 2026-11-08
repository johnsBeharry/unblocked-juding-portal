// Fails if judge-facing code reads the submissions table directly.
// Judging must read the judging_pool view, which leaves out withdrawn and
// disqualified entries. Only admin code and the artist submit/withdraw
// handlers may touch the raw table. Run with `npm run check`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "src/routes/admin.ts",    // staff see every row, including withdrawn ones
  "src/routes/artists.ts",  // submit, withdraw, restore
  "src/routes/external.ts", // legacy API-key submissions (insert only)
]);
const PATTERN = /\b(FROM|JOIN)\s+submissions\b/gi;

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|js)$/.test(name)) files.push(path);
  }
})(join(root, "src"));

const problems = [];
for (const file of files) {
  const rel = relative(root, file);
  if (ALLOWED.has(rel)) continue;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (PATTERN.test(line)) problems.push(`${rel}:${i + 1}: ${line.trim()}`);
    PATTERN.lastIndex = 0;
  });
}

if (problems.length) {
  console.error("Judge-facing code must read judging_pool, not submissions:\n" + problems.join("\n"));
  process.exit(1);
}
console.log(`judging_pool check passed (${files.length} files).`);
