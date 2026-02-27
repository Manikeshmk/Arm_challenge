# Local Browser Option (Easiest Method)

If you don't want to install Android Studio or Termux, you can run the entire S2S stack directly inside your Moto Edge's mobile Chrome browser.

This system takes advantage of **WebAssembly (WASM) SIMD** instructions inside V8 javascript engines, mapping floating-point inference algebra securely into your smartphone's Arm NEON CPU registry.

**Absolutely no code executes on your PC and no Cloud is used!**

## Setup steps for Demo Video:

1.  Keep your phone connected to your PC with a USB cable.
2.  Ensure **Developer Options -> USB Debugging** is turned on in your Android settings.
3.  Double click the `start.bat` file from your desktop.
4.  It will run `adb reverse tcp:8000 tcp:8000`, hooking your PC HTTP server securely to your mobile networking loop.
5.  Open **Google Chrome** on your Moto Edge.
6.  Navigate to exactly: `http://localhost:8000`

The UI will automatically download the quantized Speech-to-Text (`whisper`), Translation, and synthetic Acoustic generators straight from Huggingface into your phone's memory index.

Press **Record** and talk, then watch your phone's processor do the rest!
