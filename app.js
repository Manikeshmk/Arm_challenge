// ── app.js – Fixed UI controller ─────────────────────────────────────────────
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

// Build bars
for (let i = 0; i < 22; i++) {
    const b = document.createElement('div');
    b.className = 'level-bar';
    levelBars.appendChild(b);
}
const bars = levelBars.querySelectorAll('.level-bar');

const MODEL_MB = { whisper: 40, marian: 75, tts: 150 };
const TOTAL_MB = 265;
const modelPct = { whisper: 0, marian: 0, tts: 0 };
let loadStart = Date.now();

// ── State ───────────────────────────────────────────────────────────────────
let capCtx = null;
let playCtx = null;
let mediaStream = null;
let mediaRecorder = null;
let analyser = null;
let recordedChunks = [];
let capturedDurSec = 0;
let isRecording = false;
let recStart = 0;
let recTimer = null;
let animFrame = null;

// ── Helpers ──────────────────────────────────────────────────────────────────
function updateOverall() {
    const doneMB = Object.entries(modelPct).reduce((a, [k, p]) => a + (p / 100) * MODEL_MB[k], 0);
    const overall = Math.min(100, Math.round((doneMB / TOTAL_MB) * 100));
    overallBar.style.width = overall + '%';
    overallPct.textContent = overall + '%';
}

function setModelState(key, state, filePath, pct) {
    const row = $(`mrow-${key}`);
    const bar = $(`mbar-${key}`);
    const pctEl = $(`mpct-${key}`);
    const indEl = $(`minds-${key}`);
    const fileEl = $(`mfile-${key}`);
    if (!row) return;

    row.className = 'model-row' + (state === 'active' ? ' active' : state === 'done' ? ' done' : '');
    indEl.outerHTML = state === 'active' ? `<div class="spinner" id="minds-${key}"></div>`
        : state === 'done' ? `<div class="check-icon" id="minds-${key}">✓</div>`
            : `<div class="idle-dot" id="minds-${key}"></div>`;

    if (typeof pct === 'number') { bar.style.width = pct + '%'; pctEl.textContent = pct + '%'; }
    if (filePath) fileEl.textContent = filePath.split('/').pop().split('?')[0];
    if (state === 'done') { bar.style.width = '100%'; pctEl.textContent = '100%'; fileEl.textContent = '✓ Cached'; }
}

const stepTimers = {};
function setStep(id, state, desc) {
    const step = $(`ps-${id}`);
    const pbEl = $(`pb-${id}`);
    const timerEl = $(`pt-${id}`);
    if (!step) return;

    step.className = 'p-step' + (state === 'active' ? ' active' : state === 'done' ? ' done' : state === 'error' ? ' error' : '');
    if (desc) step.querySelector('.p-step-desc').textContent = desc;
    $(`pi-${id}`).outerHTML = state === 'active' ? `<div class="spinner" id="pi-${id}"></div>`
        : state === 'done' ? `<span class="check-icon" id="pi-${id}">✓</span>`
            : state === 'error' ? `<span style="color:var(--red)" id="pi-${id}">✕</span>`
                : `<div class="idle-dot" id="pi-${id}"></div>`;

    if (pbEl) pbEl.style.display = state === 'active' ? 'block' : 'none';
    if (state === 'active') {
        const t0 = Date.now();
        clearInterval(stepTimers[id]);
        stepTimers[id] = setInterval(() => { if (timerEl) timerEl.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
    } else { clearInterval(stepTimers[id]); }
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorBanner.style.display = 'block';
    recordBtn.className = 'state-ready';
    recordBtn.disabled = false;
    recordBtn.textContent = '🎙 Hold to Speak';
}

function drawLevel() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    bars.forEach((bar, i) => {
        const idx = Math.floor((i / bars.length) * buf.length);
        const h = Math.max(4, Math.round((buf[idx] / 255) * 100));
        bar.style.height = h + '%';
        bar.style.background = h > 60 ? 'var(--red)' : h > 25 ? 'var(--yellow)' : 'rgba(244,63,94,0.3)';
    });
    animFrame = requestAnimationFrame(drawLevel);
}

// ── Worker Integration ───────────────────────────────────────────────────────
const worker = new Worker('worker.js', { type: 'module' });

worker.onmessage = ({ data }) => {
    if (data.status === 'model_progress') {
        modelPct[data.model] = data.pct;
        setModelState(data.model, 'active', data.file, data.pct);
        updateOverall();
    } else if (data.status === 'model_done') {
        setModelState(data.model, 'done');
    } else if (data.status === 'init_done') {
        loadEta.textContent = '✅ Ready!';
        setTimeout(() => {
            loadingCard.style.display = 'none';
            recordBtn.className = 'state-ready';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, 500);
    } else if (data.status === 'transcribing') {
        pipelineCard.style.display = 'block';
        setStep('capture', 'done');
        setStep('stt', 'active');
    } else if (data.status === 'transcribed') {
        setStep('stt', 'done');
        transcriptText.textContent = data.text;
        boxTranscript.classList.add('has-content');
    } else if (data.status === 'translating') {
        setStep('translate', 'active');
    } else if (data.status === 'translated') {
        setStep('translate', 'done');
        translationText.textContent = data.text;
        boxTranslation.classList.add('has-content');
    } else if (data.status === 'synthesizing') {
        setStep('tts', 'active');
    } else if (data.status === 'audio_ready') {
        setStep('tts', 'done');
        setStep('play', 'active');
        playOutput(data.audio);
    } else if (data.status === 'error') {
        showError(data.message);
    }
};

async function playOutput(audioArray) {
    if (!playCtx) return;
    await playCtx.resume();
    const buf = playCtx.createBuffer(1, audioArray.length, 16000);
    buf.getChannelData(0).set(audioArray);
    const src = playCtx.createBufferSource();
    const gain = playCtx.createGain();
    gain.gain.value = 4.0;
    src.buffer = buf;
    src.connect(gain).connect(playCtx.destination);
    src.start();
    const dur = audioArray.length / 16000;
    setTimeout(() => {
        setStep('play', 'done');
        recordBtn.className = 'state-ready';
        recordBtn.disabled = false;
        recordBtn.textContent = '🎙 Hold to Speak';
    }, dur * 1000 + 200);
}

// ── Recording Logic (FIXED FOR GESTURE) ──────────────────────────────────────
async function startRecording() {
    if (isRecording) return;

    // MANDATORY: Create/Resume AudioContext within the user gesture event
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!capCtx) capCtx = new (window.AudioContext || window.webkitAudioContext)();
    await playCtx.resume();
    await capCtx.resume();

    isRecording = true;
    recordedChunks = [];
    recStart = Date.now();

    pipelineCard.style.display = 'block';
    setStep('capture', 'active', 'Listening...');
    ['stt', 'translate', 'tts', 'play'].forEach(s => setStep(s, 'idle'));

    recordBtn.className = 'state-recording';
    recordBtn.textContent = '🔴 Release to Translate';

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: false, autoGainControl: false, noiseSuppression: false }
        });

        const source = capCtx.createMediaStreamSource(mediaStream);
        analyser = capCtx.createAnalyser();
        analyser.fftSize = 64;
        const silent = capCtx.createGain();
        silent.gain.value = 0;
        source.connect(analyser);
        source.connect(silent).connect(capCtx.destination);

        micMeter.style.display = 'block';
        drawLevel();

        recTimer = setInterval(() => {
            micDur.textContent = ((Date.now() - recStart) / 1000).toFixed(1) + 's';
        }, 100);

        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.start();

    } catch (err) {
        isRecording = false;
        showError('Mic access denied.');
    }
}

async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    clearInterval(recTimer);
    cancelAnimationFrame(animFrame);
    micMeter.style.display = 'none';
    recordBtn.className = 'state-processing';
    recordBtn.disabled = true;
    recordBtn.textContent = '⚙ Processing...';

    mediaStream?.getTracks().forEach(t => t.stop());

    mediaRecorder.onstop = async () => {
        try {
            if (recordedChunks.length === 0) throw new Error('No audio captured.');

            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
            const arrayBuffer = await blob.arrayBuffer();

            // Safe decoding using a fresh temporary context
            const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
            await decodeCtx.close();

            // Resample to 16kHz for Whisper
            const TARGET_RATE = 16000;
            const offCtx = new OfflineAudioContext(1, decoded.duration * TARGET_RATE, TARGET_RATE);
            const source = offCtx.createBufferSource();
            source.buffer = decoded;
            source.connect(offCtx.destination);
            source.start(0);

            const resampled = await offCtx.startRendering();
            worker.postMessage({ type: 'process_audio', audio: resampled.getChannelData(0) });

        } catch (err) {
            showError('Audio error: ' + err.message);
        }
    };
    mediaRecorder.stop();
}

// ── Bindings ─────────────────────────────────────────────────────────────────
recordBtn.onmousedown = startRecording;
recordBtn.onmouseup = stopRecording;
recordBtn.onmouseleave = () => { if (isRecording) stopRecording(); };
recordBtn.ontouchstart = (e) => { e.preventDefault(); startRecording(); };
recordBtn.ontouchend = (e) => { e.preventDefault(); stopRecording(); };