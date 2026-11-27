import { describe, expect, it } from 'vitest';
import {
  NOTICE_NAME_MAX,
  SELF_NAME,
  noticeName,
  triggerNameLead,
} from '../../src/app/ojamaNotice.js';

// The name of whoever set an ojama off, in front of its notice (settings.ojama.showTriggerName).

const first = () => 0;
const TEXT = 'ピース3個がくるりと回転した！';

describe('triggerNameLead', () => {
  it('puts the viewer, with さん, in front of what happened', () => {
    expect(triggerNameLead('たろう', first)).toBe('たろうさんの叫びで、');
    expect(triggerNameLead('たろう', first) + TEXT).toBe(`たろうさんの叫びで、${TEXT}`);
  });

  it('picks one of several ways to say it', () => {
    const said = new Set();
    for (let i = 0; i < 6; i++) said.add(triggerNameLead('たろう', () => i / 6));
    expect(said.size).toBe(6);
    for (const s of said) expect(s.startsWith('たろうさん')).toBe(true);
  });

  it('calls the streamer by the test buttons name, without さん', () => {
    expect(triggerNameLead(SELF_NAME, first)).toBe(`${SELF_NAME}の叫びで、`);
  });

  it('is empty without a name', () => {
    expect(triggerNameLead(null, first)).toBe('');
    expect(triggerNameLead(undefined, first)).toBe('');
    expect(triggerNameLead('   ', first)).toBe('');
  });
});

describe('noticeName', () => {
  it(`cuts a name longer than ${NOTICE_NAME_MAX} characters, counting an emoji as one`, () => {
    expect(noticeName('あいうえおかきくけこさし')).toBe('あいうえおかきくけこさし');
    expect(noticeName('あいうえおかきくけこさしす')).toBe('あいうえおかきくけこさし…');
    expect(noticeName('🧩🧩🧩🧩🧩🧩🧩🧩🧩🧩🧩🧩🧩')).toBe(`${'🧩'.repeat(12)}…`);
  });
});
