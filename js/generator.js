// generator.js — the generative engine.
//
// Modular voices are MONOPHONIC, so the harmony is implied across the parts
// rather than played as block chords:
//   • Pad   — one sustained, voice-led chord tone per chord (a mono drone)
//   • Bass  — the root, with a few style patterns
//   • Arp   — a monophonic arpeggio spelling out the chord tones
//   • Melody (lead) — a phrase-based melodic line that outlines the chords
// Every part is forced to one note at a time with a clean retrigger gap.
//
// Song form: the engine reads a precomputed per-bar `song` (built from sections
// A/B/C) so it knows the chord, section, and intensity for each bar.

import {
  scaleNotesInRange, chordTones, chordPcSet, pcAtOrAbove, diatonicChord, chordScaleIntervals,
} from './theory.js';
import { withEnergy } from './intensity.js';
import { MOTIFS } from './library.js';

export const STEPS_PER_BAR = 16;      // 4/4, sixteenth-note grid
const STRONG = [0, 8];
const MED = [4, 12];
const MONO_GAP = 0.25;                // sixteenth-steps of silence between mono notes

// Curated 1-bar rhythm cells for the lead motif (each {step, dur} in 16ths;
// durations roughly fill the bar). Grouped by how busy they are.
const LEAD_RHYTHMS = {
  sparse: [
    [{ step: 0, dur: 8 }, { step: 8, dur: 8 }],
    [{ step: 0, dur: 12 }, { step: 12, dur: 4 }],
    [{ step: 0, dur: 6 }, { step: 8, dur: 8 }],
  ],
  medium: [
    [{ step: 0, dur: 4 }, { step: 4, dur: 4 }, { step: 8, dur: 8 }],
    [{ step: 0, dur: 6 }, { step: 6, dur: 2 }, { step: 8, dur: 6 }, { step: 14, dur: 2 }],
    [{ step: 0, dur: 3 }, { step: 4, dur: 4 }, { step: 8, dur: 4 }, { step: 12, dur: 4 }],
    [{ step: 0, dur: 4 }, { step: 6, dur: 2 }, { step: 8, dur: 4 }, { step: 12, dur: 4 }],
  ],
  busy: [
    [{ step: 0, dur: 2 }, { step: 2, dur: 2 }, { step: 4, dur: 4 }, { step: 8, dur: 2 }, { step: 10, dur: 2 }, { step: 12, dur: 4 }],
    [{ step: 0, dur: 3 }, { step: 3, dur: 3 }, { step: 6, dur: 2 }, { step: 8, dur: 3 }, { step: 11, dur: 3 }, { step: 14, dur: 2 }],
    [{ step: 0, dur: 2 }, { step: 4, dur: 2 }, { step: 6, dur: 2 }, { step: 8, dur: 4 }, { step: 12, dur: 2 }, { step: 14, dur: 2 }],
  ],
};

// Per-style starting points, ordered roughly chill → energetic. Each sets the
// whole feel: tempo, swing, bass pattern, arp direction, the four part densities
// (pad/arp/lead), and per-part gate lengths (note length only — the patch still
// owns the envelopes). Pick one as a springboard, then bend anything.
export const STYLES = {
  ambient:   { name: 'Ambient',         bpm: 66,  swing: 0,    bass: 'roots',      arp: 'up',     padDens: 0.55, melDens: 0.35, leadDens: 0.28, gate: { pad: 1.0,  bass: 0.85, melody: 0.70, alt: 0.85 } },
  drone:     { name: 'Drone / Minimal', bpm: 58,  swing: 0,    bass: 'roots',      arp: 'up',     padDens: 0.60, melDens: 0.20, leadDens: 0.20, gate: { pad: 1.0,  bass: 0.95, melody: 0.85, alt: 0.90 } },
  cinematic: { name: 'Cinematic',       bpm: 84,  swing: 0,    bass: 'roots',      arp: 'updown', padDens: 0.45, melDens: 0.55, leadDens: 0.45, gate: { pad: 0.95, bass: 0.70, melody: 0.55, alt: 0.75 } },
  lofi:      { name: 'Lo-fi',           bpm: 78,  swing: 0.22, bass: 'roots',      arp: 'up',     padDens: 0.50, melDens: 0.60, leadDens: 0.50, gate: { pad: 0.85, bass: 0.60, melody: 0.50, alt: 0.60 } },
  ballad:    { name: 'Ballad',          bpm: 72,  swing: 0.06, bass: 'roots',      arp: 'up',     padDens: 0.50, melDens: 0.45, leadDens: 0.50, gate: { pad: 0.95, bass: 0.75, melody: 0.60, alt: 0.80 } },
  soul:      { name: 'Soul / R&B',      bpm: 92,  swing: 0.12, bass: 'walking',    arp: 'updown', padDens: 0.45, melDens: 0.55, leadDens: 0.55, gate: { pad: 0.90, bass: 0.65, melody: 0.55, alt: 0.70 } },
  gospel:    { name: 'Gospel',          bpm: 88,  swing: 0.10, bass: 'walking',    arp: 'updown', padDens: 0.50, melDens: 0.50, leadDens: 0.55, gate: { pad: 0.95, bass: 0.70, melody: 0.60, alt: 0.75 } },
  folk:      { name: 'Folk',            bpm: 98,  swing: 0.04, bass: 'roots',      arp: 'up',     padDens: 0.35, melDens: 0.55, leadDens: 0.50, gate: { pad: 0.80, bass: 0.60, melody: 0.45, alt: 0.60 } },
  country:   { name: 'Country',         bpm: 112, swing: 0.08, bass: 'walking',    arp: 'up',     padDens: 0.35, melDens: 0.55, leadDens: 0.50, gate: { pad: 0.80, bass: 0.55, melody: 0.45, alt: 0.60 } },
  reggae:    { name: 'Reggae / Dub',    bpm: 76,  swing: 0.10, bass: 'offbeat',    arp: 'up',     padDens: 0.45, melDens: 0.40, leadDens: 0.40, gate: { pad: 0.70, bass: 0.50, melody: 0.45, alt: 0.60 } },
  blues:     { name: 'Blues (shuffle)', bpm: 100, swing: 0.30, bass: 'walking',    arp: 'up',     padDens: 0.35, melDens: 0.50, leadDens: 0.55, gate: { pad: 0.85, bass: 0.60, melody: 0.50, alt: 0.65 } },
  bossa:     { name: 'Bossa Nova',      bpm: 128, swing: 0.12, bass: 'syncopated', arp: 'updown', padDens: 0.40, melDens: 0.50, leadDens: 0.45, gate: { pad: 0.80, bass: 0.55, melody: 0.50, alt: 0.60 } },
  funk:      { name: 'Funk',            bpm: 104, swing: 0.14, bass: 'syncopated', arp: 'random', padDens: 0.35, melDens: 0.70, leadDens: 0.50, gate: { pad: 0.60, bass: 0.40, melody: 0.35, alt: 0.50 } },
  afrobeat:  { name: 'Afrobeat',        bpm: 110, swing: 0.10, bass: 'syncopated', arp: 'updown', padDens: 0.40, melDens: 0.70, leadDens: 0.55, gate: { pad: 0.65, bass: 0.45, melody: 0.40, alt: 0.55 } },
  disco:     { name: 'Disco',           bpm: 118, swing: 0,    bass: 'offbeat',    arp: 'up',     padDens: 0.40, melDens: 0.75, leadDens: 0.50, gate: { pad: 0.70, bass: 0.45, melody: 0.40, alt: 0.55 } },
  house:     { name: 'House',           bpm: 122, swing: 0,    bass: 'offbeat',    arp: 'up',     padDens: 0.45, melDens: 0.70, leadDens: 0.45, gate: { pad: 0.70, bass: 0.45, melody: 0.45, alt: 0.55 } },
  synthwave: { name: 'Synthwave',       bpm: 110, swing: 0,    bass: 'roots8',     arp: 'up',     padDens: 0.50, melDens: 0.65, leadDens: 0.50, gate: { pad: 0.85, bass: 0.60, melody: 0.50, alt: 0.60 } },
  rock:      { name: 'Rock',            bpm: 120, swing: 0,    bass: 'roots8',     arp: 'up',     padDens: 0.40, melDens: 0.60, leadDens: 0.50, gate: { pad: 0.80, bass: 0.55, melody: 0.50, alt: 0.60 } },
  jazz:      { name: 'Jazz (swing)',    bpm: 132, swing: 0.30, bass: 'walking',    arp: 'updown', padDens: 0.40, melDens: 0.60, leadDens: 0.50, gate: { pad: 0.85, bass: 0.60, melody: 0.50, alt: 0.65 } },
  techno:    { name: 'Techno',          bpm: 130, swing: 0,    bass: 'roots8',     arp: 'up',     padDens: 0.45, melDens: 0.70, leadDens: 0.50, gate: { pad: 0.70, bass: 0.40, melody: 0.40, alt: 0.50 } },
  trance:    { name: 'Trance',          bpm: 138, swing: 0,    bass: 'roots8',     arp: 'up',     padDens: 0.50, melDens: 0.82, leadDens: 0.55, gate: { pad: 0.90, bass: 0.45, melody: 0.40, alt: 0.55 } },
  trap:      { name: 'Trap',            bpm: 140, swing: 0.08, bass: 'roots',      arp: 'up',     padDens: 0.40, melDens: 0.55, leadDens: 0.45, gate: { pad: 0.85, bass: 0.90, melody: 0.40, alt: 0.55 } },
  dnb:       { name: 'Drum & Bass',     bpm: 172, swing: 0,    bass: 'roots',      arp: 'random', padDens: 0.40, melDens: 0.70, leadDens: 0.55, gate: { pad: 0.80, bass: 0.70, melody: 0.40, alt: 0.55 } },
  metal:     { name: 'Metal',           bpm: 160, swing: 0,    bass: 'roots8',     arp: 'up',     padDens: 0.35, melDens: 0.60, leadDens: 0.55, gate: { pad: 0.70, bass: 0.40, melody: 0.40, alt: 0.50 } },
};

// Popular progressions, in roman numerals so they adapt to the chosen key/scale.
export const PROGRESSIONS = [
  { name: 'I–V–vi–IV (pop)',        value: 'I V vi IV' },
  { name: 'vi–IV–I–V',              value: 'vi IV I V' },
  { name: 'I–vi–IV–V (50s)',        value: 'I vi IV V' },
  { name: 'ii–V–I–vi (jazz)',       value: 'ii V I vi' },
  { name: 'I–IV–V (three-chord)',   value: 'I IV V V' },
  { name: 'i–VI–III–VII (minor)',   value: 'i VI III VII' },
  { name: 'i–iv–v (minor)',         value: 'i iv v v' },
  { name: 'i–VII–VI–VII',           value: 'i VII VI VII' },
  { name: 'i–iv–i–V (funk)',        value: 'i iv i V' },
  { name: 'I–IV–V–IV (rock)',       value: 'I IV V IV' },
  { name: 'Andalusian (i–VII–VI–V)', value: 'i VII VI V' },
  { name: 'I–IV (vamp)',            value: 'I IV' },
  { name: 'i–iv (minor vamp)',      value: 'i iv' },
  { name: 'I (drone)',              value: 'I' },
  { name: '12-bar blues',           value: 'I I I I IV IV I I V IV I V' },
];

// Seedable PRNG (mulberry32 + string hash) — same seed reproduces a jam from bar 0.
export function makeRng(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (let i = 0; i < String(seedStr).length; i++) {
    h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class JamGenerator {
  constructor(state) {
    this.state = state;
    this.reset();
  }

  reset() {
    this.rng = makeRng(this.state.seed);
    this.reseedMelody();      // separate stream so melodies can be rerolled alone
    this.lastPad = null;
    this.lastLead = null;
    this.motif = null;        // current lead motif (rhythm + scale-degree contour)
    this.arpIdx = 0;
    this.arpSign = 1;
    this.curEnergy = this.state.energy;
  }

  // Re-seed only the melody/arp randomness (motif choice, arp pattern, lead
  // development) from state.melodySalt — "Reroll melodies only" bumps the salt and
  // calls this, leaving harmony, bass and structure untouched.
  reseedMelody() {
    this.melRng = makeRng(`${this.state.seed}:mel:${this.state.melodySalt || 0}`);
    this.motif = null;        // force a fresh motif on the next phrase
  }

  // Per-bar song info: { chord, label, section, boost }. Falls back to the tonic.
  songInfoAt(bar) {
    const song = this.state.song;
    if (!song || !song.length) {
      const dc = diatonicChord(this.state.rootPc, this.state.scaleKey, 0);
      return { chord: { ...dc, label: 'I' }, label: 'I', section: 'A' };
    }
    // No looping — clamp (the transport extends the song before we reach the end).
    const i = bar < 0 ? 0 : bar >= song.length ? song.length - 1 : bar;
    return song[i];
  }

  chordAt(bar) { return this.songInfoAt(bar).chord; }

  baseMidi(part) {
    const def = { pad: 48, bass: 36, melody: 60, alt: 67 }[part];
    return def + (this.state.parts[part].octave || 0) * 12;
  }

  velo(part, accent = 1) {
    const base = { pad: 50, bass: 92, melody: 84, alt: 96 }[part];
    const p = this.state.parts[part];
    // Melody/arp jitter comes from the melody stream so rerolling melodies can't
    // perturb the bass/pad stream (keeps "reroll melodies only" truly isolated).
    const r = (part === 'melody' || part === 'alt') ? this.melRng : this.rng;
    const v = base * (0.55 + p.velocity * 0.65) * (0.78 + this.curEnergy * 0.34) * accent;
    return clamp(Math.round(v + (r() * 8 - 4)), 1, 127);
  }

  // Produce all note events for one bar, each tagged with its part and forced mono.
  generateBar(bar) {
    const info = this.songInfoAt(bar);
    const chord = info.chord;
    const nextChord = this.songInfoAt(bar + 1).chord;
    const N = (this.state.song || []).length || 1;
    const bIdx = bar < 0 ? 0 : bar >= N ? N - 1 : bar;
    // Per-bar authored intensity (absolute bar) + the global Energy ride.
    const baseInt = this.state.intensity ? this.state.intensity[bIdx] : null;
    this.curEnergy = withEnergy(baseInt, this.state.energy);

    const out = [];
    const run = (part, fn) => {
      if (!this.state.parts[part].enabled) return;
      const m = this.state.mutes && this.state.mutes[part];
      if (m && m.has(bar)) return; // per-bar mute (absolute bar) from the timeline
      const arr = [];
      fn(arr, chord, nextChord, bar);
      for (const e of arr) e.part = part;
      for (const e of this.enforceMono(arr)) out.push(e);
    };
    run('pad', (a, c) => this.genPad(a, c));
    run('bass', (a, c, n) => this.genBass(a, c, n));
    run('melody', (a, c) => this.genArp(a, c));
    run('alt', (a, c, n, b) => this.genLead(a, b, c));
    return out;
  }

  // Force a single part to one note at a time: drop notes sharing a start step,
  // then clip each note so it ends a small gap before the next (and before the
  // bar line), guaranteeing a clean gate retrigger on monophonic gear.
  enforceMono(arr) {
    arr.sort((a, b) => a.startStep - b.startStep);
    const cleaned = [];
    const seen = new Set();
    for (const e of arr) {
      const k = e.startStep.toFixed(3);
      if (seen.has(k)) continue;
      seen.add(k);
      cleaned.push(e);
    }
    for (let i = 0; i < cleaned.length; i++) {
      const cur = cleaned[i], nxt = cleaned[i + 1];
      const limit = (nxt ? nxt.startStep : STEPS_PER_BAR) - MONO_GAP;
      if (cur.startStep + cur.durSteps > limit) {
        cur.durSteps = Math.max(0.2, limit - cur.startStep);
      }
    }
    return cleaned;
  }

  // ---- PAD: one voice-led sustained note per chord (mono drone). -----------
  // Density adds gentle re-articulations (still one pitch).
  genPad(events, chord) {
    const p = this.state.parts.pad;
    const ch = p.channel;
    const base = this.baseMidi('pad');
    // Lean on the chord's guide tones (3rd/7th) with voice leading — the bass owns
    // the root, so the pad colours the harmony rather than doubling it.
    const tones = this.guideTones(chord, base);
    const note = this.lastPad == null ? tones[0] : this.nearestIn(tones, this.lastPad);
    const dens = clamp(p.density * (0.6 + this.curEnergy * 0.5), 0, 1);
    const hits = dens < 0.4 ? 1 : dens < 0.7 ? 2 : 4;
    const span = STEPS_PER_BAR / hits;
    const gate = 0.6 + p.gate * 0.4;
    for (let h = 0; h < hits; h++) {
      events.push(this.ev(ch, note, this.velo('pad'), h * span, span * gate));
    }
    this.lastPad = note;
  }

  // ---- BASS: root-driven mono patterns. ------------------------------------
  genBass(events, chord, nextChord) {
    const p = this.state.parts.bass;
    const ch = p.channel;
    const base = this.baseMidi('bass');
    const root = pcAtOrAbove(chord.rootPc, base);
    const fifth = root + 7;
    const gate = 0.4 + p.gate * 0.55;
    const style = this.state.bassStyle;
    const skip = () => this.rng() > clamp(0.35 + p.density * 0.65 + this.curEnergy * 0.2, 0, 1);
    const put = (note, step, dur, accent = 1) =>
      events.push(this.ev(ch, note, this.velo('bass', accent), step, dur * gate));

    if (style === 'roots') {
      put(root, 0, 8, 1.05);
      if (!skip()) put(root, 8, 8, 0.9);
    } else if (style === 'roots8') {
      for (let s = 0; s < STEPS_PER_BAR; s += 2) {
        if (s !== 0 && skip()) continue;
        put(root, s, 2, s % 8 === 0 ? 1.05 : 0.85);
      }
    } else if (style === 'offbeat') {
      put(root, 0, 1, 1.05);
      for (const s of [2, 6, 10, 14]) put(root, s, 2, 0.95);
    } else if (style === 'walking') {
      const scale = scaleNotesInRange(this.state.rootPc, this.state.scaleKey, base, base + 16);
      const beat3 = this.nearestIn(scale, root + 4);              // up a third
      const nextRoot = pcAtOrAbove(nextChord.rootPc, base);
      // Beat 4 is a chromatic approach tone that resolves into the next root.
      const targets = [root, this.nearestIn(scale, fifth), beat3, this.approachTone(beat3, nextRoot)];
      [0, 4, 8, 12].forEach((s, i) => put(targets[i] || root, s, 4, s === 0 ? 1.05 : 0.9));
    } else if (style === 'syncopated') {
      const pat = [[0, 1.05], [3, 0.8], [6, 0.95], [8, 1.0], [11, 0.8], [14, 0.95]];
      for (const [s, a] of pat) {
        if (s !== 0 && skip()) continue;
        const note = a < 0.85 && this.rng() > 0.6 ? fifth : root;
        put(note, s, 2, a);
      }
    }
  }

  // ---- ARP: monophonic arpeggio spelling out the chord tones. --------------
  genArp(events, chord) {
    const p = this.state.parts.melody;
    const ch = p.channel;
    const base = this.baseMidi('melody');
    const tones = chordTones(chord, base, 4);
    // Intensity beyond density: at high energy the arpeggio spans a wider register.
    const arp = this.curEnergy > 0.66
      ? tones.concat(tones.map((t) => t + 12)).concat([tones[0] + 24])
      : tones.concat([tones[0] + 12]);
    const dens = clamp(p.density * (0.6 + this.curEnergy * 0.6), 0, 1);
    const every = dens < 0.5 ? 2 : 1;          // eighth- vs sixteenth-note rate
    const playProb = clamp(0.45 + dens * 0.6, 0.2, 1);
    const dir = this.state.arpDir || 'up';
    const gate = 0.35 + p.gate * 0.5;

    for (let s = 0; s < STEPS_PER_BAR; s += every) {
      const note = arp[this.arpStep(arp.length, dir)];
      if (s !== 0 && this.melRng() > playProb) continue; // always hit the downbeat
      events.push(this.ev(ch, note, this.velo('melody', this.accentFor(s)), s, every * gate));
    }
  }

  // Returns the current arp index and advances internal state for the next call,
  // so the pattern flows continuously across bars.
  arpStep(len, dir) {
    if (len <= 0) return 0;
    const idx = ((this.arpIdx % len) + len) % len;
    if (dir === 'random') {
      this.arpIdx = Math.floor(this.melRng() * len);
    } else if (dir === 'down') {
      this.arpIdx = idx - 1;
    } else if (dir === 'updown') {
      let n = idx + this.arpSign;
      if (n >= len) { n = len - 2 >= 0 ? len - 2 : 0; this.arpSign = -1; }
      else if (n < 0) { n = 1 < len ? 1 : 0; this.arpSign = 1; }
      this.arpIdx = n;
    } else {
      this.arpIdx = idx + 1;
    }
    return idx;
  }

  // ---- MELODY (lead): motif-based line that develops over each phrase. -------
  // A short rhythm+contour cell (the motif) is stated, then re-anchored to each
  // chord (sequence), varied/inverted, and resolved to a chord tone at the phrase
  // end — so phrases sound related and intentional rather than randomly walked.
  // "Evolve" controls how often a new motif is introduced and how much it varies.
  genLead(events, bar, chord) {
    const p = this.state.parts.alt;
    const ch = p.channel;
    const base = this.baseMidi('alt');
    // Over a borrowed/secondary chord the lead borrows that chord's scale for its
    // passing tones (e.g. Mixolydian of a V7/x); diatonic chords use the key scale.
    const scale = this.scaleForLead(chord, base - 7, base + 14);
    const chordPcs = chordPcSet(chord, 3);
    const phrasePos = ((bar % 4) + 4) % 4;        // 0..3 within a 4-bar phrase
    const dens = clamp(p.density * (0.55 + this.curEnergy * 0.6), 0.12, 1);

    // (Re)introduce a motif at phrase starts (always if none); more often as evolve rises.
    if (!this.motif || (phrasePos === 0 && this.melRng() < clamp(0.3 + this.state.evolve * 0.6, 0.1, 0.95))) {
      this.motif = this.makeMotif(dens);
    }

    // Anchor on a chord tone: start each phrase near register center, voice-lead
    // within the phrase, but rein in drift so the line doesn't climb to the rails.
    const center = this.nearestIn(scale, base + 3);
    let anchorBase = (phrasePos === 0 || this.lastLead == null) ? center : this.lastLead;
    if (anchorBase > center + 9) anchorBase = center + 5;
    if (anchorBase < center - 7) anchorBase = center - 3;
    const anchor = this.snapToChord(scale, anchorBase, chordPcs);
    let anchorIdx = scale.indexOf(anchor);
    if (anchorIdx < 0) anchorIdx = scale.indexOf(this.nearestIn(scale, anchor));

    const notes = this.renderMotif(this.motif, scale, anchorIdx, chordPcs, phrasePos, p.gate, chord);
    for (const n of notes) events.push(this.ev(ch, n.note, this.velo('alt', n.accent), n.startStep, n.durSteps));
    if (notes.length) this.lastLead = notes[notes.length - 1].note;
  }

  // Pick a known-good melodic archetype for this density tier, then DEVELOP it
  // logically by an amount set by Evolve — retrograde (reverse), diatonic sequence
  // (transpose the whole contour a step), and fragmentation (state a sub-cell). The
  // result keeps renderMotif's { rhythm, degrees } shape, so the rest of the lead
  // pipeline (inversion at phrase 3rd bar, chord-snapping, thinning) is unchanged.
  makeMotif(dens) {
    const tier = dens < 0.4 ? 'sparse' : dens < 0.7 ? 'medium' : 'busy';
    const pool = MOTIFS.filter((m) => m.tier === tier);
    const base = pool.length
      ? pool[Math.floor(this.melRng() * pool.length)]
      : { rhythm: LEAD_RHYTHMS[tier][0], degrees: [0, 2, 1] };
    let degrees = base.degrees.slice();
    let rhythm = base.rhythm.map((r) => ({ ...r }));
    const ev = this.state.evolve || 0;
    if (this.melRng() < ev * 0.4) degrees.reverse();                                       // retrograde
    if (this.melRng() < ev * 0.4) { const sh = this.melRng() < 0.5 ? 1 : -1; degrees = degrees.map((d) => d + sh); } // diatonic sequence
    if (degrees.length > 3 && this.melRng() < ev * 0.35) {                                 // fragmentation
      const half = Math.ceil(degrees.length / 2);
      degrees = degrees.slice(0, half);
      rhythm = rhythm.slice(0, half);
    }
    degrees = degrees.map((d) => Math.max(-3, Math.min(6, d)));                            // keep leaps sane
    return { rhythm, degrees };
  }

  // Render the motif at a bar: transform by phrase position, anchor to the chord.
  renderMotif(motif, scale, anchorIdx, chordPcs, phrasePos, gate, chord) {
    let degrees = motif.degrees.slice();
    if (phrasePos === 2 && this.melRng() < 0.3 + this.state.evolve * 0.4) degrees = degrees.map((d) => -d); // inversion
    if (phrasePos === 2 && degrees.length > 1 && this.melRng() < 0.5) {
      degrees[degrees.length - 1] += this.melRng() < 0.5 ? 1 : -1; // vary the tail
    }
    // Phrase end: thin to the stronger onsets so it breathes and cadences.
    let rhythm = motif.rhythm;
    if (phrasePos === 3) rhythm = rhythm.filter((r, i) => i === 0 || i === rhythm.length - 1 || STRONG.includes(r.step) || MED.includes(r.step));

    const avoid = chord ? this.avoidPcs(chord) : null;
    const notes = [];
    for (let i = 0; i < rhythm.length; i++) {
      const r = rhythm[i];
      const deg = degrees[Math.min(i, degrees.length - 1)] || 0;
      let note = scale[clamp(anchorIdx + deg, 0, scale.length - 1)];
      const strong = STRONG.includes(r.step) || MED.includes(r.step);
      // Anchor the downbeat to the chord; on other strong beats, nudge an avoid-note
      // (natural 4 over major, b9 over dom7) onto a chord tone. The contour carries
      // the rest (passing/neighbour tones), which gives the line its melodic shape.
      if (r.step === 0) note = this.snapToChord(scale, note, chordPcs);
      else if (strong && avoid && avoid.has(((note % 12) + 12) % 12)) note = this.snapToChord(scale, note, chordPcs);
      notes.push({ startStep: r.step, durSteps: Math.max(1, r.dur * (0.5 + gate * 0.5)), note, accent: this.accentFor(r.step) });
    }
    // Resolve the phrase's final note onto a chord tone.
    if (phrasePos === 3 && notes.length) {
      notes[notes.length - 1].note = this.snapToChord(scale, notes[notes.length - 1].note, chordPcs);
    }
    return notes;
  }

  // ---- helpers -------------------------------------------------------------
  ev(channel, note, vel, startStep, durSteps) {
    return { channel, note, vel, startStep, durSteps };
  }

  pickOnsets(density, target) {
    const out = [];
    const weights = (s) => (STRONG.includes(s) ? 1 : MED.includes(s) ? 0.8 : s % 2 === 0 ? 0.5 : 0.25);
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      if (this.rng() < density * weights(s)) out.push(s);
    }
    if (out.length === 0) out.push(0);
    while (out.length > target) out.splice(1 + Math.floor(this.rng() * (out.length - 1)), 1);
    return out;
  }

  nearestIn(arr, target) {
    let best = arr[0], bd = Infinity;
    for (const n of arr) { const d = Math.abs(n - target); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  stepInScale(scale, note, steps) {
    let idx = scale.indexOf(note);
    if (idx === -1) idx = scale.indexOf(this.nearestIn(scale, note));
    return scale[clamp(idx + steps, 0, scale.length - 1)];
  }

  snapToChord(scale, note, chordPcs) {
    const tones = scale.filter((n) => chordPcs.has(((n % 12) + 12) % 12));
    return tones.length ? this.nearestIn(tones, note) : note;
  }

  // ---- musicality helpers (Epic 7) ----------------------------------------
  // Metric accent contour: downbeat strongest → offbeat sixteenths weakest.
  accentFor(step) {
    if (step === 0) return 1.0;
    if (step === 8) return 0.93;
    if (step === 4 || step === 12) return 0.85;
    if (step % 2 === 0) return 0.76;
    return 0.66;
  }

  // The chord's two guide tones (3rd + 7th, or 3rd + 5th for a triad), voiced near
  // baseMidi — the pad leans on these while the bass owns the root.
  guideTones(chord, baseMidi) {
    const o = chord.offsets || [0, 4, 7];
    const rootMidi = pcAtOrAbove(chord.rootPc, baseMidi);
    const third = o[1] != null ? o[1] : o[0];
    const upper = o[3] != null ? o[3] : (o[2] != null ? o[2] : (o[1] || 0));
    return [rootMidi + third, rootMidi + upper];
  }

  // A chromatic approach note into `target` from whichever side is nearer the
  // previous note — a leading tone for the walking bass on beat 4.
  approachTone(from, target) {
    const below = target - 1, above = target + 1;
    return Math.abs(from - below) <= Math.abs(from - above) ? below : above;
  }

  // Pitch classes to avoid on strong beats for this chord quality: the natural 4
  // over a major/dominant chord, and the b9 over an unaltered dom7.
  avoidPcs(chord) {
    const o = chord.offsets || [];
    const s = new Set();
    if (o[1] === 4) {
      s.add((chord.rootPc + 5) % 12);
      if (o[3] === 10) s.add((chord.rootPc + 1) % 12);
    }
    return s;
  }

  // Scale notes in [lo, hi] for the lead: the chord's own scale over a borrowed or
  // secondary chord, otherwise the song's key scale.
  scaleForLead(chord, lo, hi) {
    if (chord.chromatic) {
      const set = new Set(chordScaleIntervals(chord).map((iv) => (((chord.rootPc + iv) % 12) + 12) % 12));
      const out = [];
      for (let n = lo; n <= hi; n++) if (set.has(((n % 12) + 12) % 12)) out.push(n);
      if (out.length) return out;
    }
    return scaleNotesInRange(this.state.rootPc, this.state.scaleKey, lo, hi);
  }
}
