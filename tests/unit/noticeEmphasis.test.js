import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from '../../src/ui/domBuild.js';
import { OjamaStickers } from '../../src/ui/ojamaStickers.js';
import { richText } from '../../src/ui/richText.js';

// Bold where it matters: the way back in a toast (richText), and what happened on an ojama
// sticker, with who set it off in lighter type in front.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('richText', () => {
  it('puts a plain string in as text', () => {
    const el = h('div', {}, richText('保存しました'));
    expect(el.textContent).toBe('保存しました');
    expect(el.querySelector('strong')).toBeNull();
  });

  it('puts the strong parts in bold, the rest as text, in order', () => {
    const el = h('div', {}, richText(['オフにしました。', { strong: 'A → B' }, 'で戻せます。']));
    expect(el.textContent).toBe('オフにしました。A → Bで戻せます。');
    expect([...el.querySelectorAll('strong')].map((s) => s.textContent)).toEqual(['A → B']);
  });

  it('never reads a part as markup', () => {
    const el = h('div', {}, richText(['<img src=x>', { strong: '<b>x</b>' }]));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('<img src=x><b>x</b>');
  });
});

describe('OjamaStickers', () => {
  function showSticker(notice) {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="ojamaStickers"></div>';
    new OjamaStickers().show(notice);
    return document.querySelector('.ojama-sticker');
  }

  it('puts who set it off first, apart from what happened, which is in bold', () => {
    const sticker = showSticker({
      kind: 'drop',
      lead: 'たろうさんの叫びで、',
      text: 'ピースが2個、ポロッと外れてしまった！',
    });
    expect(sticker.textContent).toBe('たろうさんの叫びで、ピースが2個、ポロッと外れてしまった！');
    expect(sticker.querySelector('.ojama-sticker-lead').textContent).toBe('たろうさんの叫びで、');
    const effect = sticker.querySelector('strong.ojama-sticker-effect');
    expect(effect.textContent).toBe('ピースが2個、ポロッと外れてしまった！');
  });

  it('shows only what happened without a name (as on a guest screen)', () => {
    const sticker = showSticker({ kind: 'visual', text: '世界から色が消えてしまった！（8秒）' });
    expect(sticker.querySelector('.ojama-sticker-lead')).toBeNull();
    expect(sticker.textContent).toBe('世界から色が消えてしまった！（8秒）');
  });

  it('never reads a name as markup', () => {
    const sticker = showSticker({ kind: 'drop', lead: '<img src=x>さんの', text: '外れた！' });
    expect(sticker.querySelector('img')).toBeNull();
    expect(sticker.textContent).toBe('<img src=x>さんの外れた！');
  });
});
