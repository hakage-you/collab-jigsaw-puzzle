import { OJAMA_CONFIG } from '../config/constants.js';
import { TRIGGER_ACTIONS } from '../app/ojamaRules.js';

const C = OJAMA_CONFIG;

/**
 * The ojama rules form in the stream modal. Each number field is read as a whole number kept
 * within [min, max] (`def` when empty or not a number); selects are read as they are.
 */
const NUMBER_FIELDS = [
  { id: 'ojamaCommentThreshold', key: 'commentThreshold', min: 1, max: 100, def: 5 },
  { id: 'ojamaCooldownSec', key: 'cooldownSec', min: 0, max: 120, def: 0 },
  { id: 'ojamaDropCount', key: 'dropCount', min: 1, max: 20, def: 2 },
  { id: 'ojamaVisualDuration', key: 'visualDuration', min: 2, max: 30, def: 8 },
  {
    id: 'ojamaFakeDuration',
    key: 'fakeDuration',
    min: 0,
    max: 600,
    def: C.FAKE_PIECE_DURATION_SEC,
  },
  { id: 'ojamaFakeMaxCount', key: 'fakeMaxCount', min: 1, max: 16, def: C.FAKE_PIECE_MAX_COUNT },
  {
    id: 'ojamaSuperchatDuration',
    key: 'superchatDuration',
    min: 0,
    max: 600,
    def: C.DEFAULT_SUPERCHAT_DURATION_SEC,
  },
  {
    id: 'ojamaHeavyDuration',
    key: 'heavyDuration',
    min: 5,
    max: 300,
    def: C.DEFAULT_HEAVY_DURATION_SEC,
  },
  { id: 'ojamaHeavyReduceSec', key: 'heavyReduceSec', min: 0, max: 60, def: 3 },
  { id: 'ojamaRunawayChance', key: 'runawayChance', min: 0, max: 100, def: 30 },
  {
    id: 'ojamaRunawayDuration',
    key: 'runawayDuration',
    min: 5,
    max: 300,
    def: C.DEFAULT_RUNAWAY_DURATION_SEC,
  },
  { id: 'ojamaRunawayReduceSec', key: 'runawayReduceSec', min: 0, max: 60, def: 3 },
  { id: 'ojamaRunawayGripMinSec', key: 'runawayGripMinSec', min: 1, max: 30, def: 3 },
  { id: 'ojamaRunawayGripMaxSec', key: 'runawayGripMaxSec', min: 1, max: 30, def: 6 },
];

const SELECT_FIELDS = [
  { id: 'ojamaVisualType', key: 'visualType', def: 'random' },
  { id: 'ojamaHeavyLevel', key: 'heavyLevel', def: C.DEFAULT_HEAVY_LEVEL },
];

/** Whole number from an input value, kept within [min, max]; `def` when not a number. */
function readWholeNumber(value, { min, max, def }) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Element id of a trigger word field, e.g. ojamaTrigger-drop. */
const triggerId = (action) => `ojamaTrigger-${action}`;

export class OjamaSettingsForm {
  /** @param {object} app GameSession (getSettings, patchSettings, on) */
  constructor(app) {
    this.app = app;
    const els = (fields) => fields.map((f) => ({ ...f, el: document.getElementById(f.id) }));
    this.numbers = els(NUMBER_FIELDS);
    this.selects = els(SELECT_FIELDS);
    this.triggers = TRIGGER_ACTIONS.map((action) => ({
      action,
      el: document.getElementById(triggerId(action)),
    }));
    for (const { el } of [...this.numbers, ...this.selects, ...this.triggers]) {
      el?.addEventListener('change', () => this.read());
    }
    this.app.on('settingsChange', (s) => this.sync(s));
    this.sync(this.app.getSettings());
  }

  /** Reads every field into the settings. */
  read() {
    const ojama = {};
    for (const f of this.numbers) if (f.el) ojama[f.key] = readWholeNumber(f.el.value, f);
    for (const f of this.selects) if (f.el) ojama[f.key] = f.el.value || f.def;
    ojama.triggers = {};
    for (const t of this.triggers) if (t.el) ojama.triggers[t.action] = t.el.value;
    this.app.patchSettings({ ojama });
  }

  sync(settings) {
    const o = settings.ojama;
    for (const f of [...this.numbers, ...this.selects]) if (f.el) f.el.value = o[f.key] ?? f.def;
    for (const t of this.triggers) if (t.el) t.el.value = o.triggers?.[t.action] ?? '';
  }
}
