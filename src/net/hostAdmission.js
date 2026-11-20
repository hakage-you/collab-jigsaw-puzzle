import { MULTIPLAYER_CONFIG } from '../config/constants.js';
import { recordDiagnostic } from '../services/diagnostics.js';
import { MSG, generateToken, computeChallengeHash } from './protocol.js';

/** Passcode challenge response, knock/admission decision for a pending connection. */
export async function handleAuthResponse(session, connId, msg) {
  const auth = session.pendingAuth.get(connId);
  if (!auth) return;
  const expected = await computeChallengeHash(auth.nonce, session.passcode);
  if (msg.hash !== expected) {
    recordDiagnostic('p2p', 'host_auth_failed', { reason: 'passcode_mismatch' }, 'warn');
    session.room.transport.sendTo(connId, { type: MSG.AUTH_ERROR, reason: '合言葉が一致しません' });
    session.pendingAuth.delete(connId);
    setTimeout(() => session.room.transport?.disconnect(connId), 100);
    return;
  }
  if (session.getOnlineCount() >= session.capacity) {
    session.room.transport.sendTo(connId, { type: MSG.AUTH_ERROR, reason: '部屋が満員です' });
    session.pendingAuth.delete(connId);
    setTimeout(() => session.room.transport?.disconnect(connId), 100);
    return;
  }

  session.pendingAuth.delete(connId);
  const displayName =
    String(msg.displayName || 'ゲスト')
      .trim()
      .slice(0, 20) || 'ゲスト';
  if (session.requireApproval) {
    session.pendingKnocks.set(connId, { connId, displayName });
    session.room.transport.sendTo(connId, { type: MSG.KNOCK_PENDING });
    session.room.cb.onKnockRequest({ connId, displayName });
  } else {
    admitNewGuest(session, connId, displayName);
  }
}

/** Reconnect of a previously admitted guest using its player id and reconnect token. */
export function handleRejoin(session, connId, msg) {
  session.pendingAuth.delete(connId);
  const existing = session.guests.get(msg.playerId);
  if (!existing || existing.online || existing.reconnectToken !== msg.reconnectToken) {
    session.room.transport.sendTo(connId, {
      type: MSG.AUTH_ERROR,
      reason: '再接続トークンが無効です。新しく参加してください',
    });
    setTimeout(() => session.room.transport?.disconnect(connId), 100);
    return;
  }
  if (session.getOnlineCount() >= session.capacity) {
    session.room.transport.sendTo(connId, { type: MSG.AUTH_ERROR, reason: '部屋が満員です' });
    return;
  }

  existing.connId = connId;
  existing.online = true;
  if (msg.displayName) {
    existing.name = String(msg.displayName).trim().slice(0, 20) || existing.name;
  }
  session.connToPlayer.set(connId, existing.id);
  session._sendWelcomeToGuest(existing);
  session.syncRoster();
}

/** Admits a guest: reattaches an offline guest with the same name, or creates a new guest entry. */
export function admitNewGuest(session, connId, displayName) {
  const offlineMatch = Array.from(session.guests.values()).find(
    (g) => !g.online && g.name === displayName,
  );
  if (offlineMatch) {
    offlineMatch.connId = connId;
    offlineMatch.online = true;
    offlineMatch.reconnectToken = generateToken();
    session.connToPlayer.set(connId, offlineMatch.id);
    session._sendWelcomeToGuest(offlineMatch);
    session.syncRoster();
    return;
  }

  const saved = session.room.claimSavedGuestContrib(displayName);
  const idx = session.guests.size;
  const playerId = `p-${generateToken().slice(0, 8)}`;
  const reconnectToken = generateToken();
  const color =
    saved?.color ||
    MULTIPLAYER_CONFIG.PLAYER_COLORS[(idx + 1) % MULTIPLAYER_CONFIG.PLAYER_COLORS.length];

  const guest = {
    id: playerId,
    connId,
    name: displayName,
    color,
    role: 'guest',
    contrib: saved ? saved.contrib : 0,
    online: true,
    reconnectToken,
  };
  session.guests.set(playerId, guest);
  session.connToPlayer.set(connId, playerId);
  session._sendWelcomeToGuest(guest);
  session.syncRoster();
}
