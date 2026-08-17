/**
 * Shared array types for the pipeline.
 *
 * The explicit `ArrayBuffer` type argument matters: without it TypeScript widens to
 * `ArrayBufferLike`, which includes `SharedArrayBuffer` and is then rejected by `ImageData`.
 */

/** Interleaved RGBA, 4 bytes per pixel, sRGB, `width * height * 4` long. */
export type Rgba = Uint8ClampedArray<ArrayBuffer>;
