// ── DOM Refs ─────────────────────────────────────────────────────────────────
const loadingPanel = document.getElementById('loadingPanel');
const progressBar = document.getElementById('progressBar');
const loadPct = document.getElementById('loadPct');
const etaText = document.getElementById('etaText');
const statusBox = document.getElementById('statusBox');
const transcriptText = document.getElementById('transcriptText');
const translationText = document.getElementById('translationText');
const recordBtn = document.getElementById('recordBtn');

// ── Loading State ─────────────────────────────────────────────────────────────
// Weights: whisper=~40 MB, marian=~75 MB, tts=~150 MB → total ~265 MB
const MODEL_WEIGHTS = { whisper: 40, marian: 75, tts: 150 };
const TOTAL_MB = Object.values(MODEL_WEIGHTS).reduce((a, b) => a + b, 0);

// currentPct[model] = 0..100
const currentPct = { whisper: 0, marian: 0, tts: 0 };
// which model is active
let activeModel = null;
let loadStart = Date.now();

function updateOverallProgress() {
    // Weighted average of each model's progress contribution
    const done = Object.entries(currentPct).reduce((acc, [k, p]) => {
        return acc + (p / 100) * MODEL_WEIGHTS[k];
    }, 0);
    const overall = Math.round((done / TOTAL_MB) * 100);
    progressBar.style.width = overall + '%';
    loadPct.textContent = overall + '%';

    // ETA estimate
    const elapsed = (Date.now() - loadStart) / 1000; // seconds
    if (elapsed > 3 && overall > 2) {
        const totalEstSec = (elapsed / overall) * 100;
        const remaining = Math.round(totalEstSec - elapsed);
        if (remaining > 0) {
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const etaStr = mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`;
            etaText.textContent = `Downloading models… ${etaStr}`;
        } else {
            etaText.textContent = 'Almost done — finalizing…';
        }
    }
}

function setStepState(model, state) {
    // state: 'pending' | 'active' | 'done'
    const row = document.getElementById(`step-${model}`);
    if (!row) return;

    // Clear classes
    row.classList.remove('active', 'done');

    // Remove old spinner/check/dot
    const old = row.querySelector('.step-spin, .step-check, .step-dot');
    if (old) old.remove();

    if (state === 'active') {
        row.classList.add('active');
        const spin = document.createElement('span');
        spin.className = 'step-spin';
        row.appendChild(spin);
    } else if (state === 'done') {
        row.classList.add('done');
        const check = document.createElement('span');
        check.className = 'step-check';
        check.textContent = '✓';
        row.appendChild(check);
    } else {
        // pending
        const dot = document.createElement('span');
        dot.className = 'step-dot';
        row.appendChild(dot);
    }
}

// ── Audio State ───────────────────────────────────────────────────────────────
let audioContext;
let mediaStream;
let processor;
let audioSegments = [];
let isRecording = false;

// ── Worker ────────────────────────────────────────────────────────────────────
const worker = new Worker('worker.js');

worker.addEventListener('message', event => {
    const data = event.data;

    // ── Loading Phase Events ──────────────────────────────────────────────────
    if (data.status === 'load_start') {
        activeModel = data.model;
        setStepState(data.model, 'active');
        const names = { whisper: 'Whisper STT', marian: 'MarianMT Translator', tts: 'SpeechT5 TTS' };
        etaText.textContent = `Loading ${names[data.model] || data.model}…`;

    } else if (data.status === 'model_progress') {
        currentPct[data.model] = data.pct;
        updateOverallProgress();

    } else if (data.status === 'model_done') {
        currentPct[data.model] = 100;
        setStepState(data.model, 'done');
        updateOverallProgress();

    } else if (data.status === 'init_done') {
        // All 3 models ready
        currentPct.whisper = 100;
        currentPct.marian = 100;
        currentPct.tts = 100;
        progressBar.style.width = '100%';
        loadPct.textContent = '100%';
        setStepState('whisper', 'done');
        setStepState('marian', 'done');
        setStepState('tts', 'done');
        etaText.textContent = '✅ All models cached — works offline now!';

        // Transition UI after a short pause
        setTimeout(() => {
            loadingPanel.style.display = 'none';
            statusBox.style.display = 'flex';
            statusBox.className = 'ready';
            statusBox.textContent = '✅ Ready! Hold to Speak.';
            recordBtn.disabled = false;
            recordBtn.textContent = '🎙 Hold to Speak';
        }, 800);

        // ── Inference Phase Events ────────────────────────────────────────────────
    } else if (data.status === 'transcribing') {
        setStatus('busy', '🎙 Processing speech on Arm CPU…');
        transcriptText.textContent = 'Analysing audio…';
        transcriptText.style.color = '#ffc107';

    } else if (data.status === 'transcribed') {
        transcriptText.textContent = data.text;
        transcriptText.style.color = '#fff';

    } else if (data.status === 'translating') {
        setStatus('busy', '🌐 Running NMT translation…');
        translationText.textContent = 'Generating translation…';
        translationText.style.color = '#ffc107';

    } else if (data.status === 'translated') {
        translationText.textContent = data.text;
        translationText.style.color = '#fff';

    } else if (data.status === 'synthesizing') {
        setStatus('busy', '🔊 Running TTS vocoder…');

    } else if (data.status === 'audio_ready') {
        setStatus('ready', '✅ Ready! Hold to Speak.');
        recordBtn.disabled = false;
        recordBtn.textContent = '🎙 Hold to Speak';

        const buf = audioContext.createBuffer(1, data.audio.length, 16000);
        buf.getChannelData(0).set(data.audio);
        const src = audioContext.createBufferSource();
        src.buffer = buf;
        src.connect(audioContext.destination);
        src.start();

    } else if (data.status === 'error') {
        // Show error in both panels
        etaText.textContent = '❌ ' + data.message;
        setStatus('error', '❌ ' + data.message);
        recordBtn.disabled = false;
        recordBtn.textContent = '🎙 Hold to Speak';
    }
});

function setStatus(cls, msg) {
    statusBox.className = cls;
    statusBox.textContent = msg;
}

// ── Recording ─────────────────────────────────────────────────────────────────
const startRecording = async () => {
    if (isRecording) return;
    isRecording = true;
    audioSegments = [];

    recordBtn.classList.add('pulse');
    recordBtn.textContent = '🔴 Listening…';
    transcriptText.textContent = 'Listening to microphone…';
    transcriptText.style.color = '#aab0c0';
    translationText.textContent = 'Waiting for pipeline…';
    translationText.style.color = '#aab0c0';

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });

        const source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            audioSegments.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
    } catch (e) {
        alert('Microphone permission denied or unsupported in this browser.');
        isRecording = false;
        recordBtn.classList.remove('pulse');
        recordBtn.textContent = '🎙 Hold to Speak';
    }
};

const stopRecording = () => {
    if (!isRecording) return;
    isRecording = false;

    recordBtn.classList.remove('pulse');
    recordBtn.textContent = 'Processing…';
    recordBtn.disabled = true;

    processor.disconnect();
    mediaStream.getTracks().forEach(t => t.stop());

    // Flatten all captured PCM chunks
    const totalLen = audioSegments.reduce((a, b) => a + b.length, 0);
    const flat = new Float32Array(totalLen);
    let offset = 0;
    for (const seg of audioSegments) { flat.set(seg, offset); offset += seg.length; }

    worker.postMessage({ type: 'process_audio', audio: flat });
};

// ── Input Bindings ────────────────────────────────────────────────────────────
recordBtn.addEventListener('mousedown', startRecording);
recordBtn.addEventListener('mouseup', stopRecording);
recordBtn.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });
recordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
