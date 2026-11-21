import { parseTriggerWords, normalizeKeyword } from '../app/ojamaRules.js';
import { h } from './domBuild.js';

const UNDO_MS = 10000;

/**
 * Edits one keyword list (stored as a comma-separated string): a chip per keyword with a ×
 * button, an input that adds on Enter (not while the IME is converting) or with the 追加 button,
 * a note when a keyword is changed to half-width / lower case, a warning for duplicates, and "元に戻す" for a few seconds after a removal.
 * The input element is kept across updates, so typing is never lost.
 */
export class KeywordEditor {
  /**
   * @param {object} deps
   * @param {() => string} deps.load  the stored list
   * @param {(text: string) => void} deps.save  stores a new list
   * @param {(word: string) => string|null} deps.ownerOf  the name of the list holding `word`
   */
  constructor({ load, save, ownerOf }) {
    this.load = load;
    this.save = save;
    this.ownerOf = ownerOf;
    this.note = null;
    this.undo = null;
    this.elChips = h('div', { class: 'kw-chips' });
    this.elInput = h('input', {
      type: 'text',
      class: 'kw-input',
      placeholder: 'キーワードを入れて Enter',
      'aria-label': 'キーワードを足す',
      onKeydown: (e) => {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          this.add();
        }
      },
    });
    this.elMsgs = h('div', { class: 'kw-msgs', 'aria-live': 'polite' });
    this.el = h(
      'div',
      { class: 'kw-editor' },
      this.elChips,
      h(
        'div',
        { class: 'kw-add' },
        this.elInput,
        h('button', {
          type: 'button',
          class: 'btn btn-xs',
          text: '追加',
          onClick: () => this.add(),
        }),
      ),
      this.elMsgs,
    );
    this.update();
  }

  words() {
    return parseTriggerWords(this.load());
  }

  add() {
    const raw = this.elInput.value.trim();
    const word = normalizeKeyword(raw).replaceAll(',', '').trim();
    if (!word) return;
    const owner = this.ownerOf(word);
    if (owner) {
      this.note = { text: `「${word}」はもう「${owner}」にあります`, warn: true };
    } else {
      this.save([...this.words(), word].join(', '));
      this.note = {
        text: raw === word ? `「${word}」を足しました` : `「${raw}」を「${word}」として足しました`,
      };
      this.elInput.value = '';
    }
    this.update();
    this.elInput.focus();
  }

  remove(word) {
    this.save(
      this.words()
        .filter((w) => w !== word)
        .join(', '),
    );
    this.undo = { word, at: Date.now() };
    this.note = null;
    this.update();
    setTimeout(() => this.update(), UNDO_MS + 50);
  }

  restore() {
    if (!this.undo) return;
    const { word } = this.undo;
    this.undo = null;
    if (!this.ownerOf(word)) this.save([...this.words(), word].join(', '));
    this.note = { text: `「${word}」を戻しました` };
    this.update();
  }

  update() {
    const words = this.words();
    this.elChips.replaceChildren(
      ...words.map((w) =>
        h(
          'span',
          { class: 'kw-chip' },
          w,
          h('button', {
            type: 'button',
            class: 'kw-del',
            text: '×',
            title: '消す',
            'aria-label': `${w}を消す`,
            onClick: () => this.remove(w),
          }),
        ),
      ),
    );
    this.elMsgs.replaceChildren(...this._messages(words));
  }

  _messages(words) {
    const out = [];
    if (words.length === 0) {
      out.push(h('p', { class: 'kw-msg is-warn', text: 'コメントでは出ません' }));
    }
    if (this.note) {
      const cls = this.note.warn ? 'kw-msg is-warn' : 'kw-msg';
      out.push(h('p', { class: cls, text: this.note.text }));
    }
    if (this.undo && Date.now() - this.undo.at < UNDO_MS) {
      out.push(
        h(
          'p',
          { class: 'kw-msg' },
          `「${this.undo.word}」を消しました`,
          h('button', {
            type: 'button',
            class: 'kw-undo',
            text: '元に戻す',
            onClick: () => this.restore(),
          }),
        ),
      );
    }
    return out;
  }
}
