# Architecture and Key Optimizations

This document explains the choices for implementing an energy-efficient, real-time, completely local speech-to-speech translation engine for Arm-based consumer electronics, without falling back onto an onboard NPU or cloud services. This fits specifically to edge-deployed processors like the Snapdragon 7s Gen 2 seen in devices such as the Moto Edge 60 Stylus.

## System Architecture

The pipeline consists of three separate C/C++ driven frameworks glued together with a Python execution layer handling file I/O over the Android kernel (Termux):
1. **Audio Recording (ALSA / Termux API):** Records 5-second PCM samples iteratively.
2. **Speech-to-Text inference (Whisper.cpp):** Decodes raw PCM wav formats to extracted contextual text tokens.
3. **Local LLM Rewriting (llama.cpp):** Acts as the logical component. Depending on the system prompt, it takes text from Whisper to translate, semantically rewrite, or grammatically correct into the target language.
4. **Text-to-Speech Generation (Piper):** Takes the LLM output buffer, utilizing optimized ONNX algorithms directly natively on the Linux wrapper to output voice formats. Output relies on `termux-media-player` pushing audio signals out the Android speakers.

---

## Technical Specifications and Models

### 1. Whisper-tiny.en (STT) 
**Why this model?** 
Real-time constraint. STT demands sub-1-second latency or speech overlap occurs. The `ggml-tiny.en.bin` has a very small parameter count (~39M) and quantizes down to ~40MB disk space, ensuring inference is almost unnoticeable on Arm CPUs without throttling or ramping thermal profiles uncomfortably.
**Optimizations:** It runs flawlessly under basic **NEON/OpenBLAS** flags. 

### 2. Qwen1.5-1.8B-Chat-GGUF (LLM)
**Why this model?**
The 1-2B parameter size hits the "Goldilocks zone" for mobile conversational logic (translation and rewriting). We specifically target the `Q4_K_M` (4-bit) quantization via GGUF format format so memory bandwidth usage remains incredibly lightweight—usually constrained below 1.5GB of actual RAM. 
**Optimizations:** To meet latency specifications on mobile CPUs like in the Moto Edge smartphone series without SME2, compiling `llama.cpp` using the newly developed **KleidiAI (KAI)** allows the inference engine to utilize deep micro-kernels designed by Arm. KAI dynamically selects the most performant instructions based strictly on CPU architecture runtime capabilities, offering substantial acceleration (up to 4x cost-performance compared to vanilla C code) for Small Language Models inherently on device without relying on special NPU dependencies.

If the pipeline was moved to devices supporting CPU architectures with SME2 (Scalable Matrix Extension), `llama.cpp` natively embraces the hardware feature allowing vector math to be vastly accelerated resulting in instantaneous text delivery.

### 3. Piper (TTS)
**Why this model?**
Piper utilizes incredibly fast neural acoustic modeling (FastSpeech2) plus a lightweight HiFi-GAN vocoder. It handles non-English synthesis significantly better than VITS on very weak device cores.
**Optimizations:** The underlying ONNX runner inherently maps to ARMv8 NEON extensions allowing real-time character-to-spectrogram conversions without large energy footprints.

---

## Quantization Methodologies
The key enabler in this project is **Quantization**:
- Models execute entirely in Integer 4-bit/8-bit space via block-wise quantizing strategies ensuring minimal accuracy loss per neuron layer. For example, using `Q4_K_M`, both weights and matrices align perfectly with 128-bit NEON registers allowing cache lines on an Arm A55/A78 core to hold roughly four times as much data per instruction cycle reducing cache misses inherently resulting in battery life savings and speedups.
