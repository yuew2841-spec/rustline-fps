// Keyboard + mouse input. Pointer lock on the canvas; the game reads a plain
// key-state object each fixed step. No input is sampled inside the render loop.
export function createInput(canvas, onLockChange) {
  const keys = {};
  const mouse = { dx: 0, dy: 0, down: false, rightDown: false };
  let locked = false;

  function onKeyDown(e) {
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) { keys[e.code] = false; }
  function onMouseMove(e) {
    if (!locked) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  }
  function onMouseDown(e) {
    if (!locked) return;
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) mouse.rightDown = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.rightDown = false;
  }
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(locked);
  }
  function onContext(e) { e.preventDefault(); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onLock);

  return {
    keys,
    mouse,
    get locked() { return locked; },
    requestLock() {
      if (document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock(); } catch { /* headless: ignore */ }
      }
    },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    // Consume the accumulated mouse delta once per fixed step.
    consumeMouse() {
      const out = { dx: mouse.dx, dy: mouse.dy };
      mouse.dx = 0;
      mouse.dy = 0;
      return out;
    },
    // Test hooks: synthetic input for headless playtesting.
    _setKey(code, v) { keys[code] = v; },
    _setMouseDown(v) { mouse.down = v; },
  };
}
