// Line icons (24×24, stroked) for the build bar.

export const PIECE_ICONS = {
  bump: '<path d="M2 19h20"/><path d="M4 19c3-10 13-10 16 0"/>',
  hollow: '<path d="M2 8h4c2 0 2 9 6 9s4-9 6-9h4"/>',
  flat: '<path d="M2 5l6 6h8l6 6"/><path d="M8 11h8" stroke-width="3.2"/>',
  wall: '<path d="M2 5c4 0 5 1 7 5s3 8 6 9 4 0 7 0"/><path d="M10 9l3 7" stroke-width="3.2"/>',
  rocks: '<path d="M2 7h9v13h11"/><path d="M11 9l-2 3 2 2-1 3"/><path d="M5 7l1-2 2 1"/>',
  forest: '<path d="M7 4 3 11h2.5L2 16h10L8.5 11H11z"/><path d="M16 7l-3.5 6h2L11 18h10l-3.5-5h2z"/><path d="M7 16v3M16 18v3"/>',
  clearing: '<path d="M5 6 2.5 11H4l-2 4h7l-2-4h1.5z"/><path d="M19 6l-2.5 5H18l-2 4h7l-2-4h1.5z"/><path d="M5 15v3M19 15v3"/><ellipse cx="12" cy="18" rx="4" ry="1.6"/>',
  powder: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
};

export const CATEGORY_COLORS = {
  terrain: '#4f7be8',
  nature: '#2f9e86',
};

export const BAR_ICONS = {
  look: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>',
  erase: '<path d="M8 20h12"/><path d="M3.5 14.5 12 6l6 6-8.5 8.5H7z"/><path d="m8 10 6 6"/>',
  start: '<path d="M5 21V4"/><path d="M5 4h12l-3 3.5 3 3.5H5"/>',
};
