/**
 * Syncs standalone HTML content fragments from content/*.html into index.html markers.
 * Usage:
 *   node scripts/sync-content.mjs         (writes synced content into index.html)
 *   node scripts/sync-content.mjs --check (verifies index.html matches content/*.html)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');

const CONTENT_ENTRIES = [
  { id: 'terms', file: 'content/terms.html' },
  { id: 'yt-guide', file: 'content/yt-guide.html' },
  { id: 'credits', file: 'content/credits.html' },
];

function normalizeHtml(str) {
  return String(str)
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .trim();
}

function indentFragment(fragment, indent) {
  return fragment
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `${indent}${line}` : ''))
    .join('\n');
}

function buildMarkerPattern(id) {
  return new RegExp(
    `([ \\t]*)<!-- @content:${id}:start -->([\\s\\S]*?)<!-- @content:${id}:end -->`,
  );
}

function processEntry(html, entry) {
  const fragmentPath = path.join(ROOT_DIR, entry.file);
  const fragment = fs.readFileSync(fragmentPath, 'utf8');
  const pattern = buildMarkerPattern(entry.id);
  const match = pattern.exec(html);
  if (!match) {
    throw new Error(
      `index.html に <!-- @content:${entry.id}:start/end --> マーカーが見つかりません`,
    );
  }

  const [fullMatch, indent, currentBody] = match;
  const inSync = normalizeHtml(currentBody) === normalizeHtml(fragment);
  const replacement = `${indent}<!-- @content:${entry.id}:start -->\n${indentFragment(fragment, indent)}\n${indent}<!-- @content:${entry.id}:end -->`;
  return {
    inSync,
    updatedHtml: html.replace(fullMatch, () => replacement),
  };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const outOfSync = [];

  for (const entry of CONTENT_ENTRIES) {
    const result = processEntry(html, entry);
    if (!result.inSync) {
      outOfSync.push(entry.file);
    }
    html = result.updatedHtml;
  }

  if (checkOnly) {
    if (outOfSync.length > 0) {
      console.error(`index.html と未同期のコンテンツがあります: ${outOfSync.join(', ')}`);
      console.error('反映するには `npm run sync:content` を実行してください。');
      process.exit(1);
    }
    console.log(`Content Sync Check PASSED (${CONTENT_ENTRIES.length} entries in sync).`);
    return;
  }

  fs.writeFileSync(INDEX_HTML_PATH, html, 'utf8');
  console.log(`Synced ${CONTENT_ENTRIES.length} content entries into index.html.`);
}

main();
