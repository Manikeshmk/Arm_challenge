import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// ── Arm-Optimised WASM Config ──────────────────────────────────────────────
// allowLocalModels = false → always fetch from HuggingFace Hub / CDN
env.allowLocalModels = false;
env.backends.onnx.wasm.simd = true;                                  // ARM NEON SIMD
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

let transcriber, translator, synthesizer;

// ── Progress Helper ─────────────────────────────────────────────────────────
// Xenova Transformers.js fires progress callbacks with { status, progress }
function makeProgressCb(modelKey) {
    return (progress) => {
        if (progress.status === 'downloading' || progress.status === 'progress') {
            const pct = Math.round(progress.progress ?? 0);
            postMessage({ status: 'model_progress', model: modelKey, pct });
        } else if (progress.status === 'done' || progress.status === 'loaded') {
            postMessage({ status: 'model_progress', model: modelKey, pct: 100 });
        } else if (progress.status === 'initiate') {
            postMessage({ status: 'model_progress', model: modelKey, pct: 0 });
        }
    };
}

// ── Auto-Init: Pre-load all models on worker startup ─────────────────────────
(async () => {
    try {
        // Step 1: Whisper STT (~40 MB)
        postMessage({ status: 'load_start', model: 'whisper' });
        transcriber = await pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            { quantized: true, revision: 'main', progress_callback: makeProgressCb('whisper') }
        );
        postMessage({ status: 'model_done', model: 'whisper' });

        // Step 2: MarianMT En→Es (~75 MB)
        postMessage({ status: 'load_start', model: 'marian' });
        translator = await pipeline(
            'translation',
            'Xenova/opus-mt-en-es',
            { quantized: true, progress_callback: makeProgressCb('marian') }
        );
        postMessage({ status: 'model_done', model: 'marian' });

        // Step 3: SpeechT5 TTS (~150 MB)
        postMessage({ status: 'load_start', model: 'tts' });
        synthesizer = await pipeline(
            'text-to-speech',
            'Xenova/speecht5_tts',
            { quantized: true, progress_callback: makeProgressCb('tts') }
        );
        postMessage({ status: 'model_done', model: 'tts' });

        // All done → enable the mic button
        postMessage({ status: 'init_done' });

    } catch (e) {
        postMessage({ status: 'error', message: 'Model download failed: ' + e.message });
    }
})();

// ── Inference on demand ──────────────────────────────────────────────────────
onmessage = async (e) => {
    if (e.data.type !== 'process_audio') return;

    const audioData = e.data.audio;

    try {
        // 1. Speech-to-Text
        postMessage({ status: 'transcribing' });
        if (!transcriber) {
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en',
                { quantized: true, revision: 'main', progress_callback: makeProgressCb('whisper') });
        }
        const sttResult = await transcriber(audioData, { language: 'english', task: 'transcribe' });
        const text = sttResult.text.trim();
        postMessage({ status: 'transcribed', text });

        if (!text || text.length < 2) throw new Error('Audio too quiet or unclear.');

        // 2. Translation
        postMessage({ status: 'translating' });
        if (!translator) {
            translator = await pipeline('translation', 'Xenova/opus-mt-en-es',
                { quantized: true, progress_callback: makeProgressCb('marian') });
        }
        const translationResult = await translator(text);
        const translatedText = translationResult[0].translation_text;
        postMessage({ status: 'translated', text: translatedText });

        // 3. TTS
        postMessage({ status: 'synthesizing' });
        if (!synthesizer) {
            synthesizer = await pipeline('text-to-speech', 'Xenova/speecht5_tts',
                { quantized: true, progress_callback: makeProgressCb('tts') });
        }

        const speaker_embeddings = new Tensor('float32', new Float32Array(512).fill(0.1), [1, 512]);
        const audioResult = await synthesizer(translatedText, { speaker_embeddings });
        postMessage({ status: 'audio_ready', audio: audioResult.audio });

    } catch (err) {
        postMessage({ status: 'error', message: err.message });
    }
};
