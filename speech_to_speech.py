import os
import time
import subprocess
import argparse

# Paths Setup
WHISPER_PATH = "./whisper.cpp/main"
WHISPER_MODEL = "./whisper.cpp/models/ggml-tiny.en.bin"
LLAMA_PATH = "./llama.cpp/llama-cli"
LLAMA_MODEL = "./llama.cpp/models/qwen2-1.5b-instruct-q4_k_m.gguf"
PIPER_MODEL = "./piper_models/es_ES-milan-medium.onnx"

RECORD_DURATION = 5  # seconds for continuous listening loop
AUDIO_INPUT = "input.wav"
AUDIO_OUTPUT = "output.wav"

def record_audio_termux(duration=5, output_file="input.wav"):
    """
    Records audio using Termux API, tailored for Arm Android devices.
    It writes a temporary audio file which whisper.cpp will read.
    """
    print(f"\n[🎤] Recording {duration} seconds of audio...", flush=True)
    # Remove old recording if exists
    if os.path.exists(output_file):
        os.remove(output_file)
        
    subprocess.run([
        "termux-microphone-record", "-d", str(duration), "-f", output_file
    ], check=True)
    
    # Wait for recording
    time.sleep(duration + 0.5)

def stt_whisper(input_file):
    """
    Runs speech-to-text on the device CPU using Whisper.cpp (NEON optimized).
    """
    print("[🗣️] Running STT (Whisper.cpp) on Arm CPU...", flush=True)
    # Whisper.cpp requires 16kHz WAV file. Assuming input from termux is compatible,
    # otherwise an ffmpeg conversion might be needed. 
    # For robust mobile handling we add ffmpeg to convert it to 16kHz
    subprocess.run([
        "ffmpeg", "-y", "-i", input_file, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "input_16k.wav"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # Run Whisper.cpp command line inference
    result = subprocess.run([
        WHISPER_PATH, "-m", WHISPER_MODEL, "-f", "input_16k.wav", "-nt" # -nt means no timestamps
    ], capture_output=True, text=True)
    
    # Clean the whisper output text
    text = result.stdout.strip()
    return text

def llm_translate(text, target_language="Spanish"):
    """
    Translates or rewrites STT output via Local LLM via llama.cpp.
    Leverages Arm KleidiAI optimizations compiled into llama.cpp.
    """
    if not text or len(text.strip()) < 2:
        return ""
    
    print(f"[🧠] Transcribed Text: {text}")
    print("[🤖] Translating via Local LLM...", flush=True)

    # Building a compact system prompt for Qwen/Phi
    prompt = f"Translate the following English text to {target_language}. Produce only the translation, no extra text.\n\nEnglish: {text}\n{target_language}:"
    
    # llama-cli interface: using optimized -n (tokens), -c (context)
    result = subprocess.run([
        LLAMA_PATH,
        "-m", LLAMA_MODEL,
        "-n", "64", 
        "-c", "256", 
        "--temp", "0.1",
        "-p", prompt
    ], capture_output=True, text=True)
    
    # Very basic parsing output after the prompt
    out_text = result.stdout
    if target_language + ":" in out_text:
        translation = out_text.split(target_language + ":")[-1].strip()
    else:
        translation = out_text.strip()
        
    return translation

def tts_piper(text, output_file):
    """
    Synthesizes speech using Piper TTS directly on Arm CPU.
    """
    if not text:
        return
        
    print(f"[🗣️] Translated Text: {text}")
    print("[🔊] Synthesizing speech natively via Piper...", flush=True)
    
    # Pipe text to piper
    process = subprocess.Popen([
        "piper", "--model", PIPER_MODEL, "--output_file", output_file
    ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    process.communicate(input=text.encode('utf-8'))

def play_audio_termux(audio_file):
    """
    Plays the TTS audio back through Android speakers over Termux.
    """
    print("[▶️] Playing translation...", flush=True)
    subprocess.run(["termux-media-player", "play", audio_file], check=True)
    
def main_loop():
    print("==================================================")
    print("🎙️ On-Device Local Speech-to-Speech Initialized🎙️")
    print("==================================================")
    print("Target Device: Arm Cortex-A (Moto Edge 60 Stylus / NEON / KleidiAI)")
    
    while True:
        try:
            record_audio_termux(duration=RECORD_DURATION, output_file=AUDIO_INPUT)
            
            transcript = stt_whisper(AUDIO_INPUT)
            if not transcript or "[BLANK_AUDIO]" in transcript:
                print("-> No speech detected.")
                continue
                
            translation = llm_translate(transcript, "Spanish")
            
            if translation:
                tts_piper(translation, AUDIO_OUTPUT)
                play_audio_termux(AUDIO_OUTPUT)
                # Wait for audio to finish playing (assuming roughly 2-3 sec)
                time.sleep(3)
                
        except KeyboardInterrupt:
            print("\n[Shutting down on-device inference.]")
            break
        except Exception as e:
            print(f"Error in pipeline: {e}")
            break

if __name__ == "__main__":
    main_loop()
