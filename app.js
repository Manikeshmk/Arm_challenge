const statusMessage = document.getElementById('statusMessage');
const transcriptText = document.getElementById('transcriptText');
const translationText = document.getElementById('translationText');
const recordBtn = document.getElementById('recordBtn');

// Audio Context Setup
let audioContext;
let mediaStream;
let processor;
let audioSegments = [];
let isRecording = false;

// Create Web Worker for AI Inference
const worker = new Worker('worker.js');

worker.addEventListener('message', event => {
    const data = event.data;

    if (data.status === 'init_done') {
        statusMessage.textContent = "Pipeline Ready! Tap & Hold to Speak.";
        statusMessage.style.backgroundColor = "#28a745";
        recordBtn.disabled = false;

    } else if (data.status === 'transcribing') {
        transcriptText.textContent = "Processing Audio on Arm CPU...";
        transcriptText.style.color = "#ffdd57";

    } else if (data.status === 'transcribed') {
        transcriptText.textContent = data.text;
        transcriptText.style.color = "#fff";

    } else if (data.status === 'translating') {
        translationText.textContent = "Generating Translation (LLM/NMT)...";
        translationText.style.color = "#ffdd57";

    } else if (data.status === 'translated') {
        translationText.textContent = data.text;
        translationText.style.color = "#fff";

    } else if (data.status === 'synthesizing') {
        statusMessage.textContent = "Running Acoustic Vocoder (TTS)...";
        statusMessage.style.backgroundColor = "#ffc107";
        statusMessage.style.color = "#000";

    } else if (data.status === 'audio_ready') {
        statusMessage.textContent = "Pipeline Ready! Tap & Hold to Speak.";
        statusMessage.style.backgroundColor = "#28a745";
        statusMessage.style.color = "#fff";

        // Play the synthesized audio buffer out of the mobile speaker
        const audioBuffer = audioContext.createBuffer(1, data.audio.length, 16000);
        audioBuffer.getChannelData(0).set(data.audio);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start();

    } else if (data.status === 'error') {
        statusMessage.textContent = "Error: " + data.message;
        statusMessage.style.backgroundColor = "#dc3545";
    }
});

// UI Event Handlers
const startRecording = async () => {
    if (isRecording) return;
    isRecording = true;
    audioSegments = [];

    // UI Updates
    recordBtn.classList.add('pulse');
    recordBtn.textContent = "Listening...";
    transcriptText.textContent = "Listening to microphone...";
    translationText.textContent = "Waiting for pipeline...";

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });

        const source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            audioSegments.push(new Float32Array(inputData));
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
    } catch (e) {
        alert("Microphone permission denied or unsupported in this browser.");
        isRecording = false;
        recordBtn.classList.remove('pulse');
        recordBtn.textContent = "Hold to Speak";
    }
};

const stopRecording = () => {
    if (!isRecording) return;
    isRecording = false;

    recordBtn.classList.remove('pulse');
    recordBtn.textContent = "Processing Inference...";
    recordBtn.disabled = true;

    // Disconnect Media
    processor.disconnect();
    mediaStream.getTracks().forEach(track => track.stop());

    // Flatten Audio
    const totalLength = audioSegments.reduce((acc, val) => acc + val.length, 0);
    const audioFloat32 = new Float32Array(totalLength);
    let offset = 0;
    for (let segment of audioSegments) {
        audioFloat32.set(segment, offset);
        offset += segment.length;
    }

    // Send the raw PCM format to the background thread (Transformers.js)
    worker.postMessage({ type: 'process_audio', audio: audioFloat32 });
};

// Bind Mobile Tap Events
recordBtn.addEventListener('mousedown', startRecording);
recordBtn.addEventListener('mouseup', stopRecording);
recordBtn.addEventListener('mouseleave', () => { if (isRecording) stopRecording(); });
recordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
