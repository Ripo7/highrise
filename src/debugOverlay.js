// ?debug in the URL: a small readout of what each frame costs, to measure optimisations
// before and after on real devices. Updated four times a second.
export function createDebugOverlay(renderer) {
  if (!new URLSearchParams(window.location.search).has('debug')) return null;
  const el = document.createElement('pre');
  el.className = 'debug-overlay';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  let frames = 0;
  let worst = 0;
  let last = performance.now();
  let prev = last;
  return {
    // call once per frame, after rendering
    tick() {
      const now = performance.now();
      worst = Math.max(worst, now - prev);
      prev = now;
      frames++;
      if (now - last < 250) return;
      const info = renderer.info;
      const fps = (frames * 1000) / (now - last);
      el.textContent = [
        `${fps.toFixed(0)} fps · worst ${worst.toFixed(1)} ms`,
        `${info.render.calls} draw calls (shadow pass not counted)`,
        `${(info.render.triangles / 1e6).toFixed(2)} M triangles`,
        `${info.memory.geometries} geometries · ${info.memory.textures} textures`,
        `pixel ratio ${renderer.getPixelRatio().toFixed(2)}`,
      ].join('\n');
      frames = 0;
      worst = 0;
      last = now;
    },
  };
}
