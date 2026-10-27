// Line icons (24×24, stroked) for the building pieces, their categories and the build bar.

export const PIECE_ICONS = {
  mound: '<path d="M2 19h20"/><path d="M4 19c3-10 13-10 16 0"/>',
  hollow: '<path d="M2 8h4c2 0 2 9 6 9s4-9 6-9h4"/>',
  flat: '<path d="M2 5l6 6h8l6 6"/><path d="M8 11h8" stroke-width="3.2"/>',
  steep: '<path d="M2 5c4 0 5 1 7 5s3 8 6 9 4 0 7 0"/><path d="M10 9l3 7" stroke-width="3.2"/>',
  drop: '<path d="M2 7h9v13h11"/><path d="M11 11l-2 2 2 2"/>',
  groom: '<path d="M4 4v16M8 4v16M12 4v16M16 4v16M20 4v16"/>',
  powder: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
  kicker: '<path d="M2 18h20"/><path d="M4 18c7 0 11-2 14-8v8"/>',
  table: '<path d="M2 18h20"/><path d="M3 18 8 11h7l6 7"/>',
  berm: '<path d="M2 18h20"/><path d="M5 18c2-9 12-9 14 0"/>',
  rollers: '<path d="M2 18h20"/><path d="M2 18c2-5 4-5 6 0s4-5 6 0 4-5 6 0"/>',
  trees: '<path d="M7 4 3 11h2.5L2 16h10L8.5 11H11z"/><path d="M16 7l-3.5 6h2L11 18h10l-3.5-5h2z"/><path d="M7 16v3M16 18v3"/>',
  rock: '<path d="M2 20h20"/><path d="M5 20l.5-5L9 10l5-1 4 3 1.5 8"/><path d="m9 10 2 4 3-5M11 14l-5.5 1"/>',
  cliff: '<path d="M2 7h9v13h11"/><path d="M11 11l-2 2 2 2"/><path d="M14 16l2-2 2 2"/>',
  moguls: '<path d="M2 19h20"/><path d="M3 19c1-3 3-3 4 0M10 19c1-3 3-3 4 0M17 19c1-3 3-3 4 0"/><path d="M6 13c1-3 3-3 4 0M13 13c1-3 3-3 4 0"/>',
  gully: '<path d="M2 7c4 0 5 10 10 10s6-10 10-10"/><path d="M8 14c2 1 6 1 8 0" opacity=".5"/>',
  cornice: '<path d="M2 19h20"/><path d="M3 19c5-1 9-7 15-9l-1 3-2 1"/>',
  lake: '<ellipse cx="12" cy="15" rx="9" ry="4.5"/><path d="M7 15h3M13 16.5h4M12 13h3"/>',
  rail: '<path d="M2 19h20"/><path d="M3 11h18"/><path d="M6 11v8M18 11v8"/>',
  box: '<path d="M2 19h20"/><rect x="4" y="11" width="16" height="4" rx="1"/><path d="M7 15v4M17 15v4"/>',
  pipe: '<path d="M2 5c0 9 3 13 6 13h8c3 0 6-4 6-13"/><path d="M2 5h2M20 5h2"/>',
  chalet: '<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/><path d="M10 19v-5h4v5"/>',
  lift: '<path d="M2 6 22 3"/><path d="M12 5v15"/><path d="M8 20h8"/><path d="M6 5.5V10h4"/>',
  bridge: '<path d="M2 9h20"/><path d="M2 12h20"/><path d="M5 12v8M19 12v8"/><path d="M2 20h20" opacity=".5"/>',
  tunnel: '<path d="M2 19h20"/><path d="M3 19v-6a9 9 0 0 1 18 0v6"/><path d="M8 19v-5a4 4 0 0 1 8 0v5"/>',
  net: '<path d="M3 5v15M21 5v15"/><path d="M3 8h18M3 12h18M3 16h18"/><path d="M8 7v12M13 7v12M18 7v12" opacity=".5"/>',
  poles: '<path d="M6 21V5M12 21V5M18 21V5"/><path d="M6 5v3M12 5v3M18 5v3" stroke-width="4"/>',
  gate: '<path d="M5 21V3M19 21V3"/><path d="M5 4h14v6H5z"/>',
  cannon: '<path d="M4 20l4-8 4 8"/><path d="M8 12l8-5"/><circle cx="17.5" cy="6.5" r="2.5"/><path d="M21 3l1-1M22 7h1M20.5 10l1 1"/>',
};

export const CATEGORY_COLORS = {
  terrain: '#4f7be8',
  sculpt: '#8a7aa3',
  jumps: '#ff7a45',
  nature: '#2f9e86',
  park: '#8a6fd8',
  resort: '#b9855d',
  piste: '#ff5d6c',
};

export const BAR_ICONS = {
  look: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>',
  erase: '<path d="M8 20h12"/><path d="M3.5 14.5 12 6l6 6-8.5 8.5H7z"/><path d="m8 10 6 6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>',
  raise: '<path d="M3 19h18M5 19c2-6 4-9 7-9s5 3 7 9"/><path d="M12 3v5M9.5 5.5 12 3l2.5 2.5"/>',
  lower: '<path d="M3 9h18M5 9c2 6 4 9 7 9s5-3 7-9"/><path d="M12 2v5M9.5 4.5 12 7l2.5-2.5"/>',
  smooth: '<path d="M3 9c3-3 5 3 9 0s6 3 9 0"/><path d="M3 15c3-1.5 5 1.5 9 0s6 1.5 9 0"/>',
  flatten: '<path d="M3 15h18"/><path d="M6 11h12"/><path d="M8 7l4-3 4 3"/>',
};
