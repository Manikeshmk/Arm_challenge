import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// ── Arm-Optimised WASM Runtime ────────────────────────────────────────────────
env.allowLocalModels = false;
env.backends.onnx.wasm.simd = true;          // ARM NEON SIMD paths
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

let transcriber, translator, synthesizer;

// ── Rich Progress Callback ────────────────────────────────────────────────────
// Transformers.js fires: { status, name, file, progress, loaded, total }
function makeProgressCb(modelKey) {
    return (p) => {
        const pct = Math.min(100, Math.round(p.progress ?? 0));
        const file = p.file ?? '';

        if (p.status === 'initiate') {
            postMessage({ status: 'model_progress', model: modelKey, pct: 0, file });

        } else if (p.status === 'download' || p.status === 'progress') {
            postMessage({ status: 'model_progress', model: modelKey, pct, file });

        } else if (p.status === 'done') {
            postMessage({ status: 'model_progress', model: modelKey, pct: 100, file });

        } else if (p.status === 'ready') {
            postMessage({ status: 'model_progress', model: modelKey, pct: 100, file: '(ready)' });
        }
    };
}

// ── Auto-Init: load all three models on worker startup ────────────────────────
(async () => {
    try {
        // ── 1. Whisper Tiny STT (~40 MB) ────────────────────────────────────────
        postMessage({ status: 'load_start', model: 'whisper' });
        transcriber = await pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            { quantized: true, revision: 'main', progress_callback: makeProgressCb('whisper') }
        );
        postMessage({ status: 'model_done', model: 'whisper' });

        // ── 2. MarianMT EN→ES (~75 MB) ──────────────────────────────────────────
        postMessage({ status: 'load_start', model: 'marian' });
        translator = await pipeline(
            'translation',
            'Xenova/opus-mt-en-es',
            { quantized: true, progress_callback: makeProgressCb('marian') }
        );
        postMessage({ status: 'model_done', model: 'marian' });

        // ── 3. SpeechT5 TTS (~150 MB) ───────────────────────────────────────────
        postMessage({ status: 'load_start', model: 'tts' });
        synthesizer = await pipeline(
            'text-to-speech',
            'Xenova/speecht5_tts',
            { quantized: true, progress_callback: makeProgressCb('tts') }
        );
        postMessage({ status: 'model_done', model: 'tts' });

        // All models ready
        postMessage({ status: 'init_done' });

    } catch (e) {
        postMessage({
            status: 'error',
            message: 'Model initialisation failed: ' + (e?.message ?? String(e))
        });
    }
})();

// ── Inference Pipeline ────────────────────────────────────────────────────────
onmessage = async (e) => {
    if (e.data.type !== 'process_audio') return;
    const audioData = e.data.audio;

    try {
        // ── Stage 1: Speech Recognition ─────────────────────────────────────────
        postMessage({ status: 'transcribing' });

        // Lazy-load if somehow missed (shouldn't happen normally)
        if (!transcriber) {
            transcriber = await pipeline(
                'automatic-speech-recognition', 'Xenova/whisper-tiny.en',
                { quantized: true, revision: 'main', progress_callback: makeProgressCb('whisper') }
            );
        }

        const sttResult = await transcriber(audioData, { language: 'english', task: 'transcribe' });
        const text = sttResult.text.trim();
        postMessage({ status: 'transcribed', text });

        if (!text || text.length < 1) {
            throw new Error('No speech detected. Please speak clearly into the microphone and try again.');
        }

        // ── Stage 2: Neural Translation ─────────────────────────────────────────
        postMessage({ status: 'translating' });

        if (!translator) {
            translator = await pipeline(
                'translation', 'Xenova/opus-mt-en-es',
                { quantized: true, progress_callback: makeProgressCb('marian') }
            );
        }

        const translationResult = await translator(text);
        const translatedText = translationResult[0].translation_text;
        postMessage({ status: 'translated', text: translatedText });

        // ── Stage 3: Text-to-Speech Synthesis ───────────────────────────────────
        postMessage({ status: 'synthesizing' });

        if (!synthesizer) {
            synthesizer = await pipeline(
                'text-to-speech', 'Xenova/speecht5_tts',
                { quantized: true, progress_callback: makeProgressCb('tts') }
            );
        }

        // Default speaker embedding for HiFiGAN vocoder
        const speaker_embeddings = new Tensor(
            'float32',
            new Float32Array(512).fill(0.1),
            [1, 512]
        );

        const audioResult = await synthesizer(translatedText, { speaker_embeddings });

        // Send raw audio buffer back to main thread for playback
        postMessage({ status: 'audio_ready', audio: audioResult.audio });

    } catch (err) {
        postMessage({
            status: 'error',
            message: err?.message ?? String(err)
        });
    }
};
