#!/bin/bash
# setup.sh
# System Setup Script for Arm-based Speech-to-Speech Translation
# Optimised for Termux on Arm64 devices (e.g. Moto Edge 60 Stylus)

echo "Starting system setup for Arm CPU Optimised Speech-to-Speech Pipeline..."

# 1. Update and install dependencies
pkg update -y
pkg install -y build-essential cmake git python wget curl ffmpeg pulseaudio openblas pip

# 2. Setup Whisper.cpp for STT
echo "Setting up Whisper.cpp..."
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
# Compile whisper.cpp with NEON / OpenBLAS optimizations
GGML_OPENBLAS=1 make -j4

# Download Whisper-tiny.en model (quantised / small enough for mobile)
bash ./models/download-ggml-model.sh tiny.en
cd ..

# 3. Setup Llama.cpp for LLM Translation/Rewriting
echo "Setting up Llama.cpp (with KleidiAI for Arm acceleration)..."
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp
# Compile Llama.cpp utilizing KleidiAI (KAI) and OpenBLAS for Arm NEON
# Recent versions of llama.cpp include KleidiAI integration seamlessly for Arm architectures
CMAKE_ARGS="-DGGML_OPENBLAS=ON -DGGML_CPU_ARM_EXTRA=ON" make -j4

# Download a compact LLM, e.g. Qwen2-1.5B or Gemma-2B quantized to Q4_K_M
mkdir -p models
wget -O models/qwen2-1.5b-instruct-q4_k_m.gguf "https://huggingface.co/Qwen/Qwen1.5-1.8B-Chat-GGUF/resolve/main/qwen1_5-1_8b-chat-q4_k_m.gguf"
cd ..

# 4. Setup Piper for TTS
echo "Setting up Piper TTS..."
pip install piper-tts sounddevice numpy scipy
mkdir -p piper_models
# Download Spanish medium model (as an example for English -> Spanish translation)
wget -O piper_models/es_ES-milan-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/milan/medium/es_ES-milan-medium.onnx"
wget -O piper_models/es_ES-milan-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/milan/medium/es_ES-milan-medium.onnx.json"

echo "Setup Complete! All optimized inference engines and quantized models are downloaded."
