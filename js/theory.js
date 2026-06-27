// theory.js — scales, modes, chords, progressions, and note utilities.
// Everything here is pure (no state) so the generator can call it freely.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Scales/modes as semitone intervals from the root.
export const SCALES = {
  major:         { name: 'Major (Ionian)',   intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian:        { name: 'Dorian',           intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian:      { name: 'Phrygian',         intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian:        { name: 'Lydian',           intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian:    { name: 'Mixolydian',       intervals: [0, 2, 4, 5, 7, 9, 10] },
  minor:         { name: 'Minor (Aeolian)',  intervals: [0, 2, 3, 5, 7, 8, 10] },
  locrian:       { name: 'Locrian',          intervals: [0, 1, 3, 5, 6, 8, 10] },
  harmonicMinor: { name: 'Harmonic Minor',   intervals: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor:  { name: 'Melodic Minor',    intervals: [0, 2, 3, 5, 7, 9, 11] },
  majorPent:     { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPent:     { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  blues:         { name: 'Blues',            intervals: [0, 3, 5, 6, 7, 10] },
};

// Named chord qualities → semitone offsets from the chord root.
export const CHORD_QUALITIES = {
  maj:  [0, 4, 7],        min:  [0, 3, 7],
  dim:  [0, 3, 6],        aug:  [0, 4, 8],
  sus2: [0, 2, 7],        sus4: [0, 5, 7],
  '6':  [0, 4, 7, 9],     m6:   [0, 3, 7, 9],
  maj7: [0, 4, 7, 11],    min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],    m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],     add9: [0, 4, 7, 14],
  maj9: [0, 4, 7, 11, 14], min9: [0, 3, 7, 10, 14], dom9: [0, 4, 7, 10, 14],
};

export const ROOT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROMAN = { i: 1, v: 5, x: 10 };
// Semitones of each scale-degree numeral measured from the tonic, using the major
// scale as the reference. Lets accidental-prefixed romans (bVII, bVI, #iv) and
// secondary dominants (II7 = V7/V) resolve to a chromatic root that transposes.
const MAJOR_DEG = [0, 2, 4, 5, 7, 9, 11];

export function pcName(pc) { return NOTE_NAMES[((pc % 12) + 12) % 12]; }

// MIDI note (e.g. 60) → readable name like "C4".
export function midiName(n) {
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

// Pitch classes of a scale, as a Set for fast membership tests.
export function scalePcSet(rootPc, scaleKey) {
  const s = SCALES[scaleKey] || SCALES.major;
  return new Set(s.intervals.map((i) => (rootPc + i) % 12));
}

// All MIDI notes of a scale within [lo, hi], ascending.
export function scaleNotesInRange(rootPc, scaleKey, lo, hi) {
  const set = scalePcSet(rootPc, scaleKey);
  const out = [];
  for (let n = lo; n <= hi; n++) if (set.has(((n % 12) + 12) % 12)) out.push(n);
  return out;
}

// Build a diatonic chord by stacking thirds within the scale, starting at `degree`
// (0-based). Returns { rootPc, offsets, degree } where offsets are semitones from
// the chord's own root. Works for any mode; for pentatonic scales it stacks the
// available scale tones, which still yields usable, in-key voicings.
export function diatonicChord(rootPc, scaleKey, degree, numNotes = 4) {
  const intervals = (SCALES[scaleKey] || SCALES.major).intervals;
  const len = intervals.length;
  const baseInterval = intervals[degree % len] + Math.floor(degree / len) * 12;
  const chordRootPc = (rootPc + baseInterval) % 12;
  const offsets = [];
  for (let k = 0; k < numNotes; k++) {
    const idx = degree + 2 * k;
    const interval = intervals[idx % len] + Math.floor(idx / len) * 12;
    offsets.push(interval - baseInterval);
  }
  return { rootPc: chordRootPc, offsets, degree };
}

// Parse an absolute chord symbol like "Cmaj7", "Am", "F#m7b5", "G7", "Dsus4".
export function parseChordSymbol(sym) {
  const m = sym.trim().match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;
  let rootPc = ROOT_PC[m[1]];
  if (m[2] === '#') rootPc += 1;
  if (m[2] === 'b') rootPc -= 1;
  rootPc = ((rootPc % 12) + 12) % 12;

  let q = m[3].trim();
  // Normalise common spellings to our quality keys.
  const map = {
    '': 'maj', 'M': 'maj', 'maj': 'maj', 'major': 'maj',
    'm': 'min', 'min': 'min', '-': 'min', 'minor': 'min',
    'dim': 'dim', '°': 'dim', 'o': 'dim', 'aug': 'aug', '+': 'aug',
    'sus2': 'sus2', 'sus4': 'sus4', 'sus': 'sus4',
    '6': '6', 'm6': 'm6', 'min6': 'm6',
    '7': 'dom7', 'dom7': 'dom7', 'maj7': 'maj7', 'M7': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7',
    'm7': 'min7', 'min7': 'min7', '-7': 'min7',
    'm7b5': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', 'dim7': 'dim7', '°7': 'dim7',
    'add9': 'add9', '9': 'dom9', 'maj9': 'maj9', 'M9': 'maj9', 'm9': 'min9', 'min9': 'min9',
  };
  const quality = map[q] != null ? map[q] : 'maj';
  const offsets = CHORD_QUALITIES[quality].slice();
  return { rootPc, offsets, label: sym.trim() };
}

function romanToDegree(token) {
  // token like "ii", "IV", "vii" — return 0-based degree, or null.
  const core = token.match(/^[ivxIVX]+/);
  if (!core) return null;
  const str = core[0].toLowerCase();
  let val = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = ROMAN[str[i]] || 0;
    const next = ROMAN[str[i + 1]] || 0;
    val += cur < next ? -cur : cur;
  }
  return val >= 1 && val <= 7 ? val - 1 : null;
}

// Map a roman-numeral quality suffix to a CHORD_QUALITIES key. `upper` (the
// numeral was uppercase) selects the default for ambiguous suffixes — "7" is a
// dominant 7th on a major numeral (V7) but a minor 7th on a lowercase one (ii7).
// Returns null for an empty/unknown suffix → caller uses a triad by numeral case.
function romanQuality(suffix, upper) {
  const map = {
    'm': 'min', 'min': 'min', '-': 'min', 'maj': 'maj', 'M': 'maj',
    'maj7': 'maj7', 'M7': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', 'ma7': 'maj7',
    '7': upper ? 'dom7' : 'min7', 'dom7': 'dom7', 'm7': 'min7', 'min7': 'min7', '-7': 'min7',
    '6': upper ? '6' : 'm6', 'm6': 'm6',
    'maj9': 'maj9', 'M9': 'maj9', '9': upper ? 'dom9' : 'min9', 'm9': 'min9', 'min9': 'min9', 'add9': 'add9',
    'sus2': 'sus2', 'sus4': 'sus4', 'sus': 'sus4',
    'dim': 'dim', '°': 'dim', 'o': 'dim', 'dim7': 'dim7', '°7': 'dim7',
    'ø': 'm7b5', 'ø7': 'm7b5', 'm7b5': 'm7b5', 'aug': 'aug', '+': 'aug',
  };
  const q = map[suffix.trim()];
  return q !== undefined ? q : null;
}

// Resolve a roman-numeral token to a chord. Plain diatonic numerals (no accidental,
// no explicit quality) keep the original behaviour of stacking the scale's own
// thirds. An accidental prefix and/or a quality suffix switches to a chromatic
// reading so borrowed chords and explicit qualities work and still transpose.
function parseRoman(body, rootPc, scaleKey) {
  const m = body.match(/^([b#]?)([ivxIVX]+)(.*)$/);
  if (!m) return null;
  const [, acc, numeral, suffix] = m;
  const deg = romanToDegree(numeral);
  if (deg == null) return null;
  const upper = numeral === numeral.toUpperCase();
  const quality = romanQuality(suffix, upper);

  if (!acc && quality == null) {                       // unchanged diatonic path
    const dc = diatonicChord(rootPc, scaleKey, deg);
    return { ...dc, label: body };
  }
  const shift = acc === 'b' ? -1 : acc === '#' ? 1 : 0; // chromatic / explicit path
  const chordRootPc = (((rootPc + MAJOR_DEG[deg] + shift) % 12) + 12) % 12;
  const q = quality || (upper ? 'maj' : 'min');
  const offsets = (CHORD_QUALITIES[q] || CHORD_QUALITIES.maj).slice();
  // `chromatic` marks borrowed / secondary chords so the melody can switch to the
  // chord's own scale for passing tones (see chordScaleIntervals).
  return { rootPc: chordRootPc, offsets, degree: deg, label: body, chromatic: true };
}

// The chord-scale (intervals from the chord root) implied by a chord's quality —
// inferred from its stacked offsets. Used to colour the lead's passing tones over
// borrowed/secondary chords (e.g. Mixolydian over a dom7, Lydian over a bVII).
export function chordScaleIntervals(chord) {
  const o = chord.offsets || [0, 4, 7];
  const third = o[1] != null ? o[1] : 4;
  const fifth = o[2] != null ? o[2] : 7;
  const seventh = o[3];
  if (third === 4) {                                   // major third
    if (seventh === 10) return [0, 2, 4, 5, 7, 9, 10]; // dom7 → Mixolydian
    if (fifth === 8) return [0, 2, 4, 6, 8, 10];       // aug → whole tone
    return [0, 2, 4, 6, 7, 9, 11];                     // maj → Lydian (bright, no avoid-4)
  }
  if (third === 3) {                                   // minor third
    if (fifth === 6) return [0, 2, 3, 5, 6, 8, 9, 11]; // dim → whole-half diminished
    return [0, 2, 3, 5, 7, 9, 10];                     // min(7) → Dorian
  }
  if (third === 2 || third === 5) return [0, 2, 4, 5, 7, 9, 10]; // sus → Mixolydian
  return [0, 2, 4, 5, 7, 9, 11];                                 // default Ionian
}

// Parse a progression string into [{ chord, label, bars }].
// Tokens may be chord symbols ("Cmaj7") or roman numerals ("I", "vi"); each
// optionally suffixed with ":bars" (e.g. "I:2"). Roman numerals resolve against
// the current key+scale so they stay diatonic. Separators: whitespace, comma, or |.
export function parseProgression(str, rootPc, scaleKey) {
  const tokens = (str || '').split(/[\s,|]+/).filter(Boolean);
  const out = [];
  for (const tok of tokens) {
    const [body, barStr] = tok.split(':');
    const bars = Math.max(1, parseInt(barStr, 10) || 1);
    let chord;
    if (/^[A-G]/.test(body)) {
      const parsed = parseChordSymbol(body);
      if (!parsed) continue;
      chord = parsed;
    } else {
      const parsed = parseRoman(body, rootPc, scaleKey);
      if (!parsed) continue;
      chord = parsed;
    }
    out.push({ chord, label: chord.label || body, bars });
  }
  if (out.length === 0) {
    // Fallback: a single tonic chord.
    const dc = diatonicChord(rootPc, scaleKey, 0);
    out.push({ chord: { ...dc, label: 'I' }, label: 'I', bars: 1 });
  }
  return out;
}

// Lowest MIDI note >= baseMidi that has the given pitch class.
export function pcAtOrAbove(pc, baseMidi) {
  pc = ((pc % 12) + 12) % 12;
  let n = baseMidi - (((baseMidi % 12) + 12) % 12) + pc;
  if (n < baseMidi) n += 12;
  return n;
}

// Concrete MIDI notes for a chord, voiced upward from `baseMidi`.
export function chordTones(chord, baseMidi, maxNotes = 4) {
  const rootMidi = pcAtOrAbove(chord.rootPc, baseMidi);
  return chord.offsets.slice(0, maxNotes).map((o) => rootMidi + o);
}

// Pitch-class set for a chord (first `n` tones — use 3 for a clean triad).
export function chordPcSet(chord, n = 4) {
  return new Set(chord.offsets.slice(0, n).map((o) => (chord.rootPc + o) % 12));
}
