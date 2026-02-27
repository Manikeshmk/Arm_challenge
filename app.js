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

// ─── Error display ────────────────────────────────────────────────────────────
function showError(msg) {
    console.error('[App Error]', msg);
    errorMsg.textContent = msg;
    errorBanner.style.display = 'block';
    recordBtn.className = 'state-ready';
    recordBtn.disabled = false;
    recordBtn.textContent = '🎙 Hold to Speak';
}

// ─── Audio / recording state ──────────────────────────────────────────────────
// NOTE: Three separate audio contexts for three separate jobs:
//   capCtx  – visualiser during recording (created/closed each session)
//   playCtx – TTS playback (persistent, created once after models load)
//   MediaRecorder uses the raw stream; decodeAudioData uses a fresh plain ctx
let capCtx = null;   // recording-session visualiser context
let playCtx = null;   // persistent playback context for TTS
let mediaStream = null;
let mediaRecorder = null;
let analyser = null;
let recordedChunks = [];
let capturedDurSec = 0;
let isRecording = false;
let recStart = 0;
let recTimer = null;
let animFrame = null;

// ── Visualiser: AnalyserNode → SilentGain → destination ─────────────────────
// Must be connected all the way to destination or Chrome won't process the graph
function drawLevel() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    bars.forEach((bar, i) => {
        const idx = Math.floor((i / bars.length) * buf.length);
        const h = Math.max(4, Math.round((buf[idx] / 255) * 100));
        bar.style.height = h + '%';
        bar.style.background = h > 60 ? 'rgba(244,63,94,0.9)'
            : h > 25 ? 'rgba(251,191,36,0.75)'
                : 'rgba(244,63,94,0.3)';
    });
    animFrame = requestAnimationFrame(drawLevel);
}

// ── Returns a MIME type MediaRecorder supports on this browser ────────────────
function bestMimeType() {
    const list = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
        ''
    ];
    return list.find(t => !t || MediaRecorder.isTypeSupported(t)) ?? '';
}

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });

worker.addEventListener('message', ({ data }) => {

    // ── A: Model loading ─────────────────────────────────────────────────────
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

        // Create the persistent playback AudioContext now (requires prior user gesture
        // on iOS, but model loading itself counts as enough interaction in practice)
        playCtx = new (window.AudioContext || window.webkitAudioContext)();
        playCtx.resume();

        setTimeout(() => {
            loadingCard.style.display = 'none';
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, 700);

        // ── B: Inference pipeline ─────────────────────────────────────────────────
    } else if (data.status === 'transcribing') {
        pipelineCard.style.display = 'block';
        setStep('capture', 'done', `Captured ${capturedDurSec.toFixed(1)}s of audio`);
        setStep('stt', 'active', 'Running Whisper on Arm CPU WASM…');
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
        setStep('play', 'active', 'Playing synthesised Spanish audio…');

        // Resume playCtx (needed after inactivity on some browsers)
        playCtx.resume().then(() => {
            // x4 gain boost — SpeechT5 output is inherently quiet
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
                setStep('play', 'done', `Played ${durSec.toFixed(1)}s of Spanish audio`);
                recordBtn.className = 'state-ready';
                recordBtn.disabled = false;
                recordBtn.textContent = '🎙 Hold to Speak';
            }, durSec * 1000 + 200);
        });

        // ── C: Error ──────────────────────────────────────────────────────────────
    } else if (data.status === 'error') {
        ['stt', 'translate', 'tts', 'play'].forEach(id => {
            if ($(`ps-${id}`)?.classList.contains('active')) setStep(id, 'error', data.message);
        });
        showError(data.message);
        if (loadingCard.style.display !== 'none') {
            loadEta.textContent = '❌ ' + data.message;
            loadEta.style.color = '#f43f5e';
        }
    }
});

// ─── startRecording ───────────────────────────────────────────────────────────
async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    recordedChunks = [];
    capturedDurSec = 0;
    recStart = Date.now();

    pipelineCard.style.display = 'block';
    setStep('capture', 'active', 'Recording microphone audio…');
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
        // Request mic — let browser choose sample rate (most compatible)
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });

        // ── Visualiser audio graph ────────────────────────────────────────────
        // capCtx runs at the browser's native rate (44100 / 48000 Hz).
        // We do NOT set sampleRate:16000 here — that broke decodeAudioData.
        capCtx = new (window.AudioContext || window.webkitAudioContext)();
        await capCtx.resume();    // un-suspend (important on mobile Safari)

        const source = capCtx.createMediaStreamSource(mediaStream);
        analyser = capCtx.createAnalyser();
        analyser.fftSize = 64;

        // Silent gain node — keeps graph connected to destination so
        // Chromium actually processes it, but produces zero output (no echo)
        const silent = capCtx.createGain();
        silent.gain.value = 0;

        source.connect(analyser);
        source.connect(silent);
        silent.connect(capCtx.destination);   // must reach destination

        micMeter.style.display = 'block';
        drawLevel();

        recTimer = setInterval(() => {
            micDur.textContent = ((Date.now() - recStart) / 1000).toFixed(1) + 's';
        }, 100);

        // ── MediaRecorder capture ─────────────────────────────────────────────
        const mime = bestMimeType();
        const recOpts = mime ? { mimeType: mime } : {};
        mediaRecorder = new MediaRecorder(mediaStream, recOpts);

        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.start(100);   // flush every 100 ms — works for very short clips too

    } catch (err) {
        isRecording = false;
        setStep('capture', 'error', err.message);
        showError('Microphone access denied or unavailable: ' + err.message);
        micMeter.style.display = 'none';
        recordBtn.className = 'state-ready';
        recordBtn.textContent = '🎙 Hold to Speak';
    }
}

// ─── stopRecording ────────────────────────────────────────────────────────────
async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    capturedDurSec = (Date.now() - recStart) / 1000;

    clearInterval(recTimer);
    cancelAnimationFrame(animFrame);
    analyser = null;
    micMeter.style.display = 'none';
    bars.forEach(b => { b.style.height = '4px'; });

    recordBtn.className = 'state-processing';
    recordBtn.disabled = true;
    recordBtn.textContent = '⚙ Processing…';

    // Stop tracks immediately so OS mic indicator goes away
    mediaStream?.getTracks().forEach(t => t.stop());

    // Close capCtx — we no longer need it
    capCtx?.close().catch(() => { });
    capCtx = null;

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        showError('Nothing was recorded — please hold the button while speaking.');
        return;
    }

    // Flush remaining chunks then decode
    mediaRecorder.onstop = async () => {
        try {
            if (recordedChunks.length === 0) {
                throw new Error('No audio data captured. Try holding the button longer.');
            }

            recordBtn.textContent = '⚙ Decoding audio…';
            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();

            // ── Decode using a plain AudioContext (no custom sampleRate!) ────────
            // A sampleRate-constrained context can reject decodeAudioData for
            // audio encoded at a different rate (e.g. 48kHz WebM on a 16kHz ctx).
            const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
            let decoded;
            try {
                decoded = await decodeCtx.decodeAudioData(arrayBuffer);
            } finally {
                decodeCtx.close();   // always release, even on error
            }

            capturedDurSec = decoded.duration;
            recordBtn.textContent = '⚙ Resampling to 16 kHz…';

            // ── Resample to 16 kHz mono (Whisper requirement) ────────────────────
            const TARGET_RATE = 16000;
            const offCtx = new OfflineAudioContext(
                1,
                Math.ceil(decoded.duration * TARGET_RATE),
                TARGET_RATE
            );
            const offSrc = offCtx.createBufferSource();
            offSrc.buffer = decoded;
            offSrc.connect(offCtx.destination);
            offSrc.start(0);

            const resampled = await offCtx.startRendering();
            const float32 = resampled.getChannelData(0);
            capturedDurSec = float32.length / TARGET_RATE;

            recordBtn.textContent = '⚙ Running AI Pipeline…';
            worker.postMessage({ type: 'process_audio', audio: float32 });

        } catch (err) {
            showError('Audio processing failed: ' + err.message);
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
