// The application icon (ARCHITECTURE.md 10.2, O-7: a new icon, not the original's). Owner: DV1.
//
// Original work of this project, made for easy68k-cross-platform (formerly easy68k-mac) and licensed with it (GPL-2.0-or-later): a
// 68000-style chip in a dual in-line package on the accent colour of the interface, with "68K" in
// seven-segment figures. No font is involved; every shape is a rectangle or a polygon, so the
// SVG and the PNGs rendered from it look the same everywhere.
//
// make-icons.mjs writes the SVG files and renders the PNG sizes into app/public/icons/.

const ACCENT = '#0b63ce'; // --c-accent of the light theme
const CHIP = '#111827'; // --c-text of the light theme
const PIN = '#d1d5db'; // --c-border
const FIGURE = '#ffffff';

/** Seven-segment rectangles of one digit at (x, y): width 70, height 120, stroke 16. */
function digit(x, y, segments) {
  const w = 70;
  const h = 120;
  const t = 16;
  const shapes = {
    a: [x, y, w, t],
    b: [x + w - t, y, t, h / 2],
    c: [x + w - t, y + h / 2, t, h / 2],
    d: [x, y + h - t, w, t],
    e: [x, y + h / 2, t, h / 2],
    f: [x, y, t, h / 2],
    g: [x, y + h / 2 - t / 2, w, t],
  };
  return [...segments].map((name) => {
    const [rx, ry, rw, rh] = shapes[name];
    return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}"/>`;
  });
}

/**
 * The icon as SVG text, 512 x 512.
 * @param {{ maskable?: boolean }} [options] maskable: the background fills the whole square (the
 *   platform cuts its own shape) and the artwork stays inside the central safe zone.
 */
export function iconSvg({ maskable = false } = {}) {
  const background = maskable
    ? `<rect width="512" height="512" fill="${ACCENT}"/>`
    : `<rect x="16" y="16" width="480" height="480" rx="96" fill="${ACCENT}"/>`;
  // Scale the artwork down for the maskable form: the safe zone is a circle of radius 205.
  const transform = maskable ? ' transform="translate(256 256) scale(0.84) translate(-256 -256)"' : '';
  const pins = [];
  for (let i = 0; i < 7; i++) {
    const x = 122 + i * 42;
    pins.push(`<rect x="${x}" y="122" width="20" height="44" rx="4"/>`);
    pins.push(`<rect x="${x}" y="346" width="20" height="44" rx="4"/>`);
  }
  const figures = [
    ...digit(131, 196, 'afgedc'), // 6
    ...digit(221, 196, 'abcdefg'), // 8
    '<rect x="311" y="196" width="16" height="120"/>', // K
    '<polygon points="325,248 362,196 381,196 341,256 381,316 362,316 325,264"/>',
  ];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
    `<title>EASy68K</title>`,
    background,
    `<g${transform}>`,
    `<g fill="${PIN}">${pins.join('')}</g>`,
    `<rect x="96" y="150" width="320" height="212" rx="18" fill="${CHIP}"/>`,
    `<circle cx="113" cy="256" r="9" fill="${ACCENT}"/>`,
    `<g fill="${FIGURE}">${figures.join('')}</g>`,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

/** The PNG files: name, size in pixels, maskable form or not. */
export const PNG_ICONS = [
  { file: 'icon-32.png', size: 32, maskable: false },
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-512.png', size: 512, maskable: true },
  // iOS and iPadOS draw their own rounded corners: the full square, like the maskable form.
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];
