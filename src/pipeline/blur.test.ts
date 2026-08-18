import { describe, expect, it } from 'vitest';
import {
  blurReduction,
  blurRgba,
  boxRadii,
  createBlurScratch,
  downsampleBox,
  lightenInto,
  squintBlur,
} from './blur';
import type { Rgba } from './types';

/** Build an RGBA image from a grid of grey levels. */
function grey(rows: number[][]): { pixels: Rgba; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]!.length;
  const pixels = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    row.forEach((value, x) => {
      const p = (y * width + x) * 4;
      pixels[p] = value;
      pixels[p + 1] = value;
      pixels[p + 2] = value;
      pixels[p + 3] = 255;
    });
  });
  return { pixels, width, height };
}

/** Read back the red channel as a grid, since the fixtures are neutral. */
function levels(pixels: Rgba, width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      row.push(pixels[(y * width + x) * 4]!);
    }
    rows.push(row);
  }
  return rows;
}

describe('boxRadii', () => {
  it('gives one radius per pass', () => {
    expect(boxRadii(5, 3)).toHaveLength(3);
  });

  it('grows the radii with sigma', () => {
    const small = boxRadii(2, 3).reduce((a, b) => a + b, 0);
    const large = boxRadii(20, 3).reduce((a, b) => a + b, 0);
    expect(large).toBeGreaterThan(small);
  });

  it('never returns a negative radius', () => {
    for (const sigma of [0.5, 1, 2, 5, 30]) {
      expect(boxRadii(sigma, 3).every((r) => r >= 0)).toBe(true);
    }
  });

  it('approximates the requested variance', () => {
    // Variance of a box of radius r is (w² − 1) / 12 with w = 2r + 1; the passes add variance.
    const sigma = 10;
    const variance = boxRadii(sigma, 3).reduce((total, r) => {
      const w = 2 * r + 1;
      return total + (w * w - 1) / 12;
    }, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(sigma, 0);
  });
});

describe('blurRgba', () => {
  const scratch = () => createBlurScratch(64 * 64 * 4);

  it('passes the image through below the visible threshold', () => {
    const { pixels, width, height } = grey([
      [0, 255],
      [255, 0],
    ]);
    const out = new Uint8ClampedArray(pixels.length);
    blurRgba(pixels, width, height, 0.1, createBlurScratch(pixels.length), out);
    expect(Array.from(out)).toEqual(Array.from(pixels));
  });

  it('leaves a flat image flat, including at the edges', () => {
    // The whole point of clamping: a uniform image must not darken towards its border, which is
    // what blurring against the transparency outside would do.
    const rows = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 200));
    const { pixels, width, height } = grey(rows);
    const out = new Uint8ClampedArray(pixels.length);
    blurRgba(pixels, width, height, 4, scratch(), out);
    expect(levels(out, width, height).flat().every((v) => v === 200)).toBe(true);
  });

  it('keeps corners as bright as the middle for a flat image', () => {
    const rows = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => 137));
    const { pixels, width, height } = grey(rows);
    const out = new Uint8ClampedArray(pixels.length);
    blurRgba(pixels, width, height, 8, scratch(), out);
    const grid = levels(out, width, height);
    expect(grid[0]![0]!).toBe(grid[16]![16]!);
    expect(grid[31]![31]!).toBe(grid[16]![16]!);
  });

  it('spreads a bright point into its neighbours', () => {
    const rows = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => 0));
    rows[10]![10] = 255;
    const { pixels, width, height } = grey(rows);
    const out = new Uint8ClampedArray(pixels.length);
    blurRgba(pixels, width, height, 3, scratch(), out);
    const grid = levels(out, width, height);
    expect(grid[10]![10]!).toBeLessThan(255);
    expect(grid[10]![11]!).toBeGreaterThan(0);
    expect(grid[10]![11]!).toBeLessThan(grid[10]![10]!);
  });

  it('conserves total brightness', () => {
    // A dense image, not a couple of bright specks on black. Spreading a lone speck thin puts
    // most of its energy in pixels worth well under one byte, where rounding to the nearest byte
    // is a large relative error and inflates the total by a quarter — a property of counting in
    // bytes, not of the blur.
    const rows = Array.from({ length: 32 }, (_, y) =>
      Array.from({ length: 32 }, (_, x) => 40 + ((x * 5 + y * 3) % 180)),
    );
    const { pixels, width, height } = grey(rows);
    const out = new Uint8ClampedArray(pixels.length);
    const before = levels(pixels, width, height).flat().reduce((a, b) => a + b, 0);
    blurRgba(pixels, width, height, 3, scratch(), out);
    const after = levels(out, width, height).flat().reduce((a, b) => a + b, 0);
    expect(after / before).toBeGreaterThan(0.98);
    expect(after / before).toBeLessThan(1.02);
  });

  it('does not modify the source', () => {
    const { pixels, width, height } = grey([
      [0, 255, 0],
      [255, 0, 255],
      [0, 255, 0],
    ]);
    const before = Array.from(pixels);
    const out = new Uint8ClampedArray(pixels.length);
    blurRgba(pixels, width, height, 2, createBlurScratch(pixels.length), out);
    expect(Array.from(pixels)).toEqual(before);
  });

  it('leaves every pixel opaque', () => {
    const rows = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 90));
    const { pixels, width, height } = grey(rows);
    const out = new Uint8ClampedArray(pixels.length);
    blurRgba(pixels, width, height, 2, scratch(), out);
    for (let p = 3; p < out.length; p += 4) {
      expect(out[p]!).toBe(255);
    }
  });
});

describe('blurReduction', () => {
  it('stays at full resolution for a blur too small to shrink', () => {
    expect(blurReduction(0.5)).toBe(1);
  });

  it('shrinks more as the blur grows', () => {
    expect(blurReduction(4)).toBeGreaterThan(blurReduction(2));
  });

  it('is capped', () => {
    expect(blurReduction(10_000)).toBe(8);
  });
});

describe('downsampleBox', () => {
  it('averages each block', () => {
    const { pixels, width, height } = grey([
      [0, 100],
      [200, 60],
    ]);
    const dst = new Uint8ClampedArray(pixels.length);
    const size = downsampleBox(pixels, width, height, 2, dst);
    expect(size).toEqual({ width: 1, height: 1 });
    expect(dst[0]!).toBe(90); // (0 + 100 + 200 + 60) / 4
  });

  it('repeats the edge pixel where the last block runs past it', () => {
    // Every block averages factor² samples, including the one hanging off the end. Weighting the
    // edge block differently from the rest makes the border move as the factor changes.
    const { pixels, width, height } = grey([[0, 0, 240, 60]]);
    const dst = new Uint8ClampedArray(pixels.length);
    const size = downsampleBox(pixels, width, height, 3, dst);
    expect(size).toEqual({ width: 2, height: 1 });
    expect(dst[0]!).toBe(80); // (0 + 0 + 240) / 3
    expect(dst[4]!).toBe(60); // 60, then the edge repeated twice
  });

  it('copies through at a factor of one', () => {
    const { pixels, width, height } = grey([[10, 20]]);
    const dst = new Uint8ClampedArray(pixels.length);
    expect(downsampleBox(pixels, width, height, 1, dst)).toEqual({ width: 2, height: 1 });
    expect(dst[0]!).toBe(10);
    expect(dst[4]!).toBe(20);
  });
});

describe('lightenInto', () => {
  it('keeps the brighter of each pair', () => {
    const first = Uint8ClampedArray.from([10, 200, 30, 255]);
    const second = Uint8ClampedArray.from([100, 20, 40, 255]);
    const out = new Uint8ClampedArray(4);
    lightenInto(first, second, 4, out);
    expect(Array.from(out)).toEqual([100, 200, 40, 255]);
  });

  it('only touches the requested length', () => {
    const first = Uint8ClampedArray.from([255, 255, 255, 255, 255, 255, 255, 255]);
    const second = new Uint8ClampedArray(8);
    const out = new Uint8ClampedArray(8);
    lightenInto(first, second, 4, out);
    expect(Array.from(out.slice(4))).toEqual([0, 0, 0, 0]);
  });
});

describe('squintBlur', () => {
  /**
   * A dark field with one broad bright shape. Deliberately not a fine pattern: at a large squint
   * the image is shrunk before blurring, so anything finer than the blur is averaged away first —
   * which is correct, since a bright speck smaller than the blur really does vanish when you
   * squint, but it makes a fine-patterned fixture unable to tell the two modes apart.
   */
  const photo = () => {
    const rows = Array.from({ length: 64 }, (_, y) =>
      Array.from({ length: 64 }, (_, x) =>
        Math.hypot(x - 32, y - 32) < 12 ? 240 : 30,
      ),
    );
    return grey(rows);
  };

  it('returns a reduced image for a large blur, and full size for a small one', () => {
    const { pixels, width, height } = photo();
    const scratch = createBlurScratch(pixels.length);
    const big = squintBlur(pixels, width, height, 16, false, 0.3, scratch);
    const small = squintBlur(pixels, width, height, 0.6, false, 0.3, scratch);
    expect(big.width).toBeLessThan(width);
    expect(small.width).toBe(width);
    expect(small.factor).toBe(1);
  });

  it('reports a factor that covers the whole image once magnified', () => {
    // What the drawing relies on: magnifying by exactly `factor` reaches at least the original
    // size, so nothing has to be stretched to fit. Stretching instead is what made the photo
    // creep sideways as the slider moved the factor from one step to the next.
    const { pixels, width, height } = photo();
    const scratch = createBlurScratch(pixels.length);
    for (const sigma of [1, 2, 3, 5, 8, 13, 21]) {
      const result = squintBlur(pixels, width, height, sigma, false, 0.3, scratch);
      expect(result.width * result.factor).toBeGreaterThanOrEqual(width);
      expect(result.height * result.factor).toBeGreaterThanOrEqual(height);
      // ...and by less than one reduced pixel, so the clipped overhang stays negligible.
      expect(result.width * result.factor - width).toBeLessThan(result.factor);
    }
  });

  it('keeps highlights brighter than a plain blur of the same radius', () => {
    const { pixels, width, height } = photo();
    const scratch = createBlurScratch(pixels.length);

    const plain = squintBlur(pixels, width, height, 8, false, 0.3, scratch);
    const plainMax = Math.max(...levels(plain.pixels, plain.width, plain.height).flat());

    const kept = squintBlur(pixels, width, height, 8, true, 0.3, scratch);
    const keptMax = Math.max(...levels(kept.pixels, kept.width, kept.height).flat());

    expect(keptMax).toBeGreaterThan(plainMax);
  });

  it('never returns anything darker than the plain blur when keeping highlights', () => {
    const { pixels, width, height } = photo();
    const plain = squintBlur(pixels, width, height, 8, false, 0.3, createBlurScratch(pixels.length));
    const plainLevels = levels(plain.pixels, plain.width, plain.height).flat();

    const kept = squintBlur(pixels, width, height, 8, true, 0.3, createBlurScratch(pixels.length));
    const keptLevels = levels(kept.pixels, kept.width, kept.height).flat();

    expect(keptLevels.every((value, i) => value >= plainLevels[i]!)).toBe(true);
  });
});
