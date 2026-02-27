# Native Android Application Guide (S2S Sideloading)

If you wish to bypass Termux and build a standard standalone Android `.apk` that runs the local Speech-to-Speech (S2S) translation pipeline, you will need to utilize **Android NDK (Native Development Kit)** along with **JNI (Java Native Interface)** to bind the C++ AI engines (`whisper.cpp` and `llama.cpp`) to a Kotlin frontend.

This requires building the application on a desktop computer using **Android Studio** and then sideloading the generated APK to your Moto Edge 60 Stylus.

## Architecture of a Native S2S Android App

1.  **Frontend (Kotlin / Jetpack Compose):** Handles the UI, microphone permissions, audio recording visualization, and displaying the transcription/translation.
2.  **JNI Bridge (C++):** A middle-layer that allows Kotlin code to talk directly to the compiled engine binaries.
3.  **Core Engines (C++ with NDK):**
    *   `whisper.cpp`: Compiled using CMake via NDK for ABI `arm64-v8a`.
    *   `llama.cpp`: Compiled identically, leveraging `GGML_CPU_ARM_EXTRA=ON` (KleidiAI) and NEON instructions for maximum performance on your Snapdragon 7s Gen 2.
4.  **TTS Engine:** While you can compile Piper via NDK, many standalone Android S2S apps opt to use the native Android TTS engine (`TextToSpeech` API) offline for the final voice output, as it is zero-overhead and already bundled into the OS.

---

## 🛠️ Step-by-Step Build Process

### Step 1: Set up the Desktop Environment
1.  Download and install [Android Studio](https://developer.android.com/studio).
2.  Open Android Studio and install the **NDK (Side by side)** and **CMake** via the SDK Manager (`Tools > SDK Manager > SDK Tools`).

### Step 2: Utilize an Open-Source Foundation
Writing JNI bindings for both Whisper and Llama from scratch is highly complex. The fastest way to build your demo is to fork an existing template that has already solved the Android NDK bindings for these specific engines.

**Recommended GitHub Template Projects:**
*   **`whisper.cpp` Official Android Example:** The Whisper repository has an `examples/whisper.android` directory. It is a fantastic starting point for the STT portion.
*   **`llama.cpp` Official Android Example:** Similarly, `examples/llama.android` exists for the LLM portion.
*   **Llamatik:** A newer Multiplatform library that wraps both `whisper` and `llama` cleanly.

### Step 3: Integrating the Pipeline (High-Level Overview)

To build the full S2S loop in a single app:

1.  **Clone a base:** Start with the `whisper.android` example.
2.  **Add Llama:** Pull the `llama.cpp` source code into the `app/src/main/cpp` directory of the Android project.
3.  **Update CMakeLists.txt:** You must configure the Android `CMakeLists.txt` to compile both libraries simultaneously. Critical flags for your Moto Edge:
    ```cmake
    set(DEFAULT_C_CPP_FLAGS "-O3 -DNDEBUG")
    set(DEFAULT_C_CPP_FLAGS "${DEFAULT_C_CPP_FLAGS} -march=armv8-a+dotprod") # Optimize for modern Arm
    ```
4.  **Kotlin Logic:** In your `MainActivity.kt`, chain the events:
    *   Record audio memory buffer.
    *   Pass buffer to `whisperJNI.transcribe()`.
    *   Pass resulting string to `llamaJNI.generate("Translate to Spanish: " + transcript)`.
    *   Pass generated translated text to Android's built-in `TextToSpeech` Android library.

### Step 4: Model Packaging (Crucial for Mobile)
You cannot bundle a 1.5GB LLM directly inside the `.apk` file (Android has size limits). You must code the app to either:
1.  Download the `.gguf` (Llama) and `.bin` (Whisper) models via Wi-Fi into the Android app's private `filesDir` upon first launch.
2.  Have the user manually copy the models into their phone's `Documents` folder and use the Android Storage Access Framework (File Picker) inside your app to target them.

### Step 5: Build and Sideload
1.  In Android Studio, click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
2.  Connect your Moto Edge 60 Stylus to your computer.
3.  Enable **Developer Options** and **USB Debugging** on the phone.
4.  Transfer the `app-debug.apk` to your phone and install it (Sideloading).

---

## Alternative: Sideloading Pre-built S2S Apps
If you only need to demonstrate the *capability* of S2S on an Arm CPU for the challenge and do not necessarily need to write the UI yourself, there are open-source APKs you can compile or download directly from GitHub releases that house `llama.cpp` and `whisper.cpp` logic.

### 1. `talk-llama` (Official Example)
Found in the `whisper.cpp` repository, `talk-llama` is a conceptual example of chaining STT -> LLM -> TTS. While primarily a desktop C++ app, community forks have mapped this logic into basic Android wrappers.

### 2. Chatbot UIs with Voice
Apps like **ChatterUI** allow loading GGUF models and support voice input. While not a perfectly seamless back-to-back translator pipeline, it demonstrates the core technologies running on an Arm SoC natively.

**To present to your professor:**
Compiling the Android Studio `.apk` using the NDK bindings and running it locally is the most professional way to complete the challenge without relying on a terminal emulator. It cleanly demonstrates the integration of edge inference libraries directly into a consumer operating system.
