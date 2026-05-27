// Live waveform + peak level meter with clip / too-quiet warnings.

const CLIP_DBFS = -1;     // at or above this = clipping risk
const QUIET_DBFS = -24;   // recent peak below this = too quiet (flags whispers)
const FLOOR_DBFS = -60;   // bottom of the meter
const GATE_DBFS = -50;    // below this the bar is pinned to 0 (no idle bobbing)

export class Meter {
  constructor({ canvas, bar, status }) {
    this.canvas = canvas;
    this.bar = bar;
    this.status = status;
    this.ctx2d = canvas.getContext("2d");
    this.running = false;
    this.peakHold = -100;
    this.peakHoldAt = 0;
    this.clippedThisRun = false;
  }

  start(analyser) {
    this.analyser = analyser;
    this.running = true;
    this.clippedThisRun = false;
    this.buf = new Float32Array(analyser.fftSize);
    this._loop();
  }

  stop() {
    this.running = false;
  }

  // Whether clipping was seen since the last start() — useful as a post-take flag.
  clipped() {
    return this.clippedThisRun;
  }

  _loop() {
    if (!this.running) return;
    const a = this.analyser;
    a.getFloatTimeDomainData(this.buf);

    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = Math.abs(this.buf[i]);
      if (v > peak) peak = v;
    }
    const dbfs = peak > 0 ? 20 * Math.log10(peak) : -100;

    const now = performance.now();
    if (dbfs > this.peakHold || now - this.peakHoldAt > 1200) {
      this.peakHold = dbfs;
      this.peakHoldAt = now;
    }
    if (dbfs >= CLIP_DBFS) this.clippedThisRun = true;

    this._drawWave();
    this._drawLevel(dbfs);
    requestAnimationFrame(() => this._loop());
  }

  _drawWave() {
    const { ctx2d: g, canvas: c, buf } = this;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#111722";
    g.fillRect(0, 0, w, h);

    // center line
    g.strokeStyle = "#2a3445";
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();

    g.strokeStyle = "#54d18c";
    g.lineWidth = 2;
    g.beginPath();
    const step = buf.length / w;
    for (let x = 0; x < w; x++) {
      const v = buf[Math.floor(x * step)] || 0;
      const y = h / 2 - v * (h / 2) * 0.95;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  _drawLevel(dbfs) {
    if (!this.bar) return;
    // Bar tracks the instantaneous level for lively movement, but is gated to
    // zero below GATE_DBFS so background noise doesn't make it bob when idle.
    const pct = dbfs < GATE_DBFS
      ? 0
      : Math.max(0, Math.min(100, ((dbfs - FLOOR_DBFS) / (0 - FLOOR_DBFS)) * 100));
    this.bar.style.width = pct + "%";

    // Warnings are judged on the recent peak so they don't flicker on the
    // natural dips between words.
    const level = this.peakHold;
    let color = "#54d18c"; // good
    let msg = `${level > -100 ? level.toFixed(1) : "-∞"} dBFS peak`;
    if (level >= CLIP_DBFS) {
      color = "#e2554e";
      msg = "Clipping! Back off the mic or lower input gain.";
    } else if (level < QUIET_DBFS) {
      color = "#d8a13a";
      msg = "Too quiet — move closer or raise input gain.";
    }
    this.bar.style.background = color;
    if (this.status) this.status.textContent = msg;
  }
}
