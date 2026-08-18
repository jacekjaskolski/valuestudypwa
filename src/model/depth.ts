/**
 * Depth estimation: loading the model and running it (SPEC.md §6.2).
 *
 * Kept out of `src/pipeline/` because it needs the network, a WASM or WebGPU backend, and Cache
 * Storage — all globals, which the purity rule excludes. The arithmetic half is in
 * `pipeline/depth.ts` and is tested; this half is I/O and is judged by eye.
 *
 * Everything here is failure-tolerant on purpose. Depth is an enhancement, not a dependency: if
 * the model will not load or inference throws, the caller turns the correction off and the rest of
 * the app carries on.
 *
 * Imported dynamically by `main.ts`, so transformers.js and the ONNX runtime land in their own
 * chunk and cost nothing until the painter asks for depth.
 */

import {
  pipeline,
  RawImage,
  type DepthEstimationPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import { DEPTH_DTYPE_WASM, DEPTH_DTYPE_WEBGPU, DEPTH_MODEL } from '../constants';
import type { Rgba } from '../pipeline/types';

/** How far along the one-time model download is. */
export interface DepthLoadProgress {
  /** 0–1 across all files, or null before any size is known. */
  fraction: number | null;
  file: string | null;
}

export interface DepthResult {
  /** Raw model output, whatever scale it uses; `normalizeDepth` turns it into 0–1. */
  raw: Float32Array;
  width: number;
  height: number;
  /** Which backend actually ran, for the record. */
  device: string;
  /** Inference time in milliseconds, excluding the model download. */
  ms: number;
}

let loading: Promise<{ estimator: DepthEstimationPipeline; device: string }> | null = null;

/** WebGPU is much faster where it exists, and Safari has only recently grown it. */
function preferredDevice(): 'webgpu' | 'wasm' {
  return 'gpu' in navigator && navigator.gpu != null ? 'webgpu' : 'wasm';
}

/**
 * Load the model, once. Repeat calls share the first attempt.
 *
 * A failed load clears itself, so a later attempt can retry rather than being stuck with the
 * rejection for the rest of the session.
 */
export function loadDepthModel(
  onProgress?: (progress: DepthLoadProgress) => void,
): Promise<{ estimator: DepthEstimationPipeline; device: string }> {
  loading ??= (async () => {
    const device = preferredDevice();
    const dtype = device === 'webgpu' ? DEPTH_DTYPE_WEBGPU : DEPTH_DTYPE_WASM;

    const estimator = await pipeline('depth-estimation', DEPTH_MODEL, {
      device,
      dtype,
      progress_callback: (info: ProgressInfo) => {
        if (!onProgress) {
          return;
        }
        const status = info as { status?: string; file?: string; progress?: number };
        onProgress({
          fraction: typeof status.progress === 'number' ? status.progress / 100 : null,
          file: status.file ?? null,
        });
      },
    });

    return { estimator, device };
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });

  return loading;
}

/**
 * Run depth estimation over an image.
 *
 * Input: `rgba` at `width` × `height`. Output: the model's own raw depth map, at *its* resolution
 * rather than the image's — the caller resamples. The model has its own input size and feeding it
 * the full working-resolution image would only make it slower (SPEC.md §6.2).
 */
export async function estimateDepth(
  rgba: Rgba,
  width: number,
  height: number,
  onProgress?: (progress: DepthLoadProgress) => void,
): Promise<DepthResult> {
  const { estimator, device } = await loadDepthModel(onProgress);

  // RawImage takes the pixels directly, so this needs no canvas and the model sees exactly what
  // the pipeline sees.
  const image = new RawImage(rgba, width, height, 4);

  const started = performance.now();
  const output = await estimator(image);
  const ms = performance.now() - started;

  const tensor = Array.isArray(output) ? output[0]!.predicted_depth : output.predicted_depth;
  const dims = tensor.dims;
  const depthHeight = dims[dims.length - 2]!;
  const depthWidth = dims[dims.length - 1]!;

  return {
    raw: Float32Array.from(tensor.data as ArrayLike<number>),
    width: depthWidth,
    height: depthHeight,
    device,
    ms,
  };
}
