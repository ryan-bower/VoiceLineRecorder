// Mic capture + lossless WAV encoding. Captures raw Float32 PCM (via
// AudioWorklet, ScriptProcessor fallback) and encodes 24-bit PCM WAV.

export class Recorder {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.sampleRate = 48000;
    this.recording = false;
    this.chunks = [];
    this.useWorklet = false;
  }

  async init(deviceId) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);

    try {
      await this.ctx.audioWorklet.addModule("/recorder-worklet.js");
      this.useWorklet = true;
    } catch {
      this.useWorklet = false;
    }
  }

  getAnalyser() {
    return this.analyser;
  }

  async resume() {
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  start() {
    if (this.recording) return;
    this.chunks = [];
    this.recording = true;

    // A muted sink keeps the capture node in an actively-pulled graph without
    // routing the mic to the speakers (which would cause feedback).
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.ctx.destination);

    if (this.useWorklet) {
      this.node = new AudioWorkletNode(this.ctx, "capture-processor");
      this.node.port.onmessage = (e) => {
        if (this.recording) this.chunks.push(e.data);
      };
      this.source.connect(this.node);
      this.node.connect(this.sink);
    } else {
      this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (e) => {
        if (this.recording) this.chunks.push(e.inputBuffer.getChannelData(0).slice(0));
      };
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
    }
  }

  // Stop and return { blob, durationSec, peakDbfs }.
  stop() {
    this.recording = false;
    if (this.node) {
      this.source.disconnect(this.node);
      this.node.disconnect();
      this.node.port.onmessage = null;
      this.node = null;
    }
    if (this.processor) {
      this.source.disconnect(this.processor);
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.sink) {
      this.sink.disconnect();
      this.sink = null;
    }

    const samples = concat(this.chunks);
    this.chunks = [];
    const peakDbfs = peakToDbfs(samples);
    const blob = encodeWav24(samples, this.sampleRate);
    return { blob, durationSec: samples.length / this.sampleRate, peakDbfs };
  }

  dispose() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
  }
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function peakToDbfs(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0) return -100;
  return Math.round(20 * Math.log10(peak) * 10) / 10;
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// Encode mono Float32 samples to a 24-bit PCM WAV Blob.
function encodeWav24(samples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 3;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    let val = Math.round(s * 8388607); // 2^23 - 1
    if (val < 0) val += 0x1000000; // 24-bit two's complement
    view.setUint8(offset++, val & 0xff);
    view.setUint8(offset++, (val >> 8) & 0xff);
    view.setUint8(offset++, (val >> 16) & 0xff);
  }
  return new Blob([view], { type: "audio/wav" });
}
