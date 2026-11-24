import fs from 'node:fs';
import path from 'node:path';
import { parse, wcagContrast, formatHex } from 'culori';

const TOKENS_PATH = path.join(process.cwd(), 'styles', 'tokens.css');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractVars(blockBody) {
  const vars = {};
  const declRe = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  for (const m of blockBody.matchAll(declRe)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function parseThemes(cssText) {
  const clean = stripComments(cssText);
  // Remove @media (...) { ... } blocks so only top-level theme blocks are parsed
  const withoutMedia = clean.replace(/@media[^{]+\{([\s\S]*?\})\s*\}/g, '');

  const lightVars = {};
  const darkVars = {};

  const blockRe = /([^{}]+)\{([^{}]+)\}/g;
  for (const m of withoutMedia.matchAll(blockRe)) {
    const selector = m[1].trim();
    const body = m[2];
    if (selector.includes("data-theme='light'") || selector.includes(':root')) {
      Object.assign(lightVars, extractVars(body));
    }
    if (selector.includes("data-theme='dark'")) {
      Object.assign(darkVars, extractVars(body));
    }
  }

  return {
    light: lightVars,
    dark: { ...lightVars, ...darkVars },
  };
}

function splitTopLevelArgs(str) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(str.slice(start).trim());
  return args;
}

function parseColorMixArg(argStr, vars, stack) {
  // Matches optional trailing percentage e.g. "#1976d2 14%" or "var(--palette-primary) 84%"
  const pctMatch = argStr.match(/^(.*?)\s+(\d+(?:\.\d+)?)%\s*$/);
  if (pctMatch) {
    return {
      color: resolveColor(pctMatch[1].trim(), vars, stack),
      pct: Number(pctMatch[2]),
    };
  }
  return {
    color: resolveColor(argStr.trim(), vars, stack),
    pct: null,
  };
}

function toSrgbObject(c) {
  if (!c) return null;
  return {
    mode: 'rgb',
    r: c.r ?? 0,
    g: c.g ?? 0,
    b: c.b ?? 0,
    alpha: c.alpha ?? 1,
  };
}

const VAR_ONLY_RE = /^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)$/;

// Direct var(--token) or var(--token, fallback). Returns null if not a var-only expression.
function resolveVarOnly(trimmed, vars, stack) {
  const varOnlyMatch = trimmed.match(VAR_ONLY_RE);
  if (!varOnlyMatch) return null;
  const name = varOnlyMatch[1];
  if (stack.has(name)) {
    throw new Error(`Circular CSS variable reference: ${name}`);
  }
  const rawVal = vars[name] ?? varOnlyMatch[2];
  if (!rawVal) {
    throw new Error(`Undefined CSS variable: ${name}`);
  }
  const nextStack = new Set(stack);
  nextStack.add(name);
  return resolveColor(rawVal, vars, nextStack);
}

// Normalizes the two color-mix percentages so that they always sum relative to each other.
function normalizeMixWeights(pct1, pct2) {
  if (pct1 === null && pct2 === null) return { w1: 50, w2: 50 };
  if (pct2 === null) return { w1: pct1, w2: 100 - pct1 };
  if (pct1 === null) return { w1: 100 - pct2, w2: pct2 };
  return { w1: pct1, w2: pct2 };
}

function mixSrgb(a1, a2) {
  const { w1, w2 } = normalizeMixWeights(a1.pct, a2.pct);
  const total = w1 + w2;
  const p1 = total > 0 ? w1 / total : 0.5;
  const p2 = total > 0 ? w2 / total : 0.5;
  const alphaMult = total < 100 ? total / 100 : 1;

  const c1 = toSrgbObject(a1.color);
  const c2 = toSrgbObject(a2.color);
  return {
    mode: 'rgb',
    r: c1.r * p1 + c2.r * p2,
    g: c1.g * p1 + c2.g * p2,
    b: c1.b * p1 + c2.b * p2,
    alpha: (c1.alpha * p1 + c2.alpha * p2) * alphaMult,
  };
}

// color-mix(in srgb, <arg1>, <arg2>). Returns null if not a color-mix expression.
function resolveColorMix(trimmed, vars, stack) {
  if (!trimmed.startsWith('color-mix(') || !trimmed.endsWith(')')) return null;
  const inner = trimmed.slice('color-mix('.length, -1);
  const args = splitTopLevelArgs(inner);
  if (args.length !== 3 || !args[0].toLowerCase().includes('srgb')) {
    throw new Error(`Unsupported color-mix syntax: ${trimmed}`);
  }
  const a1 = parseColorMixArg(args[1], vars, stack);
  const a2 = parseColorMixArg(args[2], vars, stack);
  return mixSrgb(a1, a2);
}

// Fallback: expand inline var(...) inside other color expressions if any, then parse with culori.
function resolveParsedColor(trimmed, vars) {
  const expanded = trimmed.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g, (_, name) => {
    if (!vars[name]) throw new Error(`Undefined CSS variable: ${name}`);
    return vars[name];
  });

  const parsed = parse(expanded);
  if (!parsed) {
    throw new Error(`Could not parse color expression: ${trimmed}`);
  }
  return toSrgbObject(parsed);
}

function resolveColor(expr, vars, stack = new Set()) {
  const trimmed = expr.trim();
  return (
    resolveVarOnly(trimmed, vars, stack) ??
    resolveColorMix(trimmed, vars, stack) ??
    resolveParsedColor(trimmed, vars)
  );
}

function compositeOver(fg, bg) {
  const a = fg.alpha ?? 1;
  if (a >= 1) return { mode: 'rgb', r: fg.r, g: fg.g, b: fg.b, alpha: 1 };
  return {
    mode: 'rgb',
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    alpha: 1,
  };
}

const CHECK_PAIRS = [
  // Normal text >= 4.5:1
  { fg: '--text', bg: '--bg', min: 4.5, label: 'Body text on --bg' },
  { fg: '--text', bg: '--surface', min: 4.5, label: 'Body text on --surface' },
  { fg: '--text', bg: '--surface-2', min: 4.5, label: 'Body text on --surface-2' },
  { fg: '--text-muted', bg: '--bg', min: 4.5, label: 'Muted text on --bg' },
  { fg: '--text-muted', bg: '--surface', min: 4.5, label: 'Muted text on --surface' },
  { fg: '--text-muted', bg: '--surface-2', min: 4.5, label: 'Muted text on --surface-2' },
  { fg: '--accent-text', bg: '--accent', min: 4.5, label: 'Primary button text on --accent' },
  {
    fg: '--accent-text',
    bg: '--accent-hover',
    min: 4.5,
    label: 'Primary button text on --accent-hover',
  },
  { fg: '--accent', bg: '--surface', min: 4.5, label: 'Accent text/link on --surface' },
  { fg: '--accent', bg: '--accent-soft', min: 4.5, label: 'Accent text on --accent-soft' },
  {
    fg: '--secondary-text',
    bg: '--secondary',
    min: 4.5,
    label: 'Secondary button text on --secondary',
  },
  { fg: '--secondary', bg: '--surface', min: 4.5, label: 'Secondary text on --surface' },
  {
    fg: '--secondary',
    bg: '--secondary-soft',
    min: 4.5,
    label: 'Secondary text on --secondary-soft',
  },
  { fg: '--success', bg: '--surface', min: 4.5, label: 'Success text on --surface' },
  { fg: '--success', bg: '--success-soft', min: 4.5, label: 'Success text on --success-soft' },
  { fg: '--warning', bg: '--surface', min: 4.5, label: 'Warning text on --surface' },
  { fg: '--warning', bg: '--warning-soft', min: 4.5, label: 'Warning text on --warning-soft' },
  { fg: '--danger-text', bg: '--danger', min: 4.5, label: 'Danger button text on --danger' },
  {
    fg: '--danger-text',
    bg: '--danger-hover',
    min: 4.5,
    label: 'Danger button text on --danger-hover',
  },
  { fg: '--danger', bg: '--surface', min: 4.5, label: 'Danger text on --surface' },
  { fg: '--danger', bg: '--danger-soft', min: 4.5, label: 'Danger text on --danger-soft' },

  // UI components / boundaries >= 3.0:1
  {
    fg: '--border-strong',
    bg: '--surface',
    min: 3.0,
    label: 'Outlined input/button border on --surface',
  },
  { fg: '--switch-track-off', bg: '--surface', min: 3.0, label: 'Off switch track on --surface' },
  ...['status', 'drop', 'visual', 'ghost', 'prank', 'fake', 'heavy', 'runaway', 'other'].map(
    (name) => ({
      fg: '--sticker-text',
      bg: `--sticker-${name}`,
      min: 4.5,
      label: `Ojama sticker text on --sticker-${name}`,
    }),
  ),
  { fg: '--focus', bg: '--surface', min: 3.0, label: 'Focus ring on --surface' },
];

const css = fs.readFileSync(TOKENS_PATH, 'utf8');
const themes = parseThemes(css);
const failures = [];
let totalChecked = 0;

for (const [themeName, vars] of Object.entries(themes)) {
  const surfaceBase = resolveColor('var(--surface)', vars);

  for (const pair of CHECK_PAIRS) {
    totalChecked++;
    const rawBg = resolveColor(`var(${pair.bg})`, vars);
    const opaqueBg = compositeOver(rawBg, surfaceBase);
    const rawFg = resolveColor(`var(${pair.fg})`, vars);
    const opaqueFg = compositeOver(rawFg, opaqueBg);

    const ratio = wcagContrast(opaqueFg, opaqueBg);
    if (ratio < pair.min) {
      failures.push({
        theme: themeName,
        pair: `${pair.fg} (${formatHex(opaqueFg)}) on ${pair.bg} (${formatHex(opaqueBg)})`,
        label: pair.label,
        ratio: ratio.toFixed(2),
        min: pair.min.toFixed(1),
      });
    }
  }
}

if (failures.length > 0) {
  console.error(`WCAG Contrast Check FAILED with ${failures.length} violation(s):`);
  for (const f of failures) {
    console.error(
      `  [${f.theme}] ${f.pair} (${f.label}): measured ${f.ratio}:1 < required ${f.min}:1` +
        ` -> Adjust master palette or soft mix % in styles/tokens.css`,
    );
  }
  process.exit(1);
}

console.log(
  `WCAG Contrast Check PASSED (${totalChecked} color pairs across light & dark themes meet WCAG 2.1 AA).`,
);
