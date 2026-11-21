// Writes the application icons into app/public/icons/ (ARCHITECTURE.md 1.1). Owner: DV1.
//
//   node app/src/features/pwa/icons/make-icons.mjs
//
// The artwork is icon-art.mjs (original work of this project). The SVG files are written as text;
// the PNG files are rendered from the SVG with @napi-rs/canvas, a development dependency of the
// repository. The results are committed, so this runs only when the artwork changes.

/* global console */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { iconSvg, PNG_ICONS } from './icon-art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../../public/icons');
mkdirSync(outDir, { recursive: true });

const svg = { false: iconSvg(), true: iconSvg({ maskable: true }) };
writeFileSync(join(outDir, 'icon.svg'), svg.false);
writeFileSync(join(outDir, 'maskable.svg'), svg.true);

for (const { file, size, maskable } of PNG_ICONS) {
  const image = await loadImage(Buffer.from(svg[maskable]));
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, size, size);
  writeFileSync(join(outDir, file), await canvas.encode('png'));
  console.log(`${file} ${size}x${size}`);
}
console.log(`written to ${outDir}`);
