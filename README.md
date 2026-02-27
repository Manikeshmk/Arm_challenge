# Arm-Based Real-Time Speech-to-Speech Translation Pipeline

This repository contains an on-device, fully local speech-to-speech translation system optimized for Arm-based CPUs. Specifically, it enables a user to record spoken audio on their device, translate it using a compressed LLM and optimized CPU inference kernels, and synthesize it as fluently spoken output—all without any cloud dependency.

## Target Device
**Moto Edge 60 Stylus** (or similar devices featuring an Arm v8 / v9 CPU). This device is presumed to feature a Snapdragon 7s Gen 2 SoC which supports **NEON** instructions and can be substantially accelerated leveraging **KleidiAI** routines within `llama.cpp` for enhanced inference performance. Although SME2 (Scalable Matrix Extension) is highly preferred for newer generation setups (such as the Cortex-X4/X925 like the vivo X300), the project's software layers elegantly adapt to base NEON instructions to ensure high-performance CPU inference without an NPU.

## System Pipeline Components
1. **Speech-to-Text (STT):** `whisper.cpp` using `ggml-tiny.en.bin` (Approx. 39MB), optimized dynamically by OpenBLAS and NEON kernels.
2. **Translation & Rewriting (LLM):** `llama.cpp` running `Qwen1.5-1.8B-Chat-GGUF` (quantization: Q4_K_M). Thanks to recent implementations of **KleidiAI (KAI)** within the ggml backend, local LLM evaluation has remarkable speedups for mobile CPUs.
3. **Text-to-Speech (TTS):** `piper` utilizing `es_ES-milan-medium.onnx` acoustic model for blazing-fast, low-latency, and high-fidelity text synthesis directly on the Arm SOC.

## 🚀 How to Run on Termux (Android)

### Prerequisites
1. Install **Termux** from F-Droid (do not use Google Play setup).
2. Install **Termux:API** from F-Droid.
3. Grant Termux microphone and storage permissions in your Android settings.

### Setup Instructions
1. Clone this repository inside Termux:
    ```bash
    git clone https://github.com/your-repo/arm-s2s.git
    cd arm-s2s
    ```
2. Run the `setup.sh` script to pull dependencies, compile C++ tools with NEON optimizations, and download models:
    ```bash
    chmod +x setup.sh
    ./setup.sh
    ```
3. Run the Python pipeline:
    ```bash
    python speech_to_speech.py
    ```

**Note:** The system continuously listens taking 5-second audio chunks via `termux-microphone-record`, transcribes it, uses the LLM to rewrite/translate it into Spanish, and outputs synthesized speech natively over the smartphone's speakers.

## Documentation
- [Architecture & Optimization Choices](docs/architecture_and_models.md)
- [Performance & Thermal Evaluation](docs/performance_evaluation.md)
