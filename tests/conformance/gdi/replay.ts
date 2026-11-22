// Replays a GDI case on the port's drawing surface (ARCHITECTURE.md 3.4). Owner: T2.
//
// Every operation of cases.ts is one Surface method with the same arguments, except:
//   bg     fills the back buffer directly (it only sets up a picture);
//   font, fontcolor, text
//          task 95 is TextScreen.drawText in the port (SH3). Here the glyphs come from the tests'
//          own reader of the font data (fonts.ts) and go to Surface.textOut, which is what the
//          surface is held to: the opaque cell is as wide as the sum of the glyph advances, the
//          pen moves by `extent`. Zero-width control bytes are left out of the glyph list (they
//          paint nothing and take no room, trap15-b 6.7); `extent` counts them unless the string
//          has a byte of $80 or above (text-model.ts); in the raster faces a string of zero-width
//          bytes only gets one blank glyph as wide as the cell GDI fills (one cell plus the style
//          overhang). The font colour goes to textOut as task 21 gave it; the Surface resolves it
//          by trap15-b 4.6 (text-model.ts resolveColour is the tests' statement of that rule).
//
// `text: 'outline'` lays the strings out by layoutOutlineText() with blank glyphs (the outline
// glyph pixels are not compared, 6.5.3); the caller skips the cases outlineCells() returns null for.

import type { Glyph } from '../../../app/src/contracts';
import { Surface } from '../../../app/src/core/sim-host/surface/surface';
import type { GdiCase } from './cases';
import { loadMetrics, rasterGlyph, type FontRequest, type Metrics } from './fonts';
import { layoutOutlineText, layoutText, type Picture } from './text-model';

let metrics: Metrics | undefined;

export function replayOnSurface(c: GdiCase, text: 'raster' | 'outline' = 'raster'): Picture {
  const surface = new Surface(c.width, c.height);
  let font: FontRequest = { name: 'Fixedsys', size: 9, style: 0 };
  let fontColor = 0xffffff;
  for (const o of c.ops) {
    switch (o.op) {
      case 'bg':
        surface.back.data.fill((0xff000000 | (o.color & 0xffffff)) >>> 0);
        break;
      case 'pen':
        surface.setLineColor(o.color);
        break;
      case 'fill':
        surface.setFillColor(o.color);
        break;
      case 'width':
        surface.setPenWidth(o.value);
        break;
      case 'mode':
        surface.setDrawingMode(o.value);
        break;
      case 'pixel':
        surface.drawPixel(o.x, o.y);
        break;
      case 'line':
        surface.line(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'lineto':
        surface.lineTo(o.x, o.y);
        break;
      case 'moveto':
        surface.moveTo(o.x, o.y);
        break;
      case 'rect':
        surface.rectangle(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'urect':
        surface.unfilledRectangle(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'ellipse':
        surface.ellipse(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'uellipse':
        surface.unfilledEllipse(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'flood':
        surface.floodFill(o.x, o.y);
        break;
      case 'font':
        font = { name: o.name, size: o.size, style: o.style };
        break;
      case 'fontcolor':
        fontColor = o.color; // the Surface resolves it by 4.6 (surface.ts textOut)
        break;
      case 'text': {
        metrics ??= loadMetrics();
        const layout =
          text === 'outline'
            ? layoutOutlineText(metrics, font, o.bytes)
            : layoutText(metrics, font, o.bytes, rasterGlyph);
        if (layout === null) throw new Error(`${c.id}: no outline layout (outlineCells() is null for this case)`);
        let list: Glyph[] = layout.glyphs.map((g) => g.glyph);
        // GDI's cell can be wider than the sum of the advances (the bold and italic overhang of the
        // raster faces). Within the contract that is a blank glyph at the end with that advance;
        // `extent` still moves the pen correctly.
        const sum = list.reduce((n, g) => n + g.advance, 0);
        if (list.length > 0 && layout.boxWidth > sum) {
          const w = layout.boxWidth - sum;
          list = [
            ...list,
            { advance: w, width: w, height: layout.cellHeight, coverage: new Uint8Array(w * layout.cellHeight) },
          ];
        }
        const height = layout.boxHeight ?? layout.cellHeight;
        if (layout.boxWidth > 0 && list.length === 0) {
          list = [
            {
              advance: layout.boxWidth,
              width: layout.boxWidth,
              height,
              coverage: new Uint8Array(layout.boxWidth * height),
            },
          ];
        }
        // A box that starts left of the text position (the bar) moves the pen by as much less.
        const left = layout.boxLeft ?? 0;
        surface.textOut(o.x + left, o.y, list, layout.extent - left, fontColor, 'both');
        break;
      }
    }
  }
  return {
    width: c.width,
    height: c.height,
    pixels: surface.back.data.map((p) => p & 0xffffff),
    pen: [surface.state.backPen.x, surface.state.backPen.y],
  };
}

/** Whether the Surface draws at all yet (false while it is the wave-0 stub). */
export function surfaceDraws(): boolean {
  const s = new Surface(4, 4);
  s.drawPixel(1, 1);
  return ((s.back.data[5] as number) & 0xffffff) !== 0;
}
