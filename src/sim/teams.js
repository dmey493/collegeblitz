// Team definitions. States only — no school names, mascots or logos.
// Outlines are rough [lon, lat] silhouettes used for logos and midfield art.

const INDIANA_OUTLINE = [
  [-87.525, 41.708], [-87.3, 41.62], [-87.0, 41.67], [-86.82, 41.76], [-84.806, 41.76],
  [-84.82, 39.105], [-84.9, 38.9], [-84.8, 38.78], [-85.17, 38.69], [-85.45, 38.73],
  [-85.6, 38.45], [-85.83, 38.28], [-86.03, 38.05], [-86.3, 38.17], [-86.52, 37.92],
  [-86.8, 37.98], [-87.05, 37.8], [-87.3, 37.93], [-87.58, 37.97], [-87.65, 37.83],
  [-87.94, 37.77], [-88.03, 37.8], [-87.92, 38.15], [-87.75, 38.4], [-87.53, 38.68],
  [-87.5, 38.9], [-87.62, 39.12], [-87.53, 39.35], [-87.525, 41.708],
];

const MICHIGAN_LOWER = [
  [-86.82, 41.76], [-86.48, 42.1], [-86.27, 42.4], [-86.21, 42.79], [-86.23, 43.06],
  [-86.33, 43.23], [-86.45, 43.95], [-86.25, 44.69], [-86.05, 44.88], [-85.63, 45.21],
  [-85.62, 44.77], [-85.4, 45.0], [-85.26, 45.32], [-84.95, 45.37], [-85.1, 45.75],
  [-84.73, 45.78], [-84.47, 45.65], [-83.82, 45.42], [-83.47, 45.35], [-83.43, 45.06],
  [-83.32, 44.9], [-83.33, 44.42], [-83.45, 44.25], [-83.87, 44.04], [-83.88, 43.62],
  [-83.27, 43.94], [-83.0, 44.05], [-82.65, 43.84], [-82.54, 43.43], [-82.42, 42.97],
  [-82.5, 42.62], [-82.87, 42.6], [-83.05, 42.33], [-83.13, 42.05], [-83.4, 41.92],
  [-83.45, 41.73], [-84.81, 41.7], [-86.82, 41.76],
];

const MICHIGAN_UPPER = [
  [-84.35, 46.5], [-84.96, 46.77], [-85.98, 46.67], [-86.65, 46.42], [-87.38, 46.54],
  [-87.73, 46.83], [-88.0, 46.88], [-88.45, 46.78], [-88.25, 47.0], [-88.0, 47.25],
  [-87.82, 47.43], [-88.15, 47.46], [-88.55, 47.27], [-88.95, 47.03], [-89.31, 46.87],
  [-89.9, 46.65], [-90.42, 46.57], [-89.09, 46.14], [-88.68, 46.01], [-88.12, 45.94],
  [-87.8, 45.7], [-87.62, 45.1], [-87.35, 45.4], [-87.06, 45.75], [-86.95, 45.85],
  [-86.65, 45.62], [-86.25, 45.96], [-85.45, 46.09], [-84.73, 45.87], [-84.36, 45.99],
  [-83.9, 45.99], [-83.6, 46.0], [-84.1, 46.25], [-84.35, 46.5],
];

export const TEAMS = {
  IND: {
    id: 'IND',
    name: 'INDIANA',
    abbr: 'IND',
    style: 'air',
    blurb: 'Spread it out and sling it deep.',
    ratings: { pass: 8, rush: 6, defense: 7, speed: 8 },
    colors: {
      primary: '#CE1126',
      dark: '#7E0B19',
      light: '#FFFFFF',
      jersey: '#CE1126',
      number: '#FFFFFF',
      numberOutline: '#6A0614',
      sleeve: '#FFFFFF',
      pants: '#F2EFE8',
      pantsStripe: '#CE1126',
      helmet: '#CE1126',
      helmetStripe: '#FFFFFF',
      mask: '#D9D9D9',
      socks: '#CE1126',
      cleats: '#F5F5F5',
      gloves: '#FFFFFF',
      endzone: '#B80F22',
      endzoneText: '#FFFFFF',
      endzoneTextOutline: '#5E0510',
      crowd: ['#CE1126', '#CE1126', '#FFFFFF', '#E8E2D6', '#9E0D1D'],
    },
    outline: [INDIANA_OUTLINE],
    numbers: { QB: 12, C: 55, LG: 72, RG: 64, WR1: 1, WR2: 8, RB: 23, K: 39, DL1: 90, DL2: 97, LB1: 44, LB2: 52, CB1: 3, CB2: 21, S: 7 },
  },
  MICH: {
    id: 'MICH',
    name: 'MICHIGAN',
    abbr: 'MICH',
    style: 'ground',
    blurb: 'Pound the rock. Hit everything that moves.',
    ratings: { pass: 6, rush: 8, defense: 8, speed: 7 },
    colors: {
      primary: '#0C2D6B',
      dark: '#06183C',
      light: '#FFCB05',
      jersey: '#0C2D6B',
      number: '#FFCB05',
      numberOutline: '#041030',
      sleeve: '#FFCB05',
      pants: '#FFCB05',
      pantsStripe: '#0C2D6B',
      helmet: '#0C2D6B',
      helmetStripe: '#FFCB05',
      mask: '#2A2A2E',
      socks: '#0C2D6B',
      cleats: '#1A1A1A',
      gloves: '#FFCB05',
      endzone: '#0B2A62',
      endzoneText: '#FFCB05',
      endzoneTextOutline: '#020A1E',
      crowd: ['#0C2D6B', '#0C2D6B', '#FFCB05', '#FFCB05', '#1F3F80'],
    },
    outline: [MICHIGAN_LOWER, MICHIGAN_UPPER],
    numbers: { QB: 10, C: 60, LG: 77, RG: 68, WR1: 4, WR2: 11, RB: 2, K: 40, DL1: 91, DL2: 99, LB1: 45, LB2: 33, CB1: 5, CB2: 24, S: 9 },
  },
};

export const TEAM_IDS = Object.keys(TEAMS);
