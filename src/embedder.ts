import { AutoConfig, AutoModel, AutoProcessor, env } from "@huggingface/transformers";
import { truncateNormalize } from "./search";

export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
export const queryPrefix = (query: string): string => `task: search result | query: ${query}`;

export type Device = "webgpu" | "wasm";
export type AudioDtype = "q4" | "q8" | "fp16";

export interface EmbedderOptions {
  readonly device: Device;
  readonly audioDtype: AudioDtype;
  readonly dim: number;
  readonly onProgress?: (message: string) => void;
}

export interface Embedder {
  readonly options: EmbedderOptions;
  embedQuery(query: string): Promise<Float32Array>;
  embedAudio(pcm: Float32Array): Promise<Float32Array>;
  dispose(): Promise<void>;
}

interface ProgressEvent {
  status?: string;
  file?: string;
  progress?: number;
}

/** Load the text and audio parts of the model (never the vision encoder). Downloads on first use, then caches. */
export async function loadEmbedder(options: EmbedderOptions): Promise<Embedder> {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const progress_callback = (e: ProgressEvent): void => {
    if (e.status === "progress" && e.file && typeof e.progress === "number") {
      options.onProgress?.(`Downloading ${e.file.split("/").pop()} ${Math.round(e.progress)}%`);
    }
  };
  try {
    const config = await AutoConfig.from_pretrained(MODEL_ID);
    (config as unknown as { vision_config: null }).vision_config = null;
    const processor = await AutoProcessor.from_pretrained(MODEL_ID);
    const model = await AutoModel.from_pretrained(MODEL_ID, {
      config,
      device: options.device,
      dtype: { model: options.device === "webgpu" ? "q4f16" : "q4", audio_encoder: options.audioDtype },
      progress_callback,
    } as Parameters<typeof AutoModel.from_pretrained>[1]);

    const run = async (inputs: unknown): Promise<Float32Array> => {
      const output = (await model(inputs)) as { sentence_embedding: { data: Float32Array } };
      return truncateNormalize(Float32Array.from(output.sentence_embedding.data), options.dim);
    };
    return {
      options,
      embedQuery: async (query) => run(await processor([queryPrefix(query)])),
      embedAudio: async (pcm) => run(await processor(null, null, pcm)),
      dispose: async () => { await model.dispose(); },
    };
  } catch (error) {
    console.error("Muninn: model failed to load", error);
    throw new Error(`Could not load the search model (${options.device}). Check your connection for the first download, or switch the device in settings.`);
  }
}
