#!/usr/bin/env node
// CI guardrail: prevents reintroduction of manual status color utility
// classes in pages and shared status surfaces. The single source of
// truth for status colors is `src/components/patterns/status-badges.tsx`.
//
// We scan for the *full-strength* hundred-step color tokens
// (bg-emerald-100, bg-amber-100, bg-rose-100, bg-green-100,
// bg-yellow-100, bg-orange-50, bg-orange-100, text-amber-600,
// text-red-600, etc) and the legacy text-{green,yellow,red}-700
// classes in the migrated pages. Pages must use the central
// TONE_CLASSES / TONE_TEXT_CLASSES / TONE_ICON_CLASSES /
// TONE_DOT_CLASSES / TONE_TINT_BG_CLASSES exports instead.
//
// Allowlisted out-of-scope rendered classes (semantic non-status
// surfaces) are checked separately and not blocked here.

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Files we enforce against. We currently enforce against the 7 pages
// migrated in task #185 ("Migrate page status colors to central tone
// system"). Other pages still using ad-hoc colors are tracked as a
// follow-up cleanup (see task #192) and will be added to TARGETS as
// they are migrated.
const TARGETS = [
  "src/pages/negotiation.tsx",
  "src/pages/price-increases.tsx",
  "src/pages/price-increase.tsx",
  "src/pages/clauses.tsx",
  "src/pages/clauses-suggestions.tsx",
  "src/pages/copilot.tsx",
  "src/pages/reports.tsx",
];
const EXCLUDE = new Set([]);

// Full-strength banned utility classes.
const BANNED_PATTERNS = [
  // hundred-step backgrounds (legacy badge style)
  /\bbg-emerald-100\b/,
  /\bbg-amber-100\b/,
  /\bbg-rose-100\b/,
  /\bbg-green-100\b/,
  /\bbg-yellow-100\b/,
  /\bbg-orange-50\b/,
  /\bbg-orange-100\b/,
  /\bbg-red-100\b/,
  /\bbg-blue-100\b/,
  /\bbg-indigo-100\b/,
  /\bbg-purple-100\b/,
  // hundred-step text colors that should now be tone classes
  /\btext-amber-600\b/,
  /\btext-red-600\b/,
  /\btext-green-600\b/,
  /\btext-green-700\b/,
  /\btext-yellow-700\b/,
  /\btext-red-700\b/,
  /\btext-amber-900\b/,
  /\btext-orange-900\b/,
  // legacy 700-step backgrounds
  /\bborder-amber-200\b/, // ok inside central, but legacy outside
  /\bborder-emerald-200\b/,
  /\bborder-rose-200\b/,
  /\bborder-orange-200\b/,
];

// Allowlist of file:line:pattern combinations that are explicitly
// justified non-status uses (diff redlining, semantic interaction
// states, etc). Reviewer approved these as out-of-scope.
const ALLOWLIST = [
  // clauses-suggestions diff visualization (not status)
  { file: "src/pages/clauses-suggestions.tsx", patterns: [
    /\bbg-emerald-500\/5\b/, /\bbg-rose-500\/5\b/,
    /\bbg-emerald-500\/20\b/, /\bbg-rose-500\/20\b/,
    /\btext-emerald-800\b/, /\btext-rose-800\b/,
    /\btext-emerald-300\b/, /\btext-rose-300\b/,
  ] },
  // CUAD checkbox checked-state highlight (interaction, not status)
  { file: "src/pages/clauses.tsx", patterns: [
    /\bbg-emerald-50\/40\b/, /\bborder-emerald-300\b/,
  ] },
];

function isAllowed(filePath, line) {
  for (const entry of ALLOWLIST) {
    if (filePath.endsWith(entry.file)) {
      for (const pat of entry.patterns) {
        if (pat.test(line)) return true;
      }
    }
  }
  return false;
}

let violations = 0;

for (const pattern of TARGETS) {
  for await (const file of glob(pattern, { cwd: ROOT })) {
    if (EXCLUDE.has(file)) continue;
    const fullPath = resolve(ROOT, file);
    const content = readFileSync(fullPath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const banned of BANNED_PATTERNS) {
        if (banned.test(line)) {
          if (isAllowed(file, line)) continue;
          violations++;
          console.error(
            `\x1b[31m✖\x1b[0m ${file}:${i + 1} matches banned status color ${banned}`,
          );
          console.error(`     ${line.trim()}`);
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `\n\x1b[31m${violations}\x1b[0m banned status-color utility ${
      violations === 1 ? "class" : "classes"
    } found in pages/components/patterns.\n` +
      `Use the central tone helpers from\n` +
      `  src/components/patterns/status-badges.tsx\n` +
      `instead (TONE_CLASSES / TONE_TEXT_CLASSES / TONE_ICON_CLASSES /\n` +
      `TONE_DOT_CLASSES / TONE_TINT_BG_CLASSES) — or, if you have a\n` +
      `legitimate semantic non-status use case, add it to ALLOWLIST.`,
  );
  process.exit(1);
}

console.log("✓ check-status-colors: all pages use the central tone system.");
