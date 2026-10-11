// Bounded WSOLA overlap-add. No resampling: samples within each grain retain pitch.
(function (root) {
  "use strict";
  class StretchDSP {
    constructor(channels, rate = 1, loop = false) {
      if (
        !Array.isArray(channels) ||
        !channels.length ||
        channels.length > 8 ||
        !channels[0]?.length ||
        channels.some(
          (c) =>
            !(c instanceof Float32Array) || c.length !== channels[0].length,
        )
      )
        throw Error("Invalid PCM channels");
      this.channels = channels;
      this.length = channels[0].length;
      this.loop = loop;
      this.window = 2048;
      this.hop = 512;
      this.search = 128;
      this.capacity = 8192;
      this.ring = channels.map(() => new Float32Array(this.capacity));
      this.weights = new Float32Array(this.capacity);
      this.out = 0;
      this.synthesis = 0;
      this.analysis = 0;
      this.ended = false;
      this.setRate(rate);
      this.hann = Float32Array.from(
        { length: this.window },
        (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.window - 1)),
      );
    }
    setRate(rate) {
      if (!Number.isFinite(rate) || rate < 0.5 || rate > 2)
        throw Error("Pitch preserving rate supports 0.5..2");
      this.rate = rate;
    }
    read(channel, index) {
      if (this.loop)
        index = ((index % this.length) + this.length) % this.length;
      return index >= 0 && index < this.length
        ? this.channels[channel][index]
        : 0;
    }
    grain() {
      let start = Math.floor(this.analysis);
      if (this.synthesis > 0) {
        let best = -Infinity,
          bestDistance = Infinity,
          bestStart = start;
        for (
          let candidate = start - this.search;
          candidate <= start + this.search;
          candidate += 4
        ) {
          if (!this.loop && (candidate < 0 || candidate >= this.length))
            continue;
          let cross = 0,
            a2 = 0,
            b2 = 0;
          for (let k = 0; k < 256; k += 8) {
            const index = (this.synthesis + k) % this.capacity,
              weight = this.weights[index],
              a = weight > 1e-6 ? this.ring[0][index] / weight : 0,
              b = this.read(0, candidate + k);
            cross += a * b;
            a2 += a * a;
            b2 += b * b;
          }
          const score = cross / Math.sqrt(a2 * b2 + 1e-12),
            distance = Math.abs(candidate - start);
          if (
            score > best + 1e-6 ||
            (Math.abs(score - best) <= 1e-6 && distance < bestDistance)
          ) {
            best = score;
            bestDistance = distance;
            bestStart = candidate;
          }
        }
        start = bestStart;
      }
      for (let k = 0; k < this.window; k++) {
        const index = (this.synthesis + k) % this.capacity,
          weight = this.hann[k];
        this.weights[index] += weight;
        for (let c = 0; c < this.channels.length; c++)
          this.ring[c][index] += this.read(c, start + k) * weight;
      }
      this.synthesis += this.hop;
      this.analysis += this.hop * this.rate;
    }
    process(outputs) {
      const count = outputs[0].length;
      if (this.ended) {
        for (const c of outputs) c.fill(0);
        return false;
      }
      while (this.synthesis < this.out + count) {
        if (!this.loop && this.analysis >= this.length) break;
        this.grain();
      }
      for (let k = 0; k < count; k++) {
        const index = (this.out + k) % this.capacity,
          weight = this.weights[index];
        for (let c = 0; c < outputs.length; c++)
          outputs[c][k] =
            weight > 1e-6
              ? this.ring[Math.min(c, this.ring.length - 1)][index] / weight
              : 0;
        for (const r of this.ring) r[index] = 0;
        this.weights[index] = 0;
      }
      this.out += count;
      this.ended =
        !this.loop &&
        this.analysis >= this.length &&
        this.out >= this.synthesis - this.hop + this.window;
      return !this.ended;
    }
  }
  function processor(Base) {
    return class extends Base {
      constructor() {
        super();
        this.dsp = null;
        this.paused = false;
        this.dead = false;
        this.frames = 0;
        this.port.onmessage = (e) => {
          const m = e.data;
          try {
            if (m.type === "load")
              this.dsp = new StretchDSP(m.channels, m.rate, m.loop);
            if (m.type === "rate") this.dsp?.setRate(m.rate);
            if (m.type === "pause") this.paused = !!m.value;
            if (m.type === "stop") {
              this.dsp = null;
              this.dead = true;
              this.port.close();
            }
          } catch (error) {
            this.port.postMessage({ type: "error", message: String(error) });
            this.dead = true;
          }
        };
      }
      process(inputs, outputs) {
        if (this.dead) return false;
        if (!this.dsp || this.paused) {
          for (const c of outputs[0] || []) c.fill(0);
          return true;
        }
        const active = this.dsp.process(outputs[0]);
        if (this.frames++ % 32 === 0)
          this.port.postMessage({
            type: "progress",
            samples: this.dsp.analysis,
          });
        if (!active) {
          this.port.postMessage({ type: "ended" });
          this.dsp = null;
          this.dead = true;
        }
        return active;
      }
    };
  }
  root.ArkGlideStretch = {
    StretchDSP,
    workletSource:
      StretchDSP.toString() +
      "\nconst createProcessor=" +
      processor.toString() +
      ';registerProcessor("arkglide-stretch",createProcessor(AudioWorkletProcessor));',
  };
})(globalThis);
