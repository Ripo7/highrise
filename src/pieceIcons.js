// Line icons (24×24, stroked) for the build bar.

export const ACTION_ICONS = {
  // shape
  raise: '<path d="M2 21h20"/><path d="M4 21c2-7 14-7 16 0"/><path d="M12 13V3"/><path d="m8.5 6.5 3.5-3.5 3.5 3.5"/>',
  lower: '<path d="M2 8h4c2 0 2.5 8 6 8s4-8 6-8h4"/><path d="M12 3v9"/><path d="m8.5 8.5 3.5 3.5 3.5-3.5"/>',
  flatten: '<path d="M2 5l6 6h8l6 6"/><path d="M8 11h8" stroke-width="3.2"/>',
  smooth: '<path d="M2 8c2-3 3 3 5 0s3 3 5 0 3 3 5 0 3 3 5 0"/><path d="M2 17h20"/><path d="M12 11v3"/>',
  steepen: '<path d="M2 5c4 0 5 1 7 5s3 8 6 9 4 0 7 0"/><path d="M10 9l3 7" stroke-width="3.2"/>',
  ease: '<path d="M2 7c5 0 7 3 10 6s6 5 10 5"/><path d="M8 9l7 6" stroke-width="3.2"/>',
  // features
  jump: '<path d="M2 20h6c4 0 7-3 9-8v8h5"/><path d="M18 8c1.5-2 3-2.5 4-2" stroke-dasharray="2 2"/>',
  drop: '<path d="M2 8h9v12h11"/><path d="M13 6c3 0 5 3 6 8" stroke-dasharray="2 2.2"/>',
  rocks: '<path d="M2 7h9v13h11"/><path d="M11 9l-2 3 2 2-1 3"/><path d="M5 7l1-2 2 1"/>',
  gate: '<path d="M7 21V3M17 21V3"/><path d="M7 3H3v6h4M17 3h4v6h-4" fill="currentColor" fill-opacity=".25"/><path d="M9 19h6" stroke-dasharray="2 2"/>',
  // nature
  trees: '<path d="M7 4 3 11h2.5L2 16h10L8.5 11H11z"/><path d="M16 7l-3.5 6h2L11 18h10l-3.5-5h2z"/><path d="M7 16v3M16 18v3"/>',
  clear: '<path d="M5 6 2.5 11H4l-2 4h7l-2-4h1.5z"/><path d="M19 6l-2.5 5H18l-2 4h7l-2-4h1.5z"/><path d="M5 15v3M19 15v3"/><ellipse cx="12" cy="18" rx="4" ry="1.6"/>',
  powder: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
  ice: '<path d="M3 17l4-9h14l-4 9z"/><path d="M10 10l-2 5M14 10l-1.2 3"/>',
  // tools
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2"/><path d="M9 11h6M9 15h4"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
  erase: '<path d="M8 20h12"/><path d="M3.5 14.5 12 6l6 6-8.5 8.5H7z"/><path d="m8 10 6 6"/>',
};

// tints: each tab of actions, and what the tiles show on the snow
export const CATEGORY_COLORS = {
  shape: '#4f7be8',
  features: '#e8763a',
  nature: '#2f9e86',
  tools: '#6b5b95',
  select: '#ffb020',
};

export const BAR_ICONS = {
  look: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>',
  select: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" stroke-dasharray="3.2 2.2"/><path d="m11 9 6.5 3.5-3 1 2 3.2-1.6 1-2-3.2-2 2z" fill="currentColor" stroke-width="1.2"/>',
  start: '<path d="M5 21V4"/><path d="M5 4h12l-3 3.5 3 3.5H5"/>',
};
