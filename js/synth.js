// synth.js — a small built-in Web Audio synth so you can hear the four parts
// without patching the modular. Each part gets a distinct voice. The scheduler
// drives this exactly like the MIDI output, so what you hear == what you send.

// Per-part voice design. cutoff() is a function of the note frequency so timbre
// tracks pitch a little.
const VOICES = {
  // pad: warm sustained drone (still one pitch — the detuned oscs are unison).
  pad:    { type: 'sawtooth', detunes: [-7, 0, 7], sub: false, cutoff: (f) => Math.min(4500, f * 4 + 400), q: 0.6, gain: 0.14, a: 0.5,  d: 0.5,  s: 0.85, r: 1.4 },
  // bass: punchy with a sub octave.
  bass:   { type: 'sawtooth', detunes: [0],        sub: true,  cutoff: (f) => Math.min(1800, f * 6 + 180), q: 3.0, gain: 0.55, a: 0.004, d: 0.12, s: 0.7,  r: 0.12 },
  // arpeggiator: short, bright pluck.
  melody: { type: 'triangle', detunes: [0],        sub: false, cutoff: (f) => Math.min(7000, f * 6 + 600), q: 1.4, gain: 0.24, a: 0.003, d: 0.11, s: 0.22, r: 0.12 },
  // lead melody: singing, slightly detuned saw.
  alt:    { type: 'sawtooth', detunes: [-4, 4],    sub: false, cutoff: (f) => Math.min(6200, f * 4 + 700), q: 1.1, gain: 0.24, a: 0.02,  d: 0.2,  s: 0.7,  r: 0.3 },
};

export class Synth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.vol = 0.8;
    this.voices = new Set();
  }

  // Created lazily on first Start (audio needs a user gesture to begin).
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor(); // soft master glue / clip guard
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
  }

  resume() {
    this.ensure();
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // Convert a performance.now() ms timestamp into AudioContext seconds.
  atime(perfMs) {
    return this.ctx.currentTime + (perfMs - performance.now()) / 1000;
  }

  // Schedule one complete note (attack at onPerf, release at offPerf).
  playNote(part, midiNote, vel, onPerf, offPerf) {
    if (!this.ctx) return;
    const spec = VOICES[part] || VOICES.melody;
    const t0 = Math.max(this.ctx.currentTime, this.atime(onPerf));
    const t1 = Math.max(t0 + 0.03, this.atime(offPerf));
    const dur = t1 - t0;
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const peak = (vel / 127) * spec.gain;

    const g = this.ctx.createGain();
    g.connect(this.master);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = spec.cutoff(freq);
    filt.Q.value = spec.q;
    filt.connect(g);

    const oscs = [];
    for (const det of spec.detunes) {
      const o = this.ctx.createOscillator();
      o.type = spec.type; o.frequency.value = freq; o.detune.value = det;
      o.connect(filt); oscs.push(o);
    }
    if (spec.sub) {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq / 2; o.connect(filt); oscs.push(o);
    }

    // ADSR, clamped so very short notes still articulate cleanly.
    const aE = Math.min(spec.a, dur * 0.5);
    const dE = Math.min(spec.d, Math.max(0, dur - aE) * 0.7);
    const sus = Math.max(peak * spec.s, 0.0001);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + aE);
    g.gain.linearRampToValueAtTime(sus, t0 + aE + dE);
    g.gain.setTargetAtTime(0.0001, t1, Math.max(0.01, spec.r / 3));

    const stopAt = t1 + spec.r + 0.05;
    for (const o of oscs) { o.start(t0); o.stop(stopAt); }

    const voice = { oscs, g };
    this.voices.add(voice);
    oscs[oscs.length - 1].onended = () => {
      try { g.disconnect(); } catch (e) { /* already gone */ }
      this.voices.delete(voice);
    };
  }

  panic() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(0.0001, now, 0.02);
        for (const o of v.oscs) o.stop(now + 0.1);
      } catch (e) { /* ignore */ }
    }
    this.voices.clear();
  }
}
