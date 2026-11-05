// The on-screen pad for phones and tablets: a PS2 pad over the picture (finding 141's Classic pad
// in spirit, built in the page because the browser build has no touch.c or overlay of its own).
// Every touch is plain pad input for player 1, merged into the pad main.js writes for the worker:
// the left stick (in the menus also the d-pad, so the menus move), ✕ ○ □ △, L1/L2/R1/R2,
// SELECT and START. A finger that slides from one button onto another presses that one instead.

// libpad's bits (worker.js P)
const B = { SELECT: 1, START: 8, UP: 16, RIGHT: 32, DOWN: 64, LEFT: 128, L2: 256, R2: 512, L1: 1024, R1: 2048,
  TRIANGLE: 4096, CIRCLE: 8192, CROSS: 16384, SQUARE: 32768 };
const BUTTONS = [  // [class, label, bit]
  ['b-cross', '✕', B.CROSS], ['b-circle', '○', B.CIRCLE], ['b-square', '□', B.SQUARE], ['b-triangle', '△', B.TRIANGLE],
  ['b-l1', 'L1', B.L1], ['b-l2', 'L2', B.L2], ['b-r1', 'R1', B.R1], ['b-r2', 'R2', B.R2],
  ['b-select', 'SELECT', B.SELECT], ['b-start', 'START', B.START]];

export function createTouchPad({ root, riding, extra = [] }) {
  const pad = document.createElement('div'); pad.className = 'touchpad'; pad.hidden = true;
  pad.innerHTML = '<div class="t-stick"><div class="t-knob"></div></div>' +
    BUTTONS.map(([c, label]) => `<button type="button" class="t-btn ${c}" tabindex="-1">${label}</button>`).join('') +
    '<div class="t-bar"></div>';
  root.append(pad);
  for (const [label, title, action] of extra) {  // the page's own small buttons (lobby, fullscreen)
    const b = document.createElement('button'); b.type = 'button'; b.className = 't-tool'; b.textContent = label;
    b.title = title; b.tabIndex = -1; b.addEventListener('pointerdown', e => { e.stopPropagation(); action(); });
    pad.querySelector('.t-bar').append(b);
  }
  const buttons = [...pad.querySelectorAll('.t-btn')].map((el, i) => ({ el, bit: BUTTONS[i][2] }));
  const base = pad.querySelector('.t-stick'), knob = pad.querySelector('.t-knob');
  const fingers = new Map();  // pointerId -> a button, or 'stick'
  let stick = null, x = 0, y = 0;

  const buttonAt = (cx, cy) => buttons.find(b => { const r = b.el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; });
  function press(id, b) {
    const was = fingers.get(id); if (was === b) return;
    fingers.set(id, b); if (b && b !== 'stick') navigator.vibrate?.(8);
    paint();
  }
  function moveStick(cx, cy) {
    const r = base.getBoundingClientRect(), radius = r.width / 2;
    let dx = (cx - (r.left + radius)) / radius, dy = (cy - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
    x = dx; y = dy; knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
  }
  function release(id) {
    if (fingers.get(id) === 'stick') { stick = null; x = y = 0; knob.style.transform = ''; }
    fingers.delete(id); paint();
  }
  function paint() { const down = new Set(fingers.values()); buttons.forEach(b => b.el.classList.toggle('on', down.has(b))); }

  pad.addEventListener('pointerdown', e => {
    if (e.target.closest('.t-tool')) return;
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch {}  // its moves keep coming here when it slides off
    if (e.target.closest('.t-stick')) { stick = e.pointerId; fingers.set(e.pointerId, 'stick'); moveStick(e.clientX, e.clientY); return; }
    const b = buttonAt(e.clientX, e.clientY); if (b) press(e.pointerId, b);
  });
  pad.addEventListener('pointermove', e => {
    if (!fingers.has(e.pointerId)) return;
    if (e.pointerId === stick) moveStick(e.clientX, e.clientY);
    else press(e.pointerId, buttonAt(e.clientX, e.clientY) || null);  // slide-on, slide-off
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(type, e => release(e.pointerId));
  pad.addEventListener('contextmenu', e => e.preventDefault());

  return {
    get shown() { return !pad.hidden; },
    show(on) { pad.hidden = !on; if (!on) { fingers.clear(); stick = null; x = y = 0; knob.style.transform = ''; paint(); } },
    // player 1's input from the pad: libpad bits and the left stick (0..255, 128 centred)
    state() {
      let bits = 0; for (const b of fingers.values()) if (b && b !== 'stick') bits |= b.bit;
      // the menus move by the d-pad: the stick pushed past half way gives its direction too
      if (stick !== null && !riding()) {
        if (Math.abs(x) > 0.5 && Math.abs(x) >= Math.abs(y)) bits |= x < 0 ? B.LEFT : B.RIGHT;
        else if (Math.abs(y) > 0.5) bits |= y < 0 ? B.UP : B.DOWN;
      }
      const axis = v => Math.max(0, Math.min(255, Math.round(128 + v * 127.5)));
      return { active: stick !== null || bits !== 0, bits, lx: axis(x), ly: axis(y) };
    },
  };
}
