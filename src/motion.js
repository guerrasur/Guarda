// Motion is progressive enhancement: storage and navigation never depend on it.
const easing = 'cubic-bezier(.2,.8,.2,1)';
const active = new Map();
const departures = new Set();
export function canAnimate(env = globalThis) {
  return !env.document?.hidden && !env.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
export function cancelMotion(element) {
  for (const animation of active.get(element) || []) animation.cancel();
  active.delete(element);
}
export function animate(element, frames, { duration = 220, ...options } = {}, env = globalThis) {
  if (!element?.animate || !canAnimate(env)) return Promise.resolve();
  try {
    const animation = element.animate(frames, { duration, easing, ...options });
    const running = active.get(element) || new Set();
    running.add(animation);
    active.set(element, running);
    return animation.finished.catch(() => {}).finally(() => {
      // Retained closing frames must remain cancellable after finishing,
      // including a failed save and the next opening of the same note.
      if (options.fill === 'forwards') return;
      running.delete(animation);
      if (!running.size) active.delete(element);
    });
  } catch { return Promise.resolve(); }
}
function visible(rect, env) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < env.innerHeight && rect.right > 0 && rect.left < env.innerWidth;
}
export function noteElement(area, id) {
  // IDs from imported notes need not be valid CSS selectors.
  return [...area.querySelectorAll('[data-note]')].find(card => card.dataset.note === id);
}
export function captureBoard(area, env = globalThis) {
  if (!canAnimate(env) || env.document.body.classList.contains('editor-open')) return new Map();
  const snapshot = new Map();
  for (const card of area.querySelectorAll('[data-note]')) {
    const rect = card.getBoundingClientRect();
    if (visible(rect, env) && snapshot.size < 40) snapshot.set(card.dataset.note, { rect, card });
    cancelMotion(card);
  }
  return snapshot;
}
export function animateBoard(area, before, env = globalThis) {
  for (const ghost of departures) { cancelMotion(ghost); ghost.remove(); }
  departures.clear();
  if (!canAnimate(env) || env.document.body.classList.contains('editor-open')) return;
  const cards = [...area.querySelectorAll('[data-note]')];
  const currentIds = new Set(cards.map(card => card.dataset.note));
  // A short, inert visual copy lets archive/delete/filter actions leave smoothly
  // after the real DOM and stored data have already been updated.
  for (const [id, { card, rect }] of before) {
    if (currentIds.has(id) || departures.size >= 4) continue;
    const ghost = card.cloneNode(true);
    ghost.removeAttribute('data-note');
    ghost.removeAttribute('id');
    for (const child of ghost.querySelectorAll('[id]')) child.removeAttribute('id');
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('motion-departure');
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    env.document.body.append(ghost);
    departures.add(ghost);
    animate(ghost, [{ opacity: .65, transform: 'scale(1)' }, { opacity: 0, transform: 'translateY(-8px) scale(.96)' }], { duration: 140 }, env)
      .finally(() => { ghost.remove(); departures.delete(ghost); });
  }
  let count = 0;
  for (const card of cards) {
    const previous = before.get(card.dataset.note);
    const rect = card.getBoundingClientRect();
    if (!visible(rect, env) || count >= 40) continue;
    if (previous) {
      const x = previous.rect.left - rect.left, y = previous.rect.top - rect.top;
      if (Math.abs(x) + Math.abs(y) > 1) animate(card, [
        { transform: `translate(${x}px,${y}px)` }, { transform: 'translate(0,0)' }
      ], {}, env);
    } else {
      animate(card, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180 }, env);
    }
    count++;
  }
}
export function animateEditor(editor, origin, closing = false, env = globalThis) {
  cancelMotion(editor);
  const layer = editor.parentElement?.classList.contains('modal-layer') ? editor.parentElement : null;
  if (layer) cancelMotion(layer);
  const rect = editor.getBoundingClientRect();
  // Keep the text readable during the transition, including full-screen iOS notes.
  const x = origin ? Math.max(-80, Math.min(80, origin.left + origin.width / 2 - rect.left - rect.width / 2)) : 0;
  const y = origin ? Math.max(-60, Math.min(60, origin.top + origin.height / 2 - rect.top - Math.min(rect.height, env.innerHeight) / 2)) : 20;
  // A transformed ancestor changes the containing block of fixed toolbars.
  // Full-screen mobile editors therefore fade without moving their controls.
  const mobile = env.innerWidth <= 600;
  const small = mobile ? { opacity: 0 } : { opacity: 0, transform: `translate(${x}px,${y}px) scale(.96)` };
  const full = mobile ? { opacity: 1 } : { opacity: 1, transform: 'translate(0,0) scale(1)' };
  return animate(mobile && layer ? layer : editor, closing ? [full, small] : [small, full], { duration: closing ? 120 : 180, fill: closing ? 'forwards' : 'none' }, env);
}
export function animateSurface(element) {
  cancelMotion(element);
  return animate(element, [{ opacity: 0, transform: 'translateY(6px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 160 });
}
