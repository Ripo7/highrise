import { Heightfield } from '../core/heightfield.js';
import { simulateLine } from './previewSim.js';

// Background thread for the line preview, so sculpting never stutters while it runs.
const hf = new Heightfield();

self.onmessage = (e) => {
  const { id, h, start } = e.data;
  hf.h = h;
  const result = simulateLine(hf, start);
  self.postMessage({ id, ...result }, [result.pts.buffer]);
};
