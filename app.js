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

    if (pbEl) {
        pbEl.style.display = state === 'active' ? 'block' : 'none';
    }

    if (state === 'active') {
        const t0 = Date.now();
        clearInterval(stepTimers[id]);
        stepTimers[id] = setInterval(() => {
            const s = ((Date.now() - t0) / 1000).toFixed(1);
            if (timerEl) timerEl.textContent = s + 's';
        }, 100);
    } else {
        clearInterval(stepTimers[id]);
        if (state === 'idle') timerEl.textContent = '—';
    }
}

// ─── Error display ────────────────────────────────────────────────────────────
function showError(msg) {
    errorMsg.textContent = msg;
    errorBanner.style.display = 'block';
    recordBtn.className = 'state-ready';
    recordBtn.disabled = false;
    recordBtn.textContent = '🎙 Hold to Speak';
}

// ─── Audio / recording state ──────────────────────────────────────────────────
let audioContext, mediaStream, analyser, mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let recStart = 0;
let recTimer = null;
let animFrame = null;

// Recorded audio duration in seconds (set when MediaRecorder stops)
let capturedDurSec = 0;

// ── Returns a MIME type MediaRecorder actually supports ──────────────────────
function bestMimeType() {
    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
        ''
    ];
    return types.find(t => !t || MediaRecorder.isTypeSupported(t)) ?? '';
}

// ── Mic level visualiser (AnalyserNode, no ScriptProcessor) ──────────────────
function drawLevel() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    bars.forEach((bar, i) => {
        const idx = Math.floor((i / bars.length) * buf.length);
        const h = Math.max(4, Math.round((buf[idx] / 255) * 100));
        bar.style.height = h + '%';
        bar.style.background = h > 60
            ? 'rgba(244,63,94,0.9)'
            : h > 25
                ? 'rgba(251,191,36,0.75)'
                : 'rgba(244,63,94,0.3)';
    });
    animFrame = requestAnimationFrame(drawLevel);
}

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });

worker.addEventListener('message', ({ data }) => {

    // ── A: Model loading events ──────────────────────────────────────────────
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
        setTimeout(() => {
            loadingCard.style.display = 'none';
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, 700);

        // ── B: Inference events ──────────────────────────────────────────────────
    } else if (data.status === 'transcribing') {
        pipelineCard.style.display = 'block';
        setStep('capture', 'done', `Captured ${capturedDurSec.toFixed(1)}s of audio`);
        setStep('stt', 'active', 'Running Whisper speech recognition on Arm CPU…');
        setStep('translate', 'idle');
        setStep('tts', 'idle');
        setStep('play', 'idle');
        transcriptText.textContent = 'Running Whisper on Arm CPU…';
        transcriptText.className = 'out-text processing';

    } else if (data.status === 'transcribed') {
        setStep('stt', 'done', `Recognised: "${data.text.slice(0, 50)}${data.text.length > 50 ? '…' : ''}"`);
        transcriptText.textContent = data.text;
        transcriptText.className = 'out-text filled';
        boxTranscript.classList.add('has-content');

    } else if (data.status === 'translating') {
        setStep('translate', 'active', 'Neural machine translation EN → ES…');
        translationText.textContent = 'Translating with MarianMT…';
        translationText.className = 'out-text processing';

    } else if (data.status === 'translated') {
        setStep('translate', 'done', `Translated: "${data.text.slice(0, 50)}${data.text.length > 50 ? '…' : ''}"`);
        translationText.textContent = data.text;
        translationText.className = 'out-text filled';
        boxTranslation.classList.add('has-content');

    } else if (data.status === 'synthesizing') {
        setStep('tts', 'active', 'Generating speech waveform via HiFiGAN vocoder…');

    } else if (data.status === 'audio_ready') {
        setStep('tts', 'done');
        setStep('play', 'active', 'Streaming synthesised audio to speaker…');

        // ── Play TTS audio with 4× gain boost (SpeechT5 output is quiet) ────────
        const buf = audioContext.createBuffer(1, data.audio.length, 16000);
        buf.getChannelData(0).set(data.audio);

        const src = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        gain.gain.value = 4.0;   // ← boost output volume x4
        src.buffer = buf;
        src.connect(gain);
        gain.connect(audioContext.destination);
        src.start();

        const durSec = data.audio.length / 16000;
        setTimeout(() => {
            setStep('play', 'done', `Played ${durSec.toFixed(1)}s of Spanish audio`);
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, durSec * 1000 + 200);

        // ── C: Error ─────────────────────────────────────────────────────────────
    } else if (data.status === 'error') {
        ['stt', 'translate', 'tts', 'play'].forEach(id => {
            if ($(`ps-${id}`)?.classList.contains('active')) {
                setStep(id, 'error', data.message);
            }
        });
        showError(data.message);
        if (loadingCard.style.display !== 'none') {
            loadEta.textContent = '❌ ' + data.message;
            loadEta.style.color = '#f43f5e';
        }
    }
});

// ─── Recording ────────────────────────────────────────────────────────────────
async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    recordedChunks = [];
    capturedDurSec = 0;
    recStart = Date.now();

    // Show pipeline card, activate step 1
    pipelineCard.style.display = 'block';
    setStep('capture', 'active', 'Recording from microphone at 16 kHz…');
    setStep('stt', 'idle');
    setStep('translate', 'idle');
    setStep('tts', 'idle');
    setStep('play', 'idle');

    recordBtn.className = 'state-recording';
    recordBtn.textContent = '🔴 Release to Process';
    transcriptText.textContent = 'Listening…';
    transcriptText.className = 'out-text';
    translationText.textContent = 'Awaiting pipeline…';
    translationText.className = 'out-text';

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });

        // Create AudioContext for visualiser ONLY — do NOT connect to destination
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        await audioContext.resume();          // ← critical: un-suspend on mobile

        const source = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        // NOT connected to destination → no echo / feedback

        // Show mic meter + draw level bars
        micMeter.style.display = 'block';
        drawLevel();

        // Duration counter
        recTimer = setInterval(() => {
            micDur.textContent = ((Date.now() - recStart) / 1000).toFixed(1) + 's';
        }, 100);

        // ── MediaRecorder: reliable cross-browser audio capture ──────────────────
        const mime = bestMimeType();
        mediaRecorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : {});
        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(200);   // chunk every 200ms → works even for very short clips

    } catch (err) {
        isRecording = false;
        setStep('capture', 'error', 'Microphone permission denied');
        showError('Microphone access denied: ' + err.message);
        micMeter.style.display = 'none';
        recordBtn.className = 'state-ready';
        recordBtn.textContent = '🎙 Hold to Speak';
    }
}

async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    capturedDurSec = (Date.now() - recStart) / 1000;

    clearInterval(recTimer);
    cancelAnimationFrame(animFrame);
    micMeter.style.display = 'none';
    bars.forEach(b => { b.style.height = '4px'; });

    recordBtn.className = 'state-processing';
    recordBtn.disabled = true;
    recordBtn.textContent = '⚙ Decoding Audio…';

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        showError('No audio was recorded — try holding the button longer.');
        return;
    }

    // Wait for MediaRecorder to flush all chunks, then decode + resample
    mediaRecorder.onstop = async () => {
        try {
            mediaStream?.getTracks().forEach(t => t.stop());

            if (recordedChunks.length === 0) {
                throw new Error('No audio chunks received. Hold the button for at least 0.5 seconds.');
            }

            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();

            // Decode compressed audio → AudioBuffer
            const decoded = await audioContext.decodeAudioData(arrayBuffer);
            capturedDurSec = decoded.duration;

            recordBtn.textContent = '⚙ Resampling to 16 kHz…';

            // Resample to 16 kHz mono Float32Array (required by Whisper)
            const targetRate = 16000;
            const offCtx = new OfflineAudioContext(
                1,
                Math.ceil(decoded.duration * targetRate),
                targetRate
            );
            const src = offCtx.createBufferSource();
            src.buffer = decoded;
            src.connect(offCtx.destination);
            src.start(0);

            const resampled = await offCtx.startRendering();
            const float32 = resampled.getChannelData(0);

            capturedDurSec = float32.length / targetRate;

            recordBtn.textContent = '⚙ Running AI Pipeline…';
            worker.postMessage({ type: 'process_audio', audio: float32 });

        } catch (err) {
            showError('Audio decode failed: ' + err.message);
            setStep('capture', 'error', err.message);
        }
    };

    mediaRecorder.stop();
}

// ─── Input bindings ───────────────────────────────────────────────────────────
recordBtn.addEventListener('mousedown', startRecording);
recordBtn.addEventListener('mouseup', stopRecording);
recordBtn.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });
recordBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); });
