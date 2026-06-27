// library.js — the "real starting points" the generator mutates from.
//
// Two data-only exports:
//   • BLUEPRINTS — song blueprints: a per-section chord progression (in roman
//     numerals, so they transpose to any key/scale) plus a realistic section
//     ORDER. The arranger instantiates one in the chosen key and then mutates it
//     by an amount set by the Evolve slider.
//   • MOTIFS — archetypal melodic cells the lead engine states and develops.
//
// PROVENANCE / IP: chord progressions and song structures are generic musical
// building blocks (not copyrightable). Blueprints are named by type/era, never
// tied to a specific recording. The motifs are archetypal CONTOURS — arch,
// gap-fill, neighbour-tone, pentatonic riff, call-and-response — and public-domain
// folk idioms encoded as scale-degree arrays, NOT transcriptions of copyrighted
// melodies. Keep it that way as the library grows.
//
// Roles used below (the arranger maps each to a colour, intensity and which parts
// play): intro, verse, prechorus, chorus, drop, build, bridge, breakdown, outro,
// and a/b (for AABA-style forms). `mode` is the tonal flavour a blueprint assumes
// ('major' | 'minor' | 'any') — the arranger prefers blueprints whose mode matches
// the chosen scale. A section's bar length is the natural length of its
// progression (sum of `:N` bars), unless `barsPer` overrides it.

export const BLUEPRINTS = [
  // ---------------- major, song-form ----------------
  {
    id: 'pop-vcvc', name: 'Verse–Chorus pop', mode: 'major',
    styles: ['ballad', 'rock', 'synthwave', 'country', 'folk', 'lofi', 'soul'],
    sections: {
      intro: 'vi IV', verse: 'I V vi IV', prechorus: 'IV V',
      chorus: 'I V vi IV', bridge: 'vi IV I V', outro: 'I:2',
    },
    structure: ['intro', 'verse', 'prechorus', 'chorus', 'verse', 'prechorus', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'prechorus', 'chorus'],
  },
  {
    id: 'doowop-50s', name: '50s doo-wop', mode: 'major',
    styles: ['ballad', 'soul', 'folk', 'rock'],
    sections: {
      intro: 'I vi', verse: 'I vi IV V', chorus: 'I vi IV V', bridge: 'IV V iii vi', outro: 'I:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },
  {
    id: 'rock-anthem', name: 'Rock anthem', mode: 'major',
    styles: ['rock', 'metal', 'synthwave', 'country', 'folk'],
    sections: {
      intro: 'I V', verse: 'I IV V IV', prechorus: 'vi IV',
      chorus: 'I V vi IV', bridge: 'IV V vi I', outro: 'I:2',
    },
    structure: ['intro', 'verse', 'prechorus', 'chorus', 'verse', 'prechorus', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'prechorus', 'chorus'],
  },
  {
    id: 'folk-three', name: 'Three-chord folk', mode: 'major',
    styles: ['folk', 'country', 'blues', 'rock', 'reggae'],
    sections: {
      intro: 'I:2', verse: 'I IV I V', chorus: 'I IV V I', bridge: 'IV I V V', outro: 'I:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },

  // ---------------- jazz / bossa (7th-chord colour) ----------------
  {
    id: 'aaba-standard', name: 'AABA standard', mode: 'major',
    styles: ['jazz', 'ballad', 'soul', 'bossa'],
    sections: {
      a: 'Imaj7 vi7 ii7 V7', b: 'III7 VI7 II7 V7', outro: 'Imaj7:2',
    },
    structure: ['a', 'a', 'b', 'a', 'a', 'b', 'a', 'outro'],
    loop: ['a', 'a', 'b', 'a'],
  },
  {
    id: 'jazz-twofive', name: 'ii–V–I cycle', mode: 'major',
    styles: ['jazz', 'bossa', 'soul', 'lofi'],
    sections: {
      a: 'ii7 V7 Imaj7 VI7', b: 'iii7 VI7 ii7 V7', outro: 'Imaj7:2',
    },
    structure: ['a', 'a', 'b', 'a', 'outro'],
    loop: ['a', 'b'],
  },
  {
    id: 'bossa-nova', name: 'Bossa ii–V chains', mode: 'major',
    styles: ['bossa', 'jazz', 'soul'],
    sections: {
      intro: 'Imaj7:2', verse: 'Imaj7 ii7 V7 Imaj7', chorus: 'vi7 ii7 V7 Imaj7',
      bridge: 'iv7 bVII7 Imaj7 V7', outro: 'Imaj7:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },
  {
    id: 'gospel', name: 'Gospel cycle', mode: 'major',
    styles: ['gospel', 'soul'],
    sections: {
      intro: 'I IV', verse: 'I iii IV V', chorus: 'I III7 vi IV',
      bridge: 'ii7 V7 I VI7', outro: 'I IV I:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },

  // ---------------- blues ----------------
  {
    id: 'twelvebar-blues', name: '12-bar blues', mode: 'major',
    styles: ['blues', 'rock', 'country', 'soul'],
    sections: {
      verse: 'I7:4 IV7:2 I7:2 V7 IV7 I7 V7',   // canonical 12-bar with turnaround
    },
    structure: ['verse', 'verse', 'verse', 'verse'],
    loop: ['verse'],
  },

  // ---------------- minor / club / cinematic ----------------
  {
    id: 'edm-builddrop', name: 'EDM build–drop', mode: 'minor',
    styles: ['house', 'techno', 'trance', 'dnb'],
    sections: {
      intro: 'i:2 VI:2', build: 'i VI III VII', drop: 'i VI III VII',
      breakdown: 'VI VII i:2', outro: 'i:2',
    },
    structure: ['intro', 'build', 'drop', 'breakdown', 'build', 'drop', 'outro'],
    loop: ['build', 'drop', 'breakdown'],
  },
  {
    id: 'minor-vamp', name: 'Minor club vamp', mode: 'minor',
    styles: ['house', 'techno', 'trance', 'afrobeat', 'disco'],
    sections: {
      intro: 'i:2', verse: 'i VII VI VII', chorus: 'i VI III VII', outro: 'i:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },
  {
    id: 'cinematic-epic', name: 'Cinematic minor epic', mode: 'minor',
    styles: ['cinematic', 'metal', 'trance'],
    sections: {
      intro: 'i:2 VI:2', verse: 'i VI III VII', build: 'iv VII III VI',
      chorus: 'VI VII i:2', bridge: 'III VII i V7', outro: 'i:4',
    },
    structure: ['intro', 'verse', 'chorus', 'build', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus', 'build'],
  },
  {
    id: 'andalusian', name: 'Andalusian cadence', mode: 'minor',
    styles: ['metal', 'cinematic', 'folk', 'rock'],
    sections: {
      intro: 'i VII', verse: 'i VII VI V7', chorus: 'i VII VI V7',
      bridge: 'III VII i V7', outro: 'i:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },
  {
    id: 'trap-loop', name: 'Trap minor loop', mode: 'minor',
    styles: ['trap', 'dnb'],
    sections: {
      intro: 'i:2', verse: 'i:2 VI:2', chorus: 'iv:2 VI:2', outro: 'i:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'verse', 'outro'],
    loop: ['verse', 'chorus'],
  },

  // ---------------- groove (one-chord vamps + turnarounds) ----------------
  {
    id: 'funk-vamp', name: 'Funk one-chord vamp', mode: 'minor',
    styles: ['funk', 'afrobeat', 'soul', 'disco'],
    sections: {
      intro: 'i7', verse: 'i7', chorus: 'i7:2 IV7:2', bridge: 'bVII7:2 IV7:2', outro: 'i7',
    },
    barsPer: { intro: 2, verse: 8, outro: 2 },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },
  {
    id: 'disco-four', name: 'Disco four-on-the-floor', mode: 'minor',
    styles: ['disco', 'house', 'funk'],
    sections: {
      intro: 'i7:2', verse: 'i7 IV7 i7 V7', chorus: 'i7 VI7 ii7 V7', outro: 'i7:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },
  {
    id: 'reggae-skank', name: 'Reggae one-drop', mode: 'major',
    styles: ['reggae'],
    sections: {
      intro: 'I:2', verse: 'I IV', chorus: 'I V vi IV', bridge: 'IV V', outro: 'I:2',
    },
    structure: ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    loop: ['verse', 'chorus'],
  },

  // ---------------- ambient / drone ----------------
  {
    id: 'ambient-drift', name: 'Ambient drift', mode: 'minor',
    styles: ['ambient', 'drone', 'cinematic'],
    sections: {
      intro: 'i:2', a: 'i:2 VI:2', b: 'VII:2 III:2', outro: 'i:4',
    },
    structure: ['intro', 'a', 'b', 'a', 'b', 'a', 'outro'],
    loop: ['a', 'b'],
  },
];

// Archetypal melodic cells the lead engine states and develops. Each is a
// `rhythm` (the {step,dur} 16th-note cell format the generator already uses) plus
// a `degrees` contour (scale-degree offsets from an anchor; renderMotif maps these
// to actual notes and snaps the downbeat to a chord tone). These are generic
// CONTOURS (arch, gap-fill, neighbour, pentatonic riff, call-and-response) and
// public-domain folk idioms — not transcriptions of copyrighted melodies.
export const MOTIFS = [
  // ---- sparse (2–3 notes) ----
  { tier: 'sparse', shape: 'rise',     rhythm: [{ step: 0, dur: 8 }, { step: 8, dur: 8 }],                       degrees: [0, 2] },
  { tier: 'sparse', shape: 'fall',     rhythm: [{ step: 0, dur: 12 }, { step: 12, dur: 4 }],                     degrees: [2, 0] },
  { tier: 'sparse', shape: 'neighbor', rhythm: [{ step: 0, dur: 6 }, { step: 8, dur: 8 }],                       degrees: [0, 1] },
  { tier: 'sparse', shape: 'leapfill', rhythm: [{ step: 0, dur: 8 }, { step: 8, dur: 8 }],                       degrees: [0, 4] },
  { tier: 'sparse', shape: 'pedal',    rhythm: [{ step: 0, dur: 6 }, { step: 8, dur: 6 }],                       degrees: [0, 0] },
  { tier: 'sparse', shape: 'sigh',     rhythm: [{ step: 0, dur: 8 }, { step: 8, dur: 8 }],                       degrees: [2, -1] },
  { tier: 'sparse', shape: 'arch3',    rhythm: [{ step: 0, dur: 6 }, { step: 6, dur: 2 }, { step: 8, dur: 8 }],  degrees: [0, 2, 1] },

  // ---- medium (3–4 notes) ----
  { tier: 'medium', shape: 'arch',     rhythm: [{ step: 0, dur: 4 }, { step: 4, dur: 4 }, { step: 8, dur: 8 }],                   degrees: [0, 2, 1] },
  { tier: 'medium', shape: 'risefill', rhythm: [{ step: 0, dur: 4 }, { step: 4, dur: 4 }, { step: 8, dur: 4 }, { step: 12, dur: 4 }], degrees: [0, 1, 2, 3] },
  { tier: 'medium', shape: 'gapfill',  rhythm: [{ step: 0, dur: 4 }, { step: 4, dur: 4 }, { step: 8, dur: 8 }],                   degrees: [0, 4, 2] },
  { tier: 'medium', shape: 'wave',     rhythm: [{ step: 0, dur: 6 }, { step: 6, dur: 2 }, { step: 8, dur: 6 }, { step: 14, dur: 2 }], degrees: [0, 1, 2, 1] },
  { tier: 'medium', shape: 'callresp', rhythm: [{ step: 0, dur: 3 }, { step: 4, dur: 4 }, { step: 8, dur: 4 }, { step: 12, dur: 4 }], degrees: [0, 2, 0, -1] },
  { tier: 'medium', shape: 'turn',     rhythm: [{ step: 0, dur: 4 }, { step: 6, dur: 2 }, { step: 8, dur: 4 }, { step: 12, dur: 4 }], degrees: [0, 1, 0, -1] },
  { tier: 'medium', shape: 'descend',  rhythm: [{ step: 0, dur: 4 }, { step: 4, dur: 4 }, { step: 8, dur: 4 }, { step: 12, dur: 4 }], degrees: [3, 2, 1, 0] },
  { tier: 'medium', shape: 'cambiata', rhythm: [{ step: 0, dur: 4 }, { step: 4, dur: 4 }, { step: 8, dur: 8 }],                   degrees: [0, 2, -1] },

  // ---- busy (6 notes) ----
  { tier: 'busy', shape: 'runup',     rhythm: [{ step: 0, dur: 2 }, { step: 2, dur: 2 }, { step: 4, dur: 4 }, { step: 8, dur: 2 }, { step: 10, dur: 2 }, { step: 12, dur: 4 }], degrees: [0, 1, 2, 3, 4, 5] },
  { tier: 'busy', shape: 'archbusy',  rhythm: [{ step: 0, dur: 3 }, { step: 3, dur: 3 }, { step: 6, dur: 2 }, { step: 8, dur: 3 }, { step: 11, dur: 3 }, { step: 14, dur: 2 }], degrees: [0, 1, 2, 3, 2, 1] },
  { tier: 'busy', shape: 'zigzag',    rhythm: [{ step: 0, dur: 2 }, { step: 4, dur: 2 }, { step: 6, dur: 2 }, { step: 8, dur: 4 }, { step: 12, dur: 2 }, { step: 14, dur: 2 }], degrees: [0, 2, 1, 3, 2, 4] },
  { tier: 'busy', shape: 'pentriff',  rhythm: [{ step: 0, dur: 2 }, { step: 2, dur: 2 }, { step: 4, dur: 4 }, { step: 8, dur: 2 }, { step: 10, dur: 2 }, { step: 12, dur: 4 }], degrees: [0, 2, 4, 2, 0, -1] },
  { tier: 'busy', shape: 'descfill',  rhythm: [{ step: 0, dur: 3 }, { step: 3, dur: 3 }, { step: 6, dur: 2 }, { step: 8, dur: 3 }, { step: 11, dur: 3 }, { step: 14, dur: 2 }], degrees: [4, 3, 2, 1, 0, -1] },
  { tier: 'busy', shape: 'neighbusy', rhythm: [{ step: 0, dur: 2 }, { step: 4, dur: 2 }, { step: 6, dur: 2 }, { step: 8, dur: 4 }, { step: 12, dur: 2 }, { step: 14, dur: 2 }], degrees: [0, 1, 0, -1, 0, 1] },
];
