/**
 * Points on the canvas stage in CSS px from its top left: where top-layer effects are drawn
 * (ViewState.playOverlayEffect).
 */

/** The middle of element `el`. */
export function stageSpot(stage, el) {
  const s = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
}

/** Where a click landed: the pointer, or the button's middle when pressed from the keyboard. */
export function clickSpot(stage, e) {
  if (e.detail === 0) return stageSpot(stage, e.currentTarget);
  const s = stage.getBoundingClientRect();
  return { x: e.clientX - s.left, y: e.clientY - s.top };
}
