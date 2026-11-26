import { describe, expect, it } from 'vitest';
import { formatShareText } from '../../src/ui/resultModalUI.js';

describe('formatShareText', () => {
  it('formats solo result without ojama or MVP lines when ojamaTotal is zero', () => {
    const text = formatShareText({
      pieceCount: 24,
      elapsedMs: 125_000,
      ojamaTotal: 0,
      isMultiplayer: false,
      roster: [],
    });

    expect(text).toBe(
      [
        '🧩 協力ジグソーパズル（24ピース）を完成させました！',
        '⏱ クリアタイム: 02:05',
        'https://hakage-you.github.io/collab-jigsaw-puzzle/',
      ].join('\n'),
    );
  });

  it('includes ojama count and top contributor MVP in multiplayer', () => {
    const text = formatShareText({
      pieceCount: 100,
      elapsedMs: 754_000,
      ojamaTotal: 15,
      isMultiplayer: true,
      roster: [
        { id: '1', name: 'Aさん', contrib: 28 },
        { id: '2', name: 'Bさん', contrib: 42 },
        { id: '3', name: 'Cさん', contrib: 30 },
      ],
    });

    expect(text).toBe(
      [
        '🧩 協力ジグソーパズル（100ピース）を完成させました！',
        '⏱ クリアタイム: 12:34',
        '😈 乗り越えたお邪魔: 15回',
        '👑 MVP: Bさん（42ピース）',
        'https://hakage-you.github.io/collab-jigsaw-puzzle/',
      ].join('\n'),
    );
  });
});
