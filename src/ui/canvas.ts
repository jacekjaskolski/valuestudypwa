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
