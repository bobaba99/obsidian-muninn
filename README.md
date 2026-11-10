# Muninn

Search your meeting recordings in Obsidian by what was said, and jump to the moment. Built for recordings from a 15-minute stand-up to a 2-hour workshop.

In Norse myth, Muninn ("memory") is one of Odin's two ravens: it flies out each day and returns to tell him what it heard.

Type what you remember ("the part about hiring a second designer"). Muninn lists the matching moments across every recording. Press Enter to play from there, or Shift+Enter to drop a link to that moment into your note.

No account. No API key. No transcript needed.

Status: early development, not yet released.

## How it works

Muninn runs [EmbeddingGemma 2](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX), an open model from Google DeepMind, on your computer. The model turns each 15-second stretch of audio, and your typed query, into vectors in one shared space; search is a comparison of those vectors.

## What leaves your computer

- **Your recordings, queries and index: nothing.** Audio is decoded and embedded locally. The index is stored in the plugin's folder inside your vault.
- **One-time downloads:** the first time you index, Muninn downloads the model (about 750 MB with the GPU setting, about 515 MB with the CPU setting) from Hugging Face, and the ONNX Runtime WebAssembly files from the jsDelivr CDN. They are cached; search then works offline.
- No telemetry.

## Use

1. Run **Muninn: Index audio files** from the command palette. The first run downloads the model.
2. Run **Muninn: Search audio**, or click the ribbon icon.
3. Enter plays from the moment. Shift+Enter inserts a link such as `[▶ 1:23 · interview.m4a](obsidian://muninn?...)`.

Supported files: mp3, m4a, wav, webm, ogg, flac, aac, opus. Desktop only.

## Measured so far

On 73 real single-speaker utterances (8 minutes, LibriSpeech), with 20 paraphrased queries typed into the search box in Obsidian 1.8.9 on an M4 Max: the right moment was in the top 3 for 18 of 20, and first for 18 of 20. Indexing ran at 56× real time on the GPU setting. This is clean read speech from one speaker; noisy, multi-speaker and non-English recordings are not yet measured. See `spike/` and `e2e/` to re-run.

## Known limits

- Each file is decoded whole before indexing, so very long recordings need a lot of memory.
- Results point to a 15-second window, not an exact word.
- Recordings made by Obsidian's built-in recorder play and seek, but the player cannot show their total length.

## Develop

```bash
npm install
npm run build   # type-check and bundle to main.js
npm test        # unit tests
```

`e2e/` drives a real Obsidian window over the DevTools protocol; see the header of `e2e/run.mjs`.

## License

MIT. Model weights are Apache 2.0, from Google DeepMind.
