// Touch controls: on-screen buttons that press the same keys as the keyboard.
//
// Shown only on touch devices. Layout depends on the current level:
//   all levels      — ◀ ▶ (move), ⤒ (jump = Space)
//   gravityToggle   — + G (flip gravity, the key the in-game hint shows), once unlocked
//   horizontalGravity (level 6) — ◀ ▶ pick the wall, ▲ ▼ run, ⤒ jump
// Outside gameplay (title, cutscenes, death, level complete) a tap anywhere
// is Space: start / skip / retry / next dream.
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
                 navigator.maxTouchPoints > 0;

const Touch = (() => {
  if (!IS_TOUCH) return { active: false };

  const style = document.createElement('style');
  style.textContent = `
    #touch { position: fixed; inset: 0; pointer-events: none; z-index: 10;
             -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    #touch .pad { position: absolute; bottom: max(14px, var(--sab, 0px));
                  display: flex; flex-direction: column; gap: 10px; }
    #touch .pad.left  { left:  max(14px, var(--sal, 0px)); }
    #touch .pad.right { right: max(14px, var(--sar, 0px)); align-items: flex-end; }
    #touch .row { display: flex; gap: 10px; }
    #touch .btn { --s: clamp(50px, 15vh, 88px);
                  width: var(--s); height: var(--s); border-radius: 50%;
                  display: flex; align-items: center; justify-content: center;
                  font: bold calc(var(--s) * 0.38) sans-serif; color: #e0ccff;
                  background: rgba(40, 20, 90, 0.42); border: 2px solid rgba(176, 128, 255, 0.55);
                  box-shadow: 0 0 12px rgba(160, 100, 255, 0.25);
                  pointer-events: auto; touch-action: none; }
    #touch .btn.big { --s: clamp(60px, 20vh, 112px); }
    #touch .btn.small { --s: clamp(44px, 13vh, 70px); }
    #touch .btn.on { background: rgba(140, 90, 255, 0.6); border-color: #e0ccff; }
    #touch .btn[hidden] { display: none; }
    #touch.off .pad { display: none; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="pad left">
      <div class="row"><div class="btn" data-key="ArrowUp" data-run>▲</div><div class="btn" data-key="ArrowDown" data-run>▼</div></div>
      <div class="row"><div class="btn" data-key="ArrowLeft">◀</div><div class="btn" data-key="ArrowRight">▶</div></div>
    </div>
    <div class="pad right">
      <div class="btn small" data-key="KeyG" data-grav>G</div>
      <div class="btn big" data-key="Space">⤒</div>
    </div>`;
  document.body.appendChild(root);

  const runBtns  = root.querySelectorAll('[data-run]');
  const gravBtns = root.querySelectorAll('[data-grav]');

  // pointerId → button element it currently holds (fingers may slide between buttons)
  const held = new Map();

  function buttonAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('#touch .btn:not([hidden])') : null;
  }
  function hold(id, btn) {
    const prev = held.get(id) || null;
    if (prev === btn) return;
    if (prev) {
      held.delete(id);
      if (![...held.values()].includes(prev)) { prev.classList.remove('on'); Input.release(prev.dataset.key); }
    }
    if (btn) {
      held.set(id, btn);
      btn.classList.add('on');
      Input.press(btn.dataset.key);
    }
  }

  const playing = () => typeof state !== 'undefined' && typeof State !== 'undefined' && state === State.PLAYING;

  window.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && !IS_TOUCH) return;
    const btn = playing() ? buttonAt(e.clientX, e.clientY) : null;
    if (btn) { e.preventDefault(); hold(e.pointerId, btn); return; }
    // outside gameplay: tap anywhere = Space (start / skip / continue)
    if (!playing()) { held.set(e.pointerId, null); Input.press('Space'); }
  }, { passive: false });

  window.addEventListener('pointermove', e => {
    if (!held.has(e.pointerId) || held.get(e.pointerId) === null) return;
    hold(e.pointerId, buttonAt(e.clientX, e.clientY));
  });

  function end(e) {
    if (!held.has(e.pointerId)) return;
    if (held.get(e.pointerId) === null) { held.delete(e.pointerId); Input.release('Space'); return; }
    hold(e.pointerId, null);
    held.delete(e.pointerId);
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('contextmenu', e => e.preventDefault());

  // Show the buttons the current level needs.
  function sync() {
    const on = playing() && typeof level !== 'undefined' && level;
    root.classList.toggle('off', !on);
    if (on) {
      runBtns.forEach(b => { b.hidden = !level.horizontalGravity; });
      gravBtns.forEach(b => { b.hidden = !(level.gravityToggle && !gravLocked); });
    }
    if (!on) {
      // leaving gameplay with a finger down must not leave a key stuck
      for (const [id, btn] of held) if (btn) { hold(id, null); held.delete(id); }
    }
    requestAnimationFrame(sync);
  }
  requestAnimationFrame(sync);

  return { active: true };
})();
