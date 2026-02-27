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

// ─── Build mic level bars ─────────────────────────────────────────────────────
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

    // indicator icon
    indEl.outerHTML = state === 'active'
        ? `<div class="spinner" id="minds-${key}"></div>`
        : state === 'done'
            ? `<div class="check-icon" id="minds-${key}">✓</div>`
            : `<div class="idle-dot"  id="minds-${key}"></div>`;

    if (typeof pct === 'number') {
        bar.style.width = pct + '%';
        pctEl.textContent = pct + '%';
    }
    if (filePath) {
        // show just the filename, not full URL
        const fname = filePath.split('/').pop().split('?')[0];
        fileEl.textContent = fname || filePath;
    }
    if (state === 'done') {
        bar.style.width = '100%';
        pctEl.textContent = '100%';
        fileEl.textContent = '✓ Cached';
    }
}

// ─── Pipeline step state ──────────────────────────────────────────────────────
// state: 'idle' | 'active' | 'done' | 'error'
const stepTimers = {};  // stepId → { start, interval }

function setStep(id, state, desc) {
    const step = $(`ps-${id}`);
    const indEl = $(`pi-${id}`);
    const pbEl = $(`pb-${id}`);
    const timerEl = $(`pt-${id}`);
    if (!step) return;

    step.className = 'p-step' + (state === 'active' ? ' active' : state === 'done' ? ' done' : state === 'error' ? ' error' : '');

    // update description if provided
    if (desc) step.querySelector('.p-step-desc').textContent = desc;

    // indicator
    const newInd = state === 'active'
        ? `<div class="spinner" id="pi-${id}"></div>`
        : state === 'done'
            ? `<span class="check-icon" id="pi-${id}">✓</span>`
            : state === 'error'
                ? `<span style="color:var(--red);font-size:.85rem" id="pi-${id}">✕</span>`
                : `<div class="idle-dot" id="pi-${id}"></div>`;
    $(`pi-${id}`).outerHTML = newInd;

    // animated progress bar (indeterminate when active, hidden otherwise)
    if (pbEl) {
        if (state === 'active') {
            pbEl.style.display = 'block';
            pbEl.classList.add('indeterminate');
        } else {
            pbEl.style.display = 'none';
            pbEl.classList.remove('indeterminate');
        }
    }

    // timer
    if (state === 'active') {
        const t0 = Date.now();
        stepTimers[id] && clearInterval(stepTimers[id]);
        stepTimers[id] = setInterval(() => {
            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            if (timerEl) timerEl.textContent = secs + 's';
        }, 100);
    } else {
        clearInterval(stepTimers[id]);
        // keep last time shown when done/error; reset to '—' when idle
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
let audioContext, mediaStream, processor, analyser;
let audioSegments = [];
let isRecording = false;
let recStart = 0;
let recTimer = null;
let animFrame = null;

function drawMicLevel() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);

    bars.forEach((bar, i) => {
        const idx = Math.floor((i / bars.length) * buf.length);
        const h = Math.round((buf[idx] / 255) * 100);
        bar.style.height = Math.max(4, h) + '%';
        bar.style.background = h > 60
            ? 'rgba(244,63,94,0.85)'
            : h > 30
                ? 'rgba(251,191,36,0.7)'
                : 'rgba(244,63,94,0.3)';
    });
    animFrame = requestAnimationFrame(drawMicLevel);
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
        // Force all 100%
        ['whisper', 'marian', 'tts'].forEach(k => { modelPct[k] = 100; setModelState(k, 'done'); });
        updateOverall();
        loadEta.textContent = '✅ All models cached — works offline now!';

        setTimeout(() => {
            loadingCard.style.display = 'none';
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, 700);

        // ── B: Inference pipeline events ─────────────────────────────────────────
    } else if (data.status === 'transcribing') {
        pipelineCard.style.display = 'block';
        setStep('capture', 'done', `Captured ${(audioSegments.reduce((a, b) => a + b.length, 0) / 16000).toFixed(1)}s of audio`);
        setStep('stt', 'active');
        setStep('translate', 'idle');
        setStep('tts', 'idle');
        setStep('play', 'idle');

        transcriptText.textContent = 'Running Whisper on Arm CPU…';
        transcriptText.className = 'out-text processing';

    } else if (data.status === 'transcribed') {
        setStep('stt', 'done', `Recognised: "${data.text.slice(0, 40)}${data.text.length > 40 ? '…' : ''}"`);
        transcriptText.textContent = data.text;
        transcriptText.className = 'out-text filled';
        boxTranscript.classList.add('has-content');

    } else if (data.status === 'translating') {
        setStep('translate', 'active');
        translationText.textContent = 'Running MarianMT NMT…';
        translationText.className = 'out-text processing';

    } else if (data.status === 'translated') {
        setStep('translate', 'done', `Translated: "${data.text.slice(0, 40)}${data.text.length > 40 ? '…' : ''}"`);
        translationText.textContent = data.text;
        translationText.className = 'out-text filled';
        boxTranslation.classList.add('has-content');

    } else if (data.status === 'synthesizing') {
        setStep('tts', 'active');

    } else if (data.status === 'audio_ready') {
        setStep('tts', 'done');
        setStep('play', 'active', 'Streaming audio to speaker…');

        const buf = audioContext.createBuffer(1, data.audio.length, 16000);
        buf.getChannelData(0).set(data.audio);
        const src = audioContext.createBufferSource();
        src.buffer = buf;
        src.connect(audioContext.destination);
        src.start();

        const durSec = data.audio.length / 16000;
        setTimeout(() => {
            setStep('play', 'done', `Played ${durSec.toFixed(1)}s of audio`);
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, durSec * 1000);

        // ── C: Error ─────────────────────────────────────────────────────────────
    } else if (data.status === 'error') {
        // mark whichever pipeline step was active as error
        ['stt', 'translate', 'tts', 'play'].forEach(id => {
            if ($(`ps-${id}`)?.classList.contains('active')) setStep(id, 'error', data.message);
        });
        showError(data.message);
        // also show in loading card if still visible
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
    audioSegments = [];
    recStart = Date.now();

    // Show pipeline card early, mark step 1 active
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
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });

        const source = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = e => {
            audioSegments.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };

        source.connect(analyser);
        source.connect(processor);
        processor.connect(audioContext.destination);

        // Show mic meter
        micMeter.style.display = 'block';
        drawMicLevel();

        // Duration counter
        recTimer = setInterval(() => {
            const secs = ((Date.now() - recStart) / 1000).toFixed(1);
            micDur.textContent = secs + 's';
        }, 100);

    } catch (e) {
        isRecording = false;
        showError('Microphone access denied: ' + e.message);
        setStep('capture', 'error', 'Microphone permission denied');
        recordBtn.className = 'state-ready';
        recordBtn.textContent = '🎙 Hold to Speak';
        micMeter.style.display = 'none';
    }
}

function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    clearInterval(recTimer);
    cancelAnimationFrame(animFrame);
    micMeter.style.display = 'none';
    bars.forEach(b => b.style.height = '4px');

    const durSec = ((Date.now() - recStart) / 1000).toFixed(1);
    setStep('capture', 'done', `Captured ${durSec}s of audio`);

    recordBtn.className = 'state-processing';
    recordBtn.disabled = true;
    recordBtn.textContent = '⚙ Processing Pipeline…';

    processor?.disconnect();
    mediaStream?.getTracks().forEach(t => t.stop());

    // Flatten PCM
    const totalLen = audioSegments.reduce((a, b) => a + b.length, 0);
    const flat = new Float32Array(totalLen);
    let offset = 0;
    for (const seg of audioSegments) { flat.set(seg, offset); offset += seg.length; }

    worker.postMessage({ type: 'process_audio', audio: flat });
}

// ─── Input bindings ───────────────────────────────────────────────────────────
recordBtn.addEventListener('mousedown', startRecording);
recordBtn.addEventListener('mouseup', stopRecording);
recordBtn.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });
recordBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchend', e => { e.preventDefault(); stopRecording(); });
