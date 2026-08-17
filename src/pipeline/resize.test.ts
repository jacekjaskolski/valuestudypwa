import { describe, expect, it } from 'vitest';
import { fitWithin } from './resize';

describe('fitWithin', () => {
  it('leaves a size already within the limit untouched', () => {
    expect(fitWithin(640, 480, 1024)).toEqual({ width: 640, height: 480 });
  });

  it('never upscales, even for a much smaller image', () => {
    expect(fitWithin(100, 50, 1024)).toEqual({ width: 100, height: 50 });
  });

  it('scales a landscape image by its longest edge', () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('scales a portrait image by its longest edge', () => {
    expect(fitWithin(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('preserves aspect ratio within a rounding pixel', () => {
    const { width, height } = fitWithin(4032, 3024, 1024);
    expect(Math.abs(width / height - 4032 / 3024)).toBeLessThan(0.01);
  });

  it('keeps extreme aspect ratios at least one pixel tall', () => {
    expect(fitWithin(10000, 3, 1024)).toEqual({ width: 1024, height: 1 });
  });

  it('returns the boundary size unchanged', () => {
    expect(fitWithin(1024, 512, 1024)).toEqual({ width: 1024, height: 512 });
  });
});
