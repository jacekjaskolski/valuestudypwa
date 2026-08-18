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
  env,
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

/**
 * Where the ONNX runtime fetches its WASM from, and how many threads to ask for.
 *
 * **Threads.** Multi-threaded WASM needs `SharedArrayBuffer`, which needs the page to be
 * cross-origin isolated, which needs COOP and COEP response headers — and GitHub Pages cannot set
 * headers at all. The runtime is supposed to notice and degrade; saying so outright removes a
 * whole class of failure that only ever appears on the deployed site.
 *
 * **Paths.** The runtime ships four WASM builds and picks between them at load time depending on
 * the backend. The bundler only sees the one that happens to be statically referenced and emits
 * that alone, so any other choice is a 404 — again only once deployed. Pointing at the CDN for
 * the exact version installed makes all four resolvable, and makes development and production
 * behave identically.
 *
 * The version is pinned deliberately: floating it would let a runtime the code has never been
 * tried against arrive on its own.
 */
const ORT_VERSION = '1.26.0-dev.20260416-b7804b056c';

if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
}

/**
 * What the browser can offer, for the failure message.
 *
 * There is no way to open a console on an iPad, so when this fails on a device the only diagnosis
 * available is whatever the app itself puts on screen.
 */
export function backendReport(): string {
  const webgpu = 'gpu' in navigator && navigator.gpu != null;
  const isolated = typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false;
  const sab = typeof SharedArrayBuffer !== 'undefined';
  return `webgpu ${webgpu ? 'yes' : 'no'}, isolated ${isolated ? 'yes' : 'no'}, sab ${
    sab ? 'yes' : 'no'
  }`;
}

let loading: Promise<{ estimator: DepthEstimationPipeline; device: string }> | null = null;

/**
 * Just enough of the WebGPU API to ask an adapter what it supports.
 *
 * Declared here rather than pulling in `@webgpu/types`: two members are needed, and a whole type
 * package for a feature test is not a dependency worth carrying.
 */
interface GpuAdapterLike {
  features: { has: (feature: string) => boolean };
}
interface GpuLike {
  requestAdapter: () => Promise<GpuAdapterLike | null>;
}

type DepthDtype = typeof DEPTH_DTYPE_WASM | typeof DEPTH_DTYPE_WEBGPU;

interface Backend {
  device: 'webgpu' | 'wasm';
  dtype: DepthDtype;
}

/**
 * Pick a backend the device can actually run.
 *
 * WebGPU is much faster where it exists, but existing is not enough: the weights chosen for it are
 * half-precision, and an adapter without the `shader-f16` feature cannot load them. Plenty of
 * shipping hardware reports WebGPU and lacks that — an iPad Pro from 2020 among them — so the
 * feature is asked for rather than inferred from the API being present.
 *
 * Anything short of that falls back to WASM, which runs anywhere.
 */
async function chooseBackend(): Promise<Backend> {
  if ('gpu' in navigator && navigator.gpu != null) {
    try {
      const gpu = navigator.gpu as unknown as GpuLike;
      const adapter = await gpu.requestAdapter();
      if (adapter?.features.has('shader-f16')) {
        return { device: 'webgpu', dtype: DEPTH_DTYPE_WEBGPU };
      }
    } catch {
      // An adapter request can reject outright on some drivers. WASM it is.
    }
  }
  return { device: 'wasm', dtype: DEPTH_DTYPE_WASM };
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
    const report = (info: ProgressInfo): void => {
      if (!onProgress) {
        return;
      }
      const status = info as { status?: string; file?: string; progress?: number };
      onProgress({
        fraction: typeof status.progress === 'number' ? status.progress / 100 : null,
        file: status.file ?? null,
      });
    };

    const preferred = await chooseBackend();
    try {
      const estimator = await pipeline('depth-estimation', DEPTH_MODEL, {
        device: preferred.device,
        dtype: preferred.dtype,
        progress_callback: report,
      });
      return { estimator, device: preferred.device };
    } catch (error) {
      if (preferred.device === 'wasm') {
        throw error;
      }
      // WebGPU can pass feature detection and still fail to build a pipeline, on drivers that
      // report more than they deliver. WASM is slower but it runs, and a slow depth map beats an
      // error message.
      console.warn('WebGPU depth estimation failed, falling back to WASM', error);
      const estimator = await pipeline('depth-estimation', DEPTH_MODEL, {
        device: 'wasm',
        dtype: DEPTH_DTYPE_WASM,
        progress_callback: report,
      });
      return { estimator, device: 'wasm (webgpu failed)' };
    }
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
