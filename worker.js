import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Ensure the WebAssembly modules use the phone's native SIMD CPU operations
// These are heavily optimized mapping native ARM instructions where the browser allows it.
env.allowLocalModels = false;
env.backends.onnx.wasm.simd = true;
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

let transcriber;
let translator;
let synthesizer;

onmessage = async (e) => {
    if (e.data.type === 'process_audio') {
        const audioData = e.data.audio;

        try {
            // ================= 1. Speech-To-Text (Whisper) =================
            postMessage({ status: 'transcribing' });
            if (!transcriber) {
                // Whisper Tiny.en takes roughly ~40MB RAM (Int8 Quantized)
                transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                    quantized: true,
                    revision: 'main'
                });
            }

            const sttResult = await transcriber(audioData, {
                language: 'english',
                task: 'transcribe',
            });
            const text = sttResult.text.trim();
            postMessage({ status: 'transcribed', text: text });

            if (!text || text.length < 2) throw new Error("Audio too quiet or unclear.");

            // ================= 2. Translation Context (Marian MT / LLM equivalent) =================
            // Uses a compact MarianMT language model specifically trained for En->Es. Extremely fast on Arm constraints.
            postMessage({ status: 'translating' });
            if (!translator) {
                translator = await pipeline('translation', 'Xenova/opus-mt-en-es', {
                    quantized: true
                });
            }

            const translationResult = await translator(text);
            const translatedText = translationResult[0].translation_text;
            postMessage({ status: 'translated', text: translatedText });

            // ================= 3. Text-to-Speech Output =================
            // Leveraging an Acoustic Vocoder (SpeechT5) within the browser. 
            postMessage({ status: 'synthesizing' });
            if (!synthesizer) {
                // FastSpeech + HiFiGAN vocoder setup
                synthesizer = await pipeline('text-to-speech', 'Xenova/speecht5_tts', {
                    quantized: true
                });
            }

            // A default Voice Embedding Tensor required by the HiFiGAN layer
            const speaker_embeddings = new Tensor(
                'float32',
                new Float32Array(512).fill(0.1), // Simplified flattened embedding array
                [1, 512]
            );

            const audioResult = await synthesizer(translatedText, {
                speaker_embeddings: speaker_embeddings
            });

            // Post back raw audio buffer to the main UI thread to pipe out of the smartphone speaker.
            postMessage({ status: 'audio_ready', audio: audioResult.audio });

        } catch (err) {
            postMessage({ status: 'error', message: err.message });
        }
    }
};

// Initialize Models in Background automatically upon worker load
(async () => {
    try {
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { quantized: true });
        postMessage({ status: 'init_done' });

        // Asynchronously pre-fetch the other models 
        translator = await pipeline('translation', 'Xenova/opus-mt-en-es', { quantized: true });
        synthesizer = await pipeline('text-to-speech', 'Xenova/speecht5_tts', { quantized: true });
    } catch (e) {
        postMessage({ status: 'error', message: "Hardware init failed." });
    }
})();
