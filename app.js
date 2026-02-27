// ─────────────────────────────────────────────────────────────────────────────
// app.js  –  Main UI controller
// ─────────────────────────────────────────────────────────────────────────────

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const loadingCard = $('loadingCard');
const overallBar = $('overallBar');
const overallPct = $('overallPct');
const loadEta = $('loadEta');
const errorBanner = $('errorBanner');
const errorMsg = $('errorMsg');
const pipelineCard = $('pipelineCard');
const micMeter = $('micMeter');
const micDur = $('micDur');
const levelBars = $('levelBars');
const recordBtn = $('recordBtn');
const transcriptText = $('transcriptText');
const translationText = $('translationText');
const boxTranscript = $('box-transcript');
const boxTranslation = $('box-translation');

// ─── Build mic level visualiser bars ─────────────────────────────────────────
for (let i = 0; i < 22; i++) {
    const b = document.createElement('div');
    b.className = 'level-bar';
    levelBars.appendChild(b);
}
const bars = levelBars.querySelectorAll('.level-bar');

// ─── Model loading state ──────────────────────────────────────────────────────
const MODEL_MB = { whisper: 40, marian: 75, tts: 150 };
const TOTAL_MB = Object.values(MODEL_MB).reduce((a, b) => a + b, 0);
const modelPct = { whisper: 0, marian: 0, tts: 0 };
let loadStart = Date.now();

function updateOverall() {
    const doneMB = Object.entries(modelPct).reduce((a, [k, p]) => a + (p / 100) * MODEL_MB[k], 0);
    const overall = Math.min(100, Math.round((doneMB / TOTAL_MB) * 100));
    overallBar.style.width = overall + '%';
    overallPct.textContent = overall + '%';

    const elapsed = (Date.now() - loadStart) / 1000;
    if (elapsed > 4 && overall > 3) {
        const remaining = Math.round((elapsed / overall) * (100 - overall));
        if (remaining > 1) {
            const m = Math.floor(remaining / 60), s = remaining % 60;
            loadEta.textContent = `Downloading… ETA ${m > 0 ? m + 'm ' : ''}${s}s`;
        } else {
            loadEta.textContent = 'Finalising — almost ready…';
        }
    }
}

function setModelState(key, state, filePath, pct) {
    const row = $(`mrow-${key}`);
    const bar = $(`mbar-${key}`);
    const pctEl = $(`mpct-${key}`);
    const indEl = $(`minds-${key}`);
    const fileEl = $(`mfile-${key}`);
    if (!row) return;

    row.className = 'model-row' + (state === 'active' ? ' active' : state === 'done' ? ' done' : '');

    indEl.outerHTML = state === 'active'
        ? `<div class="spinner"    id="minds-${key}"></div>`
        : state === 'done'
            ? `<div class="check-icon" id="minds-${key}">✓</div>`
            : `<div class="idle-dot"   id="minds-${key}"></div>`;

    if (typeof pct === 'number') {
        bar.style.width = pct + '%';
        pctEl.textContent = pct + '%';
    }
    if (filePath) {
        const fname = filePath.split('/').pop().split('?')[0];
        fileEl.textContent = fname || filePath;
    }
    if (state === 'done') {
        bar.style.width = '100%';
        pctEl.textContent = '100%';
        fileEl.textContent = '✓ Cached';
    }
}

// ─── Pipeline step helpers ────────────────────────────────────────────────────
const stepTimers = {};

function setStep(id, state, desc) {
    const step = $(`ps-${id}`);
    const pbEl = $(`pb-${id}`);
    const timerEl = $(`pt-${id}`);
    if (!step) return;

    step.className = 'p-step' +
        (state === 'active' ? ' active' : state === 'done' ? ' done' : state === 'error' ? ' error' : '');

    if (desc) step.querySelector('.p-step-desc').textContent = desc;

    $(`pi-${id}`).outerHTML = state === 'active'
        ? `<div class="spinner"   id="pi-${id}"></div>`
        : state === 'done'
            ? `<span class="check-icon" id="pi-${id}">✓</span>`
            : state === 'error'
                ? `<span style="color:var(--red);font-size:.85rem" id="pi-${id}">✕</span>`
                : `<div class="idle-dot"  id="pi-${id}"></div>`;

    if (pbEl) pbEl.style.display = state === 'active' ? 'block' : 'none';

    if (state === 'active') {
        const t0 = Date.now();
        clearInterval(stepTimers[id]);
        stepTimers[id] = setInterval(() => {
            if (timerEl) timerEl.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's';
        }, 100);
    } else {
        clearInterval(stepTimers[id]);
        if (state === 'idle' && timerEl) timerEl.textContent = '—';
    }
}

function showError(msg) {
    console.error('[App Error]', msg);
    errorMsg.textContent = msg;
    errorBanner.style.display = 'block';
    recordBtn.className = 'state-ready';
    recordBtn.disabled = false;
    recordBtn.textContent = '🎙 Hold to Speak';
}

// ─── Audio State ──────────────────────────────────────────────────────────────
let capCtx = null;   // recording visualizer context
let playCtx = null;  // persistent playback context
let mediaStream = null;
let mediaRecorder = null;
let analyser = null;
let recordedChunks = [];
let capturedDurSec = 0;
let isRecording = false;
let recStart = 0;
let recTimer = null;
let animFrame = null;

function drawLevel() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    bars.forEach((bar, i) => {
        const idx = Math.floor((i / bars.length) * buf.length);
        const h = Math.max(4, Math.round((buf[idx] / 255) * 100));
        bar.style.height = h + '%';
        bar.style.background = h > 60 ? 'rgba(244,63,94,0.9)' : h > 25 ? 'rgba(251,191,36,0.75)' : 'rgba(244,63,94,0.3)';
    });
    animFrame = requestAnimationFrame(drawLevel);
}

function bestMimeType() {
    const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', ''];
    return list.find(t => !t || MediaRecorder.isTypeSupported(t)) ?? '';
}

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });

worker.addEventListener('message', ({ data }) => {
    if (data.status === 'load_start') {
        setModelState(data.model, 'active', '', 0);
    } else if (data.status === 'model_progress') {
        modelPct[data.model] = data.pct;
        setModelState(data.model, 'active', data.file, data.pct);
        updateOverall();
    } else if (data.status === 'model_done') {
        modelPct[data.model] = 100;
        setModelState(data.model, 'done');
        updateOverall();
    } else if (data.status === 'init_done') {
        ['whisper', 'marian', 'tts'].forEach(k => { modelPct[k] = 100; setModelState(k, 'done'); });
        updateOverall();
        loadEta.textContent = '✅ All models cached — works offline now!';

        // UI Transition only. AudioContexts are created in startRecording() to satisfy User Gesture policy.
        setTimeout(() => {
            loadingCard.style.display = 'none';
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, 700);

    } else if (data.status === 'transcribing') {
        pipelineCard.style.display = 'block';
        setStep('capture', 'done', `Captured ${capturedDurSec.toFixed(1)}s of audio`);
        setStep('stt', 'active', 'Running Whisper on Arm CPU WASM…');
        transcriptText.textContent = 'Running Whisper…';
        transcriptText.className = 'out-text processing';
    } else if (data.status === 'transcribed') {
        setStep('stt', 'done', `Recognised: "${data.text.slice(0, 40)}..."`);
        transcriptText.textContent = data.text;
        transcriptText.className = 'out-text filled';
        boxTranscript.classList.add('has-content');
    } else if (data.status === 'translating') {
        setStep('translate', 'active', 'Neural translation EN → ES…');
        translationText.textContent = 'Translating…';
        translationText.className = 'out-text processing';
    } else if (data.status === 'translated') {
        setStep('translate', 'done');
        translationText.textContent = data.text;
        translationText.className = 'out-text filled';
        boxTranslation.classList.add('has-content');
    } else if (data.status === 'synthesizing') {
        setStep('tts', 'active', 'Generating waveform…');
    } else if (data.status === 'audio_ready') {
        setStep('tts', 'done');
        setStep('play', 'active', 'Playing audio…');

        if (playCtx) {
            playCtx.resume().then(() => {
                const buf = playCtx.createBuffer(1, data.audio.length, 16000);
                buf.getChannelData(0).set(data.audio);
                const src = playCtx.createBufferSource();
                const gain = playCtx.createGain();
                gain.gain.value = 4.0;
                src.buffer = buf;
                src.connect(gain);
                gain.connect(playCtx.destination);
                src.start();

                const durSec = data.audio.length / 16000;
                setTimeout(() => {
                    setStep('play', 'done', `Finished playback`);
                    recordBtn.className = 'state-ready';
                    recordBtn.disabled = false;
                    recordBtn.textContent = '🎙 Hold to Speak';
                }, durSec * 1000 + 200);
            });
        }
    } else if (data.status === 'error') {
        showError(data.message);
    }
});
// Add these variables to your top-level state
let audioBufferSource = null;
let scriptProcessor = null;
let rawAudioData = [];

async function startRecording() {
    if (isRecording) return;

    // Unlock Audio Contexts immediately
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!capCtx) capCtx = new (window.AudioContext || window.webkitAudioContext)();
    await playCtx.resume();
    await capCtx.resume();

    isRecording = true;
    rawAudioData = []; // Clear previous data
    recStart = Date.now();

    pipelineCard.style.display = 'block';
    setStep('capture', 'active', 'Capturing Audio...');

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            }
        });

        const source = capCtx.createMediaStreamSource(mediaStream);
        analyser = capCtx.createAnalyser();
        analyser.fftSize = 64;

        // Using a ScriptProcessor for maximum compatibility with older Arm browser engines
        // It captures raw Float32 samples as they arrive
        scriptProcessor = capCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
            if (!isRecording) return;
            const inputData = e.inputBuffer.getChannelData(0);
            rawAudioData.push(new Float32Array(inputData)); // Store raw samples
        };

        source.connect(analyser);
        source.connect(scriptProcessor);
        scriptProcessor.connect(capCtx.destination); // Destination connection is vital

        micMeter.style.display = 'block';
        drawLevel();

        recTimer = setInterval(() => {
            micDur.textContent = ((Date.now() - recStart) / 1000).toFixed(1) + 's';
        }, 100);

        recordBtn.className = 'state-recording';
        recordBtn.textContent = '🔴 RELEASE TO TRANSLATE';

    } catch (err) {
        isRecording = false;
        showError('Mic blocked: ' + err.message);
    }
}

async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    // UI Cleanup
    clearInterval(recTimer);
    cancelAnimationFrame(animFrame);
    micMeter.style.display = 'none';
    recordBtn.className = 'state-processing';
    recordBtn.textContent = '⚙ PROCESSING...';

    // Stop hardware
    mediaStream?.getTracks().forEach(t => t.stop());
    scriptProcessor?.disconnect();

    if (rawAudioData.length === 0) {
        showError("No audio detected. Check mic permissions.");
        return;
    }

    // Flatten raw chunks into a single Float32Array
    const totalLength = rawAudioData.reduce((acc, curr) => acc + curr.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of rawAudioData) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    // Resample to 16kHz for Whisper
    const TARGET_RATE = 16000;
    const originalRate = capCtx.sampleRate;

    // Manual Resampling (Linear Interpolation) - More reliable than OfflineCtx on some Arm CPUs
    const resampledData = resampleAudio(result, originalRate, TARGET_RATE);

    console.log(`[AI] Sending ${resampledData.length} samples to Worker`);
    worker.postMessage({ type: 'process_audio', audio: resampledData });
}

// Helper: Fast Linear Resampler
function resampleAudio(buffer, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        result[i] = buffer[Math.round(i * ratio)];
    }
    return result;
}
// ─── Bindings ─────────────────────────────────────────────────────────────────
recordBtn.addEventListener('mousedown', startRecording);
recordBtn.addEventListener('mouseup', stopRecording);
recordBtn.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });
recordBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); });