// export-midi.js — render the current timeline (the materialised per-bar song)
// to a Standard MIDI File.
//
// We replay the generator from bar 0 on a FRESH instance so live playback state
// is left untouched, collect every note event, and write a Type-1 SMF: a
// tempo/meta track plus one named track per part.
//
// Timing mirrors the scheduler exactly — 16 steps per bar (a sixteenth grid),
// swing nudges odd sixteenths later, durations are measured in steps. Swing is
// baked into the tick positions so the file grooves like what you hear.

import { JamGenerator, STEPS_PER_BAR } from './generator.js';

const PPQ = 480;                    // ticks per quarter note (standard)
const TICKS_PER_STEP = PPQ / 4;    // a sixteenth-note step
const PART_TRACK_NAMES = { pad: 'Pad', bass: 'Bassline', melody: 'Arpeggiator', alt: 'Melody' };
const PART_ORDER = ['pad', 'bass', 'melody', 'alt'];

// ---- byte helpers ---------------------------------------------------------
// Variable-length quantity — how MIDI encodes delta times.
function vlq(n) {
  n = Math.max(0, Math.round(n));
  const out = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  return out;
}
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
const ascii = (s) => Array.from(String(s), (c) => c.charCodeAt(0) & 0xff);
const chunk = (id, data) => [...ascii(id), ...u32(data.length), ...data];
const metaText = (type, text) => { const t = ascii(text); return [0xff, type, ...vlq(t.length), ...t]; };

// Turn a list of { tick, order, bytes } into an MTrk chunk: sort by time
// (note-offs before note-ons at the same tick), delta-time it, append End-of-Track.
function trackChunk(events, name) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data = [];
  if (name) data.push(0, ...metaText(0x03, name)); // delta 0: track name
  let last = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0x00); // End of Track
  return chunk('MTrk', data);
}

// ---- main -----------------------------------------------------------------
// Render state.song to SMF bytes. Returns a Uint8Array (empty if no notes).
export function buildTimelineMidi(state) {
  const bars = (state.song || []).length;
  const swing = state.swing || 0;

  // Throwaway generator, replayed from the top so we reproduce exactly what
  // playback renders from bar 0 (enabled parts and per-bar mutes are honoured
  // inside generateBar) without perturbing the live generator's state.
  const gen = new JamGenerator(state);
  gen.reset();

  const byPart = { pad: [], bass: [], melody: [], alt: [] };
  let noteCount = 0;
  for (let bar = 0; bar < bars; bar++) {
    for (const e of gen.generateBar(bar)) {
      const onStep = bar * STEPS_PER_BAR + e.startStep;
      const swingTicks = (e.startStep % 2 === 1) ? swing * TICKS_PER_STEP : 0;
      const onTick = Math.round(onStep * TICKS_PER_STEP + swingTicks);
      const offTick = Math.max(onTick + 1, onTick + Math.round(e.durSteps * TICKS_PER_STEP));
      const ch = e.channel & 0x0f;
      const note = e.note & 0x7f;
      const vel = Math.max(1, Math.min(127, e.vel | 0));
      const list = byPart[e.part] || (byPart[e.part] = []);
      list.push({ tick: onTick, order: 1, bytes: [0x90 | ch, note, vel] });
      list.push({ tick: offTick, order: 0, bytes: [0x80 | ch, note, 0] });
      noteCount++;
    }
  }
  if (!noteCount) return new Uint8Array(0);

  // Track 0: name + 4/4 time signature + tempo.
  const usPerQuarter = Math.round(60000000 / (state.bpm || 120));
  const meta = [
    0, ...metaText(0x03, 'Modular Riffs'),
    0, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
    0, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff,
    0, 0xff, 0x2f, 0x00,
  ];
  const tracks = [chunk('MTrk', meta)];
  for (const part of PART_ORDER) {
    if (byPart[part].length) tracks.push(trackChunk(byPart[part], PART_TRACK_NAMES[part]));
  }

  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]); // format 1
  return Uint8Array.from([...header, ...tracks.flat()]);
}
