// midi.js — Web MIDI access and message helpers.
//
// All send() calls take a timestamp in the performance.now() time domain, which
// the browser/OS MIDI layer uses for precise dispatch — far tighter than relying
// on a JS timer firing exactly on time.

// MIDI status bytes
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xb0;
const CLOCK = 0xf8;   // timing clock (24 per quarter note)
const START = 0xfa;   // transport start
const STOP = 0xfc;    // transport stop
const CONTINUE = 0xfb;

// Each track routes itself to a destination, so the send helpers all take an
// explicit `out` (a MIDIOutput resolved from a part's saved port id). Tracks can
// target different interfaces at once — a USB synth on one, a modular on another.
export class MidiOut {
  constructor() {
    this.access = null;
    this.onStateChange = null;
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      throw new Error('Web MIDI API not available. Use Chrome or Edge over http://localhost.');
    }
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.onStateChange && this.onStateChange(this.listOutputs());
    return this.listOutputs();
  }

  listOutputs() {
    return this.access ? [...this.access.outputs.values()] : [];
  }

  // Resolve a saved port id to a live MIDIOutput, or null if it's gone/offline.
  get(id) {
    return this.access && id ? this.access.outputs.get(id) || null : null;
  }

  // ---- channel voice messages (out is a MIDIOutput; channel is 0-15) ----
  noteOn(out, ch, note, vel, time) {
    if (out) out.send([NOTE_ON | (ch & 0x0f), note & 0x7f, vel & 0x7f], time);
  }

  noteOff(out, ch, note, time) {
    if (out) out.send([NOTE_OFF | (ch & 0x0f), note & 0x7f, 0], time);
  }

  cc(out, ch, controller, value, time) {
    if (out) out.send([CC | (ch & 0x0f), controller & 0x7f, value & 0x7f], time);
  }

  // ---- system real-time (clock/transport) — one output at a time ----
  clock(out, time)        { if (out) out.send([CLOCK], time); }
  sendStart(out, time)    { if (out) out.send([START], time); }
  sendStop(out, time)     { if (out) out.send([STOP], time); }
  sendContinue(out, time) { if (out) out.send([CONTINUE], time); }

  // Cancel anything still queued in the MIDI layer (e.g. future note-offs).
  clearScheduled(out) {
    if (out && typeof out.clear === 'function') out.clear();
  }

  // Silence held notes across a set of routes ({ out, channel }). Used on stop
  // and by the Panic button. Distinct outputs may repeat a channel — harmless.
  panic(routes = []) {
    for (const { out, channel } of routes) {
      if (!out) continue;
      this.clearScheduled(out);
      this.cc(out, channel, 123, 0); // All Notes Off
      this.cc(out, channel, 120, 0); // All Sound Off
      // Belt-and-braces: explicit note-offs for held notes some gear ignores CC123 on.
      for (let n = 24; n <= 96; n++) this.noteOff(out, channel, n);
    }
  }
}
