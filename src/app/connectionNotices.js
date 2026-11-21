/**
 * Notices for connection events a player must not miss. They are shown in a modal that stays
 * until the player closes it (toasts disappear on their own and are easy to overlook).
 */

/** The guest lost the host: explain how to get the same seat back. */
const DISCONNECT_TITLE = 'ホストとの接続が切れました';

export function disconnectNotice(reason, canRejoin) {
  // The plain "connection lost" reason would only repeat the title.
  const message = reason === DISCONNECT_TITLE ? '' : reason;
  if (!canRejoin) {
    return {
      title: DISCONNECT_TITLE,
      message,
      hint: '参加を続けるには、招待URLからもう一度入室してください。',
      action: null,
    };
  }
  return {
    title: DISCONNECT_TITLE,
    message,
    hint:
      '自動では再参加しません。このタブのまま「再参加する」を押すと、元の席・色・貢献度で戻れます。' +
      'タブを閉じたり、別のタブやブラウザで開き直したりすると、新しい参加者として扱われます。' +
      '満席の部屋では、戻れるようになるまで30秒ほどかかることがあります。',
    action: { id: 'rejoin', label: '再参加する' },
  };
}

/** The host removed this guest (or another connection took over the seat). */
export function kickedNotice(reason) {
  return {
    title: '部屋から退出しました',
    message: reason,
    hint: '',
    action: null,
  };
}
