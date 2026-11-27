/** Longest viewer name put on an ojama sticker (characters); a longer one ends in "…". */
export const NOTICE_NAME_MAX = 12;
/** The name the streamer's own test buttons use: said as is, without "さん". */
export const SELF_NAME = 'あなた';

/** Ways to put the name in front of what happened (`{who}` is the name). */
const LEADS = Object.freeze([
  '{who}の叫びで、',
  '{who}がニヤリとわらうと、',
  '{who}が指を鳴らすと、',
  '{who}のひと声で、',
  '{who}の祈りに呼応して、',
  '{who}の念が届いて、',
]);

/** A viewer's name cut to NOTICE_NAME_MAX characters (emoji count as one). */
export function noticeName(name) {
  const chars = Array.from(String(name).trim());
  return chars.length > NOTICE_NAME_MAX
    ? `${chars.slice(0, NOTICE_NAME_MAX).join('')}…`
    : chars.join('');
}

/**
 * What goes in front of an ojama notice to say who set it off: the name joined by one of a few
 * phrases picked at random ("〇〇さんがニヤリとわらうと、" + "ピース3個がくるりと回転した！").
 * Kept apart from the notice so that the notice (what happened) can stand out. Without a name
 * (random by comment count from no one, a guest's screen) it is ''.
 */
export function triggerNameLead(author, random = Math.random) {
  const name = author == null ? '' : noticeName(author);
  if (!name) return '';
  const who = name === SELF_NAME ? SELF_NAME : `${name}さん`;
  const lead = LEADS[Math.floor(random() * LEADS.length) % LEADS.length];
  return lead.replace('{who}', who);
}
