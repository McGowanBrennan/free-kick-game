// Phone-shaped flick pads: capture a pointer path at full rate and hand the
// samples plus the pad height (the stand-in for screen height) to a callback.

import type { SwipeSample } from '@fk/shared';

export function attachPad(el: HTMLElement, onSwipe: (samples: SwipeSample[], height: number) => void): void {
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let samples: SwipeSample[] = [];
  let active = false;

  const fit = () => {
    canvas.width = el.clientWidth * devicePixelRatio;
    canvas.height = el.clientHeight * devicePixelRatio;
  };
  fit();
  new ResizeObserver(fit).observe(el);

  const local = (e: PointerEvent): SwipeSample => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (samples.length < 2) return;
    ctx.strokeStyle = active ? '#ffe066' : 'rgba(255,224,102,0.5)';
    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.lineCap = 'round';
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = s.x * devicePixelRatio;
      const y = s.y * devicePixelRatio;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    active = true;
    samples = [local(e)];
    draw();
  });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) samples.push(local(ev));
    draw();
  });
  const finish = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    samples.push(local(e));
    draw();
    onSwipe(samples, el.clientHeight);
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => (active = false));
}
