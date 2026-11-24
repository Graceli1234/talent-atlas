const hero = document.getElementById('welcome');
const canvas = document.getElementById('hero-water');
const context = canvas.getContext('2d');

if (context) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lifetime = 2100;
  const waves = [];
  let frame = 0;
  let lastPoint;
  let width = 0;
  let height = 0;

  function resize() {
    const size = hero.getBoundingClientRect();
    if (!size.width || !size.height) {
      clearWater();
      return;
    }
    width = size.width;
    height = size.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function clearWater() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastPoint = undefined;
    waves.length = 0;
    context.clearRect(0, 0, width, height);
  }

  function strokeWave(wave, radius, opacity, index) {
    const yRadius = radius * .58;
    const light = context.createLinearGradient(wave.x - radius, wave.y - yRadius, wave.x + radius, wave.y + yRadius);
    light.addColorStop(0, 'rgba(106, 155, 255, 0)');
    light.addColorStop(.28, `rgba(136, 179, 255, ${opacity})`);
    light.addColorStop(.59, `rgba(164, 191, 255, ${opacity * .78})`);
    light.addColorStop(1, 'rgba(83, 124, 230, 0)');

    context.beginPath();
    for (let step = 0; step <= 80; step++) {
      const angle = step / 80 * Math.PI * 2;
      const edge = 1 + .028 * Math.sin(3 * angle + wave.phase + index) +
        .012 * Math.cos(7 * angle - wave.phase);
      const x = wave.x + Math.cos(angle) * radius * edge;
      const y = wave.y + Math.sin(angle) * yRadius * edge;
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.lineWidth = 6;
    context.strokeStyle = `rgba(73, 120, 255, ${opacity * .2})`;
    context.stroke();
    context.lineWidth = 1.1;
    context.strokeStyle = light;
    context.stroke();
  }

  function draw(now) {
    frame = 0;
    context.clearRect(0, 0, width, height);
    while (waves.length && now - waves[0].time > lifetime) waves.shift();
    for (const wave of waves) {
      const age = Math.max(0, now - wave.time);
      const fade = (1 - age / lifetime) ** 1.55;
      for (let ring = 0; ring < 3; ring++) {
        const radius = 8 + age * .18 - ring * 23;
        if (radius > 4) strokeWave(wave, radius, wave.strength * fade * (.82 ** ring), ring);
      }
    }
    if (waves.length) frame = requestAnimationFrame(draw);
  }

  function disturb(event, pressed) {
    if (reducedMotion.matches || hero.hidden || (event.pointerType === 'touch' && !event.isPrimary)) return;
    const now = performance.now();
    const bounds = hero.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (!pressed && lastPoint &&
        (now - lastPoint.time < 76 || Math.hypot(x - lastPoint.x, y - lastPoint.y) < 24)) return;

    lastPoint = { x, y, time: now };
    waves.push({ ...lastPoint, phase: (x + y) * .03, strength: pressed ? .74 : .43 });
    if (waves.length > 13) waves.shift();
    if (!frame) frame = requestAnimationFrame(draw);
  }

  new ResizeObserver(resize).observe(hero);
  reducedMotion.addEventListener('change', clearWater);
  hero.addEventListener('pointerdown', event => disturb(event, true), { passive: true });
  hero.addEventListener('pointermove', event => disturb(event, false), { passive: true });
  hero.addEventListener('pointerleave', () => { lastPoint = undefined; });
}
