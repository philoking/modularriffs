// scheduler.js — transport + lookahead scheduler.
//
// Classic "tale of two clocks" design: a coarse timer (in a Worker so it isn't
// throttled in background tabs) wakes us ~every 25 ms; we then schedule every
// musical event whose time falls inside a short lookahead window, stamping each
// with an absolute performance.now() time so the MIDI layer fires it precisely.
//
// Time is advanced incrementally (one step / one clock pulse at a time) using the
// *current* BPM, so tempo changes take effect smoothly within one lookahead.

import { STEPS_PER_BAR } from './generator.js';

const LOOKAHEAD_MS = 140;   // how far ahead we schedule
const TICK_MS = 25;         // how often the timer wakes us
const CLOCKS_PER_BAR = 24 * 4; // 24 PPQN × 4 quarter notes (4/4)

// Inline Worker that just posts a steady "tick". Kept as a Blob so the app stays
// buildless and self-contained.
function makeTimerWorker() {
  const src = `let id=null; onmessage=(e)=>{ if(e.data==='start'){ id=setInterval(()=>postMessage(0), ${TICK_MS}); } else if(e.data==='stop'){ clearInterval(id); id=null; } };`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
}

export class Transport {
  constructor(midi, synth, generator, state, callbacks = {}) {
    this.midi = midi;
    this.synth = synth;
    this.gen = generator;
    this.state = state;
    this.cb = callbacks; // { onBar, onStep, ensureBar, applyPending(bar) }
    this.running = false;
    this.pendingJump = null; // an armed "jump here next" target bar, applied at the next boundary

    this.worker = makeTimerWorker();
    this.worker.onmessage = () => this.tick();
  }

  // Arm a jump: at the next bar boundary, playback continues from `bar`.
  queueJump(bar) { this.pendingJump = Math.max(0, bar | 0); }

  beatMs() { return 60000 / this.state.bpm; }
  stepMs() { return this.beatMs() / 4; }          // a 16th note
  clockMs() { return this.beatMs() / 24; }        // a MIDI clock pulse

  // Distinct live MIDI outputs any track is currently routed to (clock/transport
  // are broadcast to all of them).
  midiOutputs() {
    const ids = new Set();
    for (const p of Object.values(this.state.parts)) if (p.output && p.output !== 'synth') ids.add(p.output);
    const outs = [];
    for (const id of ids) { const o = this.midi.get(id); if (o) outs.push(o); }
    return outs;
  }

  // { out, channel } routes for note-offs / panic across every MIDI-routed track.
  midiRoutes() {
    const routes = [];
    for (const p of Object.values(this.state.parts)) {
      if (p.output && p.output !== 'synth') { const o = this.midi.get(p.output); if (o) routes.push({ out: o, channel: p.channel }); }
    }
    return routes;
  }

  // Begin playback from `fromBar`. `resume` sends MIDI Continue (resume slaved gear
  // after a pause) instead of Start (which restarts it from the top).
  start(fromBar = 0, resume = false) {
    if (this.running) return;
    this.gen.reset();
    // Always wake the audio context on this Start gesture, so a track re-routed to
    // the internal synth mid-play still sounds (the context can't start later).
    if (this.synth) this.synth.resume();
    this.running = true;

    const now = performance.now() + 60; // small offset so the first events aren't "late"
    this.gridTime = now;     // running time of the (unswung) sixteenth grid
    this.clockTime = now;    // running time of the next MIDI clock pulse
    this.absStep = Math.max(0, fromBar | 0) * STEPS_PER_BAR; // start/resume here
    this.clockPulse = 0;     // global clock-pulse counter
    this.curBar = -1;
    this.barEvents = [];     // pending events for the current bar, by step

    if (this.state.sendClock) {
      for (const out of this.midiOutputs()) {
        if (resume) this.midi.sendContinue(out, now); else this.midi.sendStart(out, now);
      }
    }
    this.worker.postMessage('start');
    this.tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.worker.postMessage('stop');
    // Clear queued note-offs/clocks first, silence held notes, THEN send Stop so
    // the Stop message isn't swept away by clearScheduled().
    this.midi.panic(this.midiRoutes());
    if (this.synth) this.synth.panic();
    if (this.state.sendClock) {
      // Send MIDI Stop now — and again after the lookahead window. Chrome's
      // MIDIOutput.clear() is often a no-op, so clock pulses already scheduled
      // ahead keep firing for ~one lookahead; the second Stop guarantees it is
      // the last clock message the modular sees, so the clock actually halts.
      // (Skipped if playback was restarted in the meantime.)
      for (const out of this.midiOutputs()) this.midi.sendStop(out, performance.now());
      setTimeout(() => {
        if (this.running) return;
        for (const out of this.midiOutputs()) this.midi.sendStop(out, performance.now());
      }, LOOKAHEAD_MS + 30);
    }
  }

  tick() {
    if (!this.running) return;
    const horizon = performance.now() + LOOKAHEAD_MS;

    // 1) MIDI clock pulses — even spacing, recomputed from current BPM, broadcast
    //    to every interface a track is routed to. clockTime advances regardless so
    //    a device plugged in mid-play picks up the clock in phase, without a burst.
    if (this.state.sendClock) {
      const clockOuts = this.midiOutputs();
      while (this.clockTime < horizon) {
        for (const out of clockOuts) this.midi.clock(out, this.clockTime);
        this.clockPulse++;
        this.clockTime += this.clockMs();
      }
    }

    // 2) Note steps — fetch a new bar's events when we cross a bar line, then
    //    schedule everything that starts on the current step.
    while (this.gridTime < horizon) {
      let bar = Math.floor(this.absStep / STEPS_PER_BAR);

      if (bar !== this.curBar) {
        // Bar boundary: drain queued structural edits, then an armed jump, BEFORE
        // generating — so quantized edits and "jump here next" land on the bar line.
        if (this.cb.applyPending) this.cb.applyPending(bar);
        if (this.pendingJump != null) {
          this.absStep = this.pendingJump * STEPS_PER_BAR;
          this.pendingJump = null;
          bar = Math.floor(this.absStep / STEPS_PER_BAR);
        }
        this.curBar = bar;
        if (this.cb.ensureBar) this.cb.ensureBar(bar); // extend the song before generating
        this.barEvents = this.gen.generateBar(bar);
        if (this.cb.onBar) this.cb.onBar(bar, this.gen.songInfoAt(bar));
      }

      const stepInBar = this.absStep % STEPS_PER_BAR;
      // Swing: nudge odd sixteenths later (leaves the grid itself steady).
      const swingOffset = (stepInBar % 2 === 1) ? this.state.swing * this.stepMs() : 0;
      const emit = this.gridTime + swingOffset;

      for (const e of this.barEvents) {
        if (e.startStep !== stepInBar) continue;
        const off = emit + e.durSteps * this.stepMs();
        // Route per track: internal synth, or a specific interface + channel (read
        // live so re-routing/channel changes take effect on the next note).
        const route = this.state.parts[e.part];
        if (!route || !route.output || route.output === 'synth') {
          if (this.synth) this.synth.playNote(e.part, e.note, e.vel, emit, off);
        } else {
          const out = this.midi.get(route.output);
          if (out) { this.midi.noteOn(out, route.channel, e.note, e.vel, emit); this.midi.noteOff(out, route.channel, e.note, off); }
        }
      }
      if (this.cb.onStep) {
        const s = stepInBar;
        const b = bar; // capture THIS step's bar — this.curBar runs ahead of audio
        // Fire the UI callback at roughly the right wall-clock moment.
        const delay = Math.max(0, emit - performance.now());
        setTimeout(() => this.running && this.cb.onStep(s, b), delay);
      }

      this.absStep++;
      this.gridTime += this.stepMs();
    }
  }
}
