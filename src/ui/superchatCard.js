import { OJAMA_CONFIG } from '../config/constants.js';
import { sound } from '../services/sound.js';
import { clickSpot, stageSpot } from './stageSpot.js';

/**
 * The giant superchat card over the board: everyone hits it to wear down its shared HP. It stays
 * until driven off, or for the number of seconds the host set (0 = until driven off).
 */
export class SuperchatCard {
  constructor({ app, showToast }) {
    this.app = app;
    this.showToast = showToast;
    this.timerId = null;
    this.remaining = 0;
    this.hp = OJAMA_CONFIG.SUPERCHAT_MAX_HP;
    this.maxHp = OJAMA_CONFIG.SUPERCHAT_MAX_HP;

    this.elLayer = document.getElementById('superchatLayer');
    this.elCard = document.getElementById('superchatCard');
    this.elAuthor = document.getElementById('superchatAuthor');
    this.elAmount = document.getElementById('superchatAmount');
    this.elMessage = document.getElementById('superchatMessage');
    this.elCountdown = document.getElementById('superchatCountdown');
    this.elHpFill = document.getElementById('superchatHpFill');
    this.elHpText = document.getElementById('superchatHpText');

    document.getElementById('btnHitSuperchat').addEventListener('click', (e) => this._hit(e));
    this.app.on('remoteSuperchat', (msg) => this.show(msg));
    this.app.on('remoteSuperchatHp', ({ hp, maxHp }) => this.applyHp(hp, maxHp));
    this.app.on('remoteSuperchatDismiss', () => this.dismiss());
  }

  _hit(e) {
    this.app.emit('superchatHitEffect', clickSpot(this.elLayer.parentElement, e));
    this.elCard.classList.remove('hit-shake');
    void this.elCard.offsetWidth;
    this.elCard.classList.add('hit-shake');
    sound.playTick('ojama');

    // The host gets the new HP back (or null); a guest's hit is only sent, and the HP comes back.
    const nextHp = this.app.hitSuperchat();
    if (typeof nextHp === 'number') this.applyHp(nextHp, this.maxHp);
  }

  applyHp(hp, maxHp) {
    this.hp = hp;
    this.maxHp = maxHp;
    this.elHpText.textContent = String(hp);
    const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
    this.elHpFill.style.width = `${pct}%`;
    if (hp <= 0) {
      if (!this.elLayer.classList.contains('hidden')) {
        this.app.emit('superchatDefeatEffect', stageSpot(this.elLayer.parentElement, this.elCard));
      }
      this.dismiss();
      this.showToast('巨大スパチャを撃退しました', 'success');
    }
  }

  /** Shows the card; `duration` 0 keeps it until driven off, with no countdown on the card. */
  show({ maxHp, duration, author, message, amountDisplay }) {
    this.dismiss();
    this.elAuthor.textContent = author || '視聴者（お邪魔枠）';
    this.elAmount.textContent = amountDisplay || '¥10,000';
    this.elMessage.textContent = message || '完成させるな！中央をブロック中';

    this.remaining = duration;
    this.applyHp(maxHp, maxHp);
    this.elCountdown.textContent = `${duration}s`;
    this.elCountdown.classList.toggle('hidden', !(duration > 0));
    this.elLayer.classList.remove('hidden');

    sound.playOjama();
    this.showToast('巨大スパチャが盤面をブロックしています', 'ojama');

    if (!(duration > 0)) return;
    this.timerId = setInterval(() => {
      this.remaining -= 1;
      if (this.remaining <= 0) this.dismiss();
      else this.elCountdown.textContent = `${this.remaining}s`;
    }, 1000);
  }

  dismiss() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.elLayer.classList.add('hidden');
  }
}
