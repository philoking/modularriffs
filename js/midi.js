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

export class MidiOut {
  constructor() {
    this.access = null;
    this.output = null;
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

  selectOutput(id) {
    this.output = this.access ? this.access.outputs.get(id) || null : null;
    return this.output;
  }

  // ---- channel voice messages (channel is 0-15) ----
  noteOn(ch, note, vel, time) {
    if (this.output) this.output.send([NOTE_ON | (ch & 0x0f), note & 0x7f, vel & 0x7f], time);
  }

  noteOff(ch, note, time) {
    if (this.output) this.output.send([NOTE_OFF | (ch & 0x0f), note & 0x7f, 0], time);
  }

  cc(ch, controller, value, time) {
    if (this.output) this.output.send([CC | (ch & 0x0f), controller & 0x7f, value & 0x7f], time);
  }

  // ---- system real-time (clock/transport) ----
  clock(time)    { if (this.output) this.output.send([CLOCK], time); }
  sendStart(time)    { if (this.output) this.output.send([START], time); }
  sendStop(time)     { if (this.output) this.output.send([STOP], time); }
  sendContinue(time) { if (this.output) this.output.send([CONTINUE], time); }

  // Cancel anything still queued in the MIDI layer (e.g. future note-offs).
  clearScheduled() {
    if (this.output && typeof this.output.clear === 'function') this.output.clear();
  }

  // Silence everything. Used on stop and by the Panic button.
  panic(channels = [0, 1, 2, 3]) {
    this.clearScheduled();
    if (!this.output) return;
    for (const ch of channels) {
      this.cc(ch, 123, 0); // All Notes Off
      this.cc(ch, 120, 0); // All Sound Off
      // Belt-and-braces: explicit note-offs for held notes some gear ignores CC123 on.
      for (let n = 24; n <= 96; n++) this.noteOff(ch, n);
    }
  }
}
