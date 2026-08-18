/**
 * Canvas and image decoding. This module is allowed to touch the DOM; nothing under
 * `src/pipeline/` is (SPEC.md §4, purity rule).
 */

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

function cssVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/** A boundary drawn on the histogram. Muted marks still hold a value but are not cutting. */
export interface HistogramMark {
  /** Position on the `L` scale, 0–100. */
  l: number;
  active: boolean;
}

/**
 * Draw the luminance histogram with the current boundaries marked on it (SPEC.md §7).
 *
 * Marks are positions on the `L` scale, matching the histogram's own axis. The point of the chart
 * is to make the boundaries legible against the image's actual distribution, so it is drawn at
 * device pixel ratio rather than scaled up from a small backing store.
 */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  hist: Uint32Array,
  marks: readonly HistogramMark[],
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

  let peak = 0;
  for (let i = 0; i < hist.length; i++) {
    if (hist[i]! > peak) {
      peak = hist[i]!;
    }
  }
  if (peak === 0) {
    return;
  }

  // Square-root scaling: a photographic histogram usually has one spike tall enough to flatten
  // everything else into the baseline, and the shape of the tails is what matters here.
  const scale = height / Math.sqrt(peak);
  const barWidth = width / hist.length;

  ctx.fillStyle = cssVariable('--line', '#6d6d6d');
  for (let i = 0; i < hist.length; i++) {
    const barHeight = Math.sqrt(hist[i]!) * scale;
    ctx.fillRect(i * barWidth, height - barHeight, Math.ceil(barWidth), barHeight);
  }

  const markWidth = Math.max(1, Math.round(ratio));
  for (const mark of marks) {
    ctx.fillStyle = mark.active
      ? cssVariable('--control', '#cfcfcf')
      : cssVariable('--control-muted', '#8a8a8a');
    const x = Math.round((mark.l / 100) * width);
    ctx.fillRect(Math.min(x, width - markWidth), 0, markWidth, height);
  }
}
