/**
 * Canvas and image decoding. This module is allowed to touch the DOM; nothing under
 * `src/pipeline/` is (SPEC.md §4, purity rule).
 */

import { labToSrgbPixel } from '../pipeline/color';
import { fitWithin } from '../pipeline/resize';
import type { Rgba } from '../pipeline/types';

export interface SourcePixels {
  width: number;
  height: number;
  rgba: Rgba;
}

export function requireCanvas(id: string): HTMLCanvasElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLCanvasElement)) {
    throw new Error(`Expected a canvas with id "${id}"`);
  }
  return el;
}

export function requireElement<T extends Element>(
  id: string,
  ctor: new () => T,
): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`Expected element "${id}" to be a ${ctor.name}`);
  }
  return el;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return ctx;
}

/**
 * Decode an image file and downscale it to the working resolution in one step.
 *
 * Output pixels are sRGB RGBA at a size whose longest edge is at most `maxEdge`; smaller images
 * come back at their original size. This is SPEC.md §6.1 step 1.
 */
export async function decodeToWorkingSize(
  file: Blob,
  maxEdge: number,
): Promise<SourcePixels> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = context2d(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

/**
 * Paint RGBA pixels into a canvas, resizing its backing store to match. Display size is left to
 * CSS: the backing store is always the working resolution, so nothing is resampled twice.
 */
export function drawPixels(
  canvas: HTMLCanvasElement,
  pixels: Rgba,
  width: number,
  height: number,
): void {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context2d(canvas).putImageData(new ImageData(pixels, width, height), 0, 0);
}

/**
 * Scratch canvas the scaled draw goes through. Kept between calls: resizing a canvas reallocates
 * its backing store, and this one is resized on every squint frame.
 */
let scaler: HTMLCanvasElement | null = null;

/**
 * Paint reduced-resolution RGBA pixels into a canvas, magnified by an exact integer factor.
 *
 * Used for the squint preview, which is computed at reduced resolution because a blur throws away
 * the detail anyway. The canvas does the magnification, which is free next to doing it in a loop,
 * and the target keeps its working-resolution size so the photo and the study stay laid out alike.
 *
 * Two details keep the image still while the factor changes under a moving slider:
 *
 * The magnified image is drawn at `sourceWidth * factor`, not stretched to fill `width`. Those
 * differ whenever the factor does not divide the width, and stretching to fit makes the effective
 * scale slightly less than the factor — an error that accumulates across the frame and changes
 * every time the factor steps. The overhang, under one reduced pixel, is clipped by the canvas.
 *
 * The draw is offset by half a pixel, because a reduced pixel averages a block whose centre sits
 * half a pixel left of where magnifying alone would place it.
 */
export function drawPixelsScaled(
  canvas: HTMLCanvasElement,
  pixels: Rgba,
  sourceWidth: number,
  sourceHeight: number,
  factor: number,
  width: number,
  height: number,
): void {
  scaler ??= document.createElement('canvas');
  scaler.width = sourceWidth;
  scaler.height = sourceHeight;
  context2d(scaler).putImageData(
    new ImageData(pixels.subarray(0, sourceWidth * sourceHeight * 4), sourceWidth, sourceHeight),
    0,
    0,
  );

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = context2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(scaler, -0.5, -0.5, sourceWidth * factor, sourceHeight * factor);
}

function cssVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/** One of the three zones, as it currently falls on the `L` axis. */
export interface HistogramBand {
  /** Start and end on the `L` scale, 0–100. */
  from: number;
  to: number;
  /** The zone's representative lightness, painted as the band's colour. */
  l: number;
}

/**
 * How strongly the zone bands are painted behind the bars. Higher: the control reads more like
 * the study and less like a chart; the histogram gets harder to see against it.
 */
const BAND_ALPHA = 0.4;

/** Opacity of the histogram bars over the bands. Lower: the bands dominate. */
const BAR_ALPHA = 0.75;

/**
 * Draw the value bar's background: the three zones as bands, with the luminance histogram over
 * them (SPEC.md §7).
 *
 * Everything is positioned on the `L` scale, 0–100 across the full width, which is the same axis
 * the drag handles use — the handles are the boundary markers, so nothing is drawn for them here.
 * Drawn at device pixel ratio rather than scaled up from a small backing store.
 */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  hist: Uint32Array,
  bands: readonly HistogramBand[],
): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = context2d(canvas);
  ctx.clearRect(0, 0, width, height);

  const rgb = new Uint8ClampedArray(4);
  for (const band of bands) {
    labToSrgbPixel(band.l, 0, 0, rgb, 0);
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${BAND_ALPHA})`;
    const from = (band.from / 100) * width;
    ctx.fillRect(from, 0, ((band.to - band.from) / 100) * width, height);
  }

  let peak = 0;
  for (let i = 0; i < hist.length; i++) {
    if (hist[i]! > peak) {
      peak = hist[i]!;
    }
  }

  if (peak > 0) {
    // Square-root scaling: a photographic histogram usually has one spike tall enough to flatten
    // everything else into the baseline, and the shape of the tails is what matters here.
    const scale = height / Math.sqrt(peak);
    const barWidth = width / hist.length;

    ctx.globalAlpha = BAR_ALPHA;
    ctx.fillStyle = cssVariable('--text-dim', '#6f6f6f');
    for (let i = 0; i < hist.length; i++) {
      const barHeight = Math.sqrt(hist[i]!) * scale;
      ctx.fillRect(i * barWidth, height - barHeight, Math.ceil(barWidth), barHeight);
    }
    ctx.globalAlpha = 1;
  }
}
