/**
 * Decides whether the host stays registered on the signaling server ("recruiting").
 *
 * Only new players need the signaling server; players already in the room talk to the host
 * directly. To spare the shared server, recruiting pauses while the room is full and stops when
 * nobody has been online for a while and the host does not confirm that they are still waiting.
 */
import { MULTIPLAYER_CONFIG } from '../config/constants.js';

export const RECRUIT_STATE = Object.freeze({
  OPEN: 'open',
  // Open, but the host is being asked whether to keep recruiting.
  IDLE_PROMPT: 'idle_prompt',
  // Paused automatically; reopens when a seat frees up.
  FULL: 'full',
  // Stopped after the idle prompt went unanswered; reopens only when the host resumes.
  IDLE_STOPPED: 'idle_stopped',
});

export class Recruitment {
  /**
   * @param {object} deps
   * @param {() => number} deps.getOnlineCount players online, host included
   * @param {() => number} deps.getCapacity
   * @param {() => boolean} deps.hasPendingJoins someone is mid-join (auth or approval)
   * @param {(accepting: boolean) => void} deps.setAccepting registers / unregisters the host
   * @param {(state: string) => void} deps.onChange
   * @param {{ setTimeout: Function, clearTimeout: Function }} [deps.timers]
   */
  constructor(deps) {
    this.deps = deps;
    this.timers = deps.timers || globalThis;
    this.promptAfterMs = deps.promptAfterMs ?? MULTIPLAYER_CONFIG.RECRUIT_IDLE_PROMPT_MS;
    this.graceMs = deps.graceMs ?? MULTIPLAYER_CONFIG.RECRUIT_IDLE_GRACE_MS;
    this.active = false;
    this.accepting = true;
    this.idleStopped = false;
    this.idleTimer = null;
    this.graceTimer = null;
    this.state = RECRUIT_STATE.OPEN;
  }

  /** Called once the host is registered and recruiting. */
  start() {
    this.active = true;
    this.accepting = true;
    this.idleStopped = false;
    this.update();
  }

  stop() {
    this.active = false;
    this._clearIdleTimers();
  }

  /** Re-evaluates after anything that changes who is online or waiting. */
  update() {
    if (!this.active) return;
    const anyoneHere = this.deps.getOnlineCount() > 1 || this.deps.hasPendingJoins();
    if (anyoneHere) {
      this._clearIdleTimers();
    } else if (!this.idleStopped && !this.idleTimer && !this.graceTimer) {
      this._armIdleTimer();
    }
    this._apply();
  }

  /** The host answered the idle prompt: keep recruiting and start the idle wait again. */
  keepRecruiting() {
    if (!this.active || this.idleStopped) return;
    this._clearIdleTimers();
    this.update();
  }

  /** The host reopens recruiting after it stopped. */
  resume() {
    if (!this.active) return;
    this.idleStopped = false;
    this._clearIdleTimers();
    this.update();
  }

  _isFull() {
    return this.deps.getOnlineCount() >= this.deps.getCapacity();
  }

  _armIdleTimer() {
    this.idleTimer = this.timers.setTimeout(() => {
      this.idleTimer = null;
      this.graceTimer = this.timers.setTimeout(() => {
        this.graceTimer = null;
        if (this.deps.getOnlineCount() > 1 || this.deps.hasPendingJoins()) {
          this.update();
          return;
        }
        this.idleStopped = true;
        this._apply();
      }, this.graceMs);
      this._apply();
    }, this.promptAfterMs);
  }

  _clearIdleTimers() {
    if (this.idleTimer) this.timers.clearTimeout(this.idleTimer);
    if (this.graceTimer) this.timers.clearTimeout(this.graceTimer);
    this.idleTimer = null;
    this.graceTimer = null;
  }

  _currentState() {
    if (this.idleStopped) return RECRUIT_STATE.IDLE_STOPPED;
    if (this._isFull()) return RECRUIT_STATE.FULL;
    if (this.graceTimer) return RECRUIT_STATE.IDLE_PROMPT;
    return RECRUIT_STATE.OPEN;
  }

  _apply() {
    if (!this.active) return;
    const accepting = !this.idleStopped && !this._isFull();
    if (accepting !== this.accepting) {
      this.accepting = accepting;
      this.deps.setAccepting(accepting);
    }
    const state = this._currentState();
    if (state !== this.state) {
      this.state = state;
      this.deps.onChange(state);
    }
  }
}
