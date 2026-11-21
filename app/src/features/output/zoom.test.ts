// Scaling of the Output surface (ARCHITECTURE.md 2.5).

import { describe, expect, it } from 'vitest';
import { ZOOM_CHOICES, fitScale, outputPlacement, outputScale, sizeText, zoomOfValue } from './zoom';

const VGA = { width: 640, height: 480 };

describe('fitScale', () => {
  it('is the largest whole-number scale that fits', () => {
    expect(fitScale(VGA, { width: 640, height: 480 })).toBe(1);
    expect(fitScale(VGA, { width: 1279, height: 2000 })).toBe(1);
    expect(fitScale(VGA, { width: 1280, height: 960 })).toBe(2);
    expect(fitScale(VGA, { width: 5000, height: 1000 })).toBe(2); // the height decides
    expect(fitScale(VGA, { width: 1920, height: 1440 })).toBe(3);
    expect(fitScale({ width: 1920, height: 1200 }, { width: 3840, height: 2400 })).toBe(2);
  });

  it('is 1 when even that does not fit, and before the panel has a size', () => {
    expect(fitScale(VGA, { width: 300, height: 200 })).toBe(1);
    expect(fitScale(VGA, { width: 0, height: 0 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, VGA)).toBe(1);
  });
});

describe('outputScale', () => {
  it('Fit follows the room; 100% and 200% do not', () => {
    const room = { width: 2000, height: 1500 };
    expect(outputScale('fit', VGA, room)).toBe(3);
    expect(outputScale(1, VGA, room)).toBe(1);
    expect(outputScale(2, VGA, room)).toBe(2);
    expect(outputScale(2, VGA, { width: 100, height: 100 })).toBe(2);
  });
});

describe('outputPlacement', () => {
  it('centres the scaled surface on whole pixels', () => {
    expect(outputPlacement(VGA, 1, { width: 701, height: 501 })).toEqual({
      width: 640,
      height: 480,
      left: 30,
      top: 10,
    });
    expect(outputPlacement(VGA, 2, { width: 1300, height: 1000 })).toEqual({
      width: 1280,
      height: 960,
      left: 10,
      top: 20,
    });
  });

  it('starts at the corner in a direction in which the surface does not fit', () => {
    expect(outputPlacement(VGA, 2, { width: 700, height: 1000 })).toMatchObject({ left: 0, top: 20 });
    expect(outputPlacement(VGA, 1, { width: 300, height: 200 })).toMatchObject({ left: 0, top: 0 });
  });
});

describe('the zoom choices', () => {
  it('are Fit, 100% and 200%, in that order', () => {
    expect(ZOOM_CHOICES.map((choice) => choice.label)).toEqual(['Fit', '100%', '200%']);
    expect(ZOOM_CHOICES.map((choice) => choice.zoom)).toEqual(['fit', 1, 2]);
  });

  it('map to and from the values of the list', () => {
    for (const choice of ZOOM_CHOICES) {
      expect(String(choice.zoom)).toBe(choice.value);
      expect(zoomOfValue(choice.value)).toBe(choice.zoom);
    }
    expect(zoomOfValue('3')).toBe('fit');
  });
});

describe('sizeText', () => {
  it('writes a size as the Options menu does', () => {
    expect(sizeText(VGA)).toBe('640x480');
    expect(sizeText({ width: 1920, height: 1200 })).toBe('1920x1200');
  });
});
