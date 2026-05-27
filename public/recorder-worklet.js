// AudioWorklet processor: forwards raw mono Float32 PCM frames to the main
// thread for lossless capture. Runs on the audio render thread.
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Copy the 128-sample frame; the underlying buffer is reused otherwise.
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
