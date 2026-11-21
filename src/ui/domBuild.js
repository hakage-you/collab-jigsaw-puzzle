/**
 * A small helper for building DOM nodes without markup strings (innerHTML is not allowed: text
 * always goes in through textContent).
 *
 * h('button', { class: 'btn', type: 'button', onClick: fn }, 'label', otherNode)
 * - `class`, `text` and `dataset` are handled specially; `onXxx` adds an `xxx` listener;
 *   `true` sets an empty attribute, `false` / null / undefined leave it out; anything else is
 *   set as an attribute.
 * - children: nodes, strings (as text) and falsy values (skipped); arrays are flattened.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) setProp(el, key, value);
  append(el, children);
  return el;
}

function setProp(el, key, value) {
  if (value === false || value == null) return;
  if (key === 'class') el.className = value;
  else if (key === 'text') el.textContent = value;
  else if (key === 'dataset') Object.assign(el.dataset, value);
  else if (key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value);
  } else el.setAttribute(key, value === true ? '' : String(value));
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** An on/off switch in the app's style; `onChange` gets the new state. */
export function switchEl({ checked, label = null, onChange, small = false }) {
  const input = h('input', {
    type: 'checkbox',
    class: 'md-switch-input',
    'aria-label': label,
    onChange: () => onChange(input.checked),
  });
  input.checked = Boolean(checked);
  return h(
    'label',
    { class: small ? 'md-switch md-switch-small' : 'md-switch' },
    input,
    h('span', { class: 'md-switch-track' }, h('span', { class: 'md-switch-thumb' })),
  );
}
