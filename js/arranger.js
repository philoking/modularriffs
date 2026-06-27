// arranger.js — "Generate" + endless extension.
//
// A song is state.blocks = [{ type, role, prog, bars }, ...] — each block its own
// editable instance. Generation now starts from a real BLUEPRINT (a per-section
// chord progression + a realistic section order, from library.js), instantiates it
// in the current key/scale, and MUTATES it by an amount set by the Evolve slider
// (low = faithful to the blueprint, high = derivative). extendSong() keeps cycling
// the blueprint's loop (freshly mutated) so playback composes forward forever.
// The per-bar global arrays (song / intensity / mutes) are materialised alongside.
//
// If no blueprint fits the chosen style, we fall back to the original procedural
// FAMILIES generator (kept below) so generation always succeeds.

import { makeRng } from './generator.js';
import { parseProgression } from './theory.js';
import { BLUEPRINTS } from './library.js';

const MINOR_SCALES = new Set(['minor', 'dorian', 'phrygian', 'locrian', 'harmonicMinor', 'melodicMinor', 'minorPent', 'blues']);
const flavor = (scaleKey) => (MINOR_SCALES.has(scaleKey) ? 'minor' : 'major');

const ALL_PARTS = ['pad', 'bass', 'melody', 'alt'];
const clamp = (v) => Math.max(0, Math.min(1, v));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---- role tables: every blueprint section role maps to a colour/type, an
// intensity default, which parts play, and a last-resort bar length. -----------
const ROLE_INT = {
  intro: 0.28, verse: 0.50, prechorus: 0.64, chorus: 0.82, drop: 0.92,
  build: 0.60, bridge: 0.42, breakdown: 0.30, outro: 0.30, a: 0.55, b: 0.72,
};
const ROLE_TYPE = {   // A/B/C only drive the editor's colour + section letter
  intro: 'A', verse: 'A', prechorus: 'A', chorus: 'B', drop: 'B',
  build: 'C', bridge: 'C', breakdown: 'C', outro: 'A', a: 'A', b: 'B',
};
const PLAY = {
  intro: ['pad', 'melody'],
  verse: ['pad', 'bass', 'melody'],
  prechorus: ['pad', 'bass', 'melody', 'alt'],
  chorus: ['pad', 'bass', 'melody', 'alt'],
  drop: ['pad', 'bass', 'melody', 'alt'],
  build: ['pad', 'melody', 'alt'],
  bridge: ['pad', 'alt'],
  breakdown: ['pad'],
  outro: ['pad'],
  a: ['pad', 'bass', 'melody'],
  b: ['pad', 'bass', 'melody', 'alt'],
};
const ROLE_BARS = { intro: 2, verse: 4, prechorus: 2, chorus: 4, drop: 8, build: 4, bridge: 4, breakdown: 4, outro: 2, a: 8, b: 8 };

// ---- progression mutation (the "derive from a known-good source" core) --------
// Plain diatonic romans are swapped within their functional group (tonic /
// subdominant / dominant), occasionally given a passing 7th. Tokens with an
// accidental or an explicit quality (7, maj7, …) are left untouched so jazz/bossa
// voicings survive. The first chord is always kept so the section stays
// recognisable. evolve=0 returns the progression verbatim.
const NUM = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
const MAJOR_LABELS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
const MINOR_LABELS = ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'];
const GROUPS = [[0, 2, 5], [1, 3], [4, 6]]; // tonic, subdominant, dominant
const groupOf = (d) => GROUPS.find((g) => g.includes(d)) || [d];
// Idiom classes for style-gated mutation (7.8).
const JAZZY = new Set(['jazz', 'bossa', 'soul', 'gospel']);
const POPPY = new Set(['ballad', 'rock', 'folk', 'country', 'synthwave', 'lofi', 'reggae', 'disco', 'pop']);

function mutateProg(progStr, evolve, rng, minor, style) {
  if (!evolve || evolve <= 0.001) return progStr;
  const labels = minor ? MINOR_LABELS : MAJOR_LABELS;
  const toks = String(progStr).split(/\s+/).filter(Boolean);
  const subProb = evolve * 0.5;
  const maxSubs = Math.max(1, Math.round(evolve * toks.length * 0.6));
  const last = toks.length - 1;
  let subs = 0;
  // Functional substitution pass — keep the first AND last chord so the section's
  // opening and its cadence stay intact (7.3 cadence protection).
  const out = toks.map((tok, i) => {
    if (i === 0 || i === last) return tok;
    const [body, bar] = tok.split(':');
    const deg = NUM[body.toLowerCase()];
    if (deg === undefined) return tok;                // skip 7ths / borrowed chords
    if (subs >= maxSubs || rng() >= subProb) return tok;
    subs++;
    let nb;
    if (rng() < 0.25) {
      nb = body + '7';                                // passing seventh
    } else {
      const sibs = groupOf(deg).filter((d) => d !== deg);
      nb = labels[sibs.length ? sibs[Math.floor(rng() * sibs.length)] : deg];
    }
    return bar ? `${nb}:${bar}` : nb;
  });

  // Idiom-aware operators at high Evolve, gated by style (7.8): tritone subs for
  // jazz-family, the borrowed minor iv for pop-family. Cadence chords left alone.
  if (evolve > 0.6 && (JAZZY.has(style) || POPPY.has(style))) {
    const idiomProb = (evolve - 0.6) * 1.2;
    for (let i = 1; i < last; i++) {
      if (rng() >= idiomProb) continue;
      const [body, bar] = out[i].split(':');
      const lo = body.toLowerCase();
      let nb = null;
      if (JAZZY.has(style) && (lo === 'v' || lo === 'v7')) nb = 'bII7';   // tritone substitution
      else if (POPPY.has(style) && body === 'IV') nb = 'ivm';            // borrowed minor iv
      if (nb) out[i] = bar ? `${nb}:${bar}` : nb;
    }
  }
  return out.join(' ');
}

function flatten(prog, state) {
  const flat = [];
  for (const e of prog) for (let b = 0; b < e.bars; b++) flat.push({ chord: e.chord, label: e.label });
  if (!flat.length) flat.push({ chord: { rootPc: state.rootPc, offsets: [0, 3, 7], label: 'i' }, label: 'i' });
  return flat;
}

// Append one block from an explicit role + progression, materialising its bars,
// intensity and per-part mutes. `desiredBars` (a blueprint barsPer override) sets
// the block length and the progression cycles to fill it.
function appendRoleBlock(state, role, rawProg, rng, desiredBars) {
  const idx = state.blocks.length;
  const minor = flavor(state.scaleKey) === 'minor';
  const prog = mutateProg(rawProg, state.evolve || 0, rng, minor, state.style);
  const type = ROLE_TYPE[role] || 'A';
  const flat = flatten(parseProgression(prog, state.rootPc, state.scaleKey), state);
  const bars = desiredBars && desiredBars > 0 ? desiredBars : (flat.length || ROLE_BARS[role] || 4);
  state.blocks.push({ type, role, prog, srcProg: rawProg, bars }); // srcProg = pristine source for reroll

  const startBar = state.song.length;
  for (let b = 0; b < bars; b++) {
    const c = flat[b % flat.length];
    state.song.push({ chord: c.chord, label: c.label, section: type, inst: idx });
  }
  const endBar = state.song.length - 1;

  const lvl = clamp((ROLE_INT[role] ?? 0.5) + 0.05 * Math.sin(idx * 0.5) + (rng() - 0.5) * 0.05);
  for (let b = startBar; b <= endBar; b++) state.intensity[b] = lvl;
  if (startBar > 0 && lvl > state.intensity[startBar - 1]) {
    state.intensity[startBar - 1] = clamp((state.intensity[startBar - 1] + lvl) / 2 + 0.05);
  }

  const play = new Set(PLAY[role] || ALL_PARTS);
  for (const k of ALL_PARTS) {
    if (!state.mutes[k]) state.mutes[k] = new Set();
    if (!play.has(k)) for (let b = startBar; b <= endBar; b++) state.mutes[k].add(b);
  }
}

// Choose a blueprint: a pinned one (state.blueprint id) if set, else auto — prefer
// blueprints tagged for the current style, biased to the chosen scale's flavour.
function pickBlueprint(state, rng) {
  const sel = state.blueprint;
  if (sel && sel !== 'auto') {
    const found = BLUEPRINTS.find((b) => b.id === sel);
    if (found) return found;
  }
  const fl = flavor(state.scaleKey);
  let cands = BLUEPRINTS.filter((b) => b.styles.includes(state.style));
  if (!cands.length) cands = BLUEPRINTS.filter((b) => b.mode === fl || b.mode === 'any');
  if (!cands.length) cands = BLUEPRINTS;
  const matched = cands.filter((b) => b.mode === fl || b.mode === 'any');
  const pool = matched.length ? matched : cands;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}

function resetSong(state) {
  state.blocks = [];
  state.song = [];
  state.intensity = [];
  for (const k of ALL_PARTS) state.mutes[k] = new Set();
  state.selectedBlock = 0;
}

export function generateSong(state) {
  // If any block is locked, "Regenerate" varies the current form in place rather
  // than picking a whole new blueprint — so the locked sections truly survive.
  if ((state.blocks || []).some((b) => b.locked)) { regenerateUnlocked(state); return; }
  const rng = makeRng(state.seed);
  const bp = pickBlueprint(state, rng);
  if (!bp) { generateSongFallback(state); return; }
  resetSong(state);
  state.family = null;
  state.blueprintId = bp.id;
  for (const role of bp.structure) {
    appendRoleBlock(state, role, bp.sections[role] || 'i', rng, bp.barsPer && bp.barsPer[role]);
  }
  state.formState = { blueprintId: bp.id, loopPtr: 0 };
}

// Vary the current form in place: reroll every UNLOCKED block's progression from
// its blueprint source, keeping the structure, lengths and locked blocks intact.
// (Caller rematerialises with buildSong.)
export function regenerateUnlocked(state) {
  const minor = flavor(state.scaleKey) === 'minor';
  const n = (state.regenN = (state.regenN || 0) + 1);
  state.blocks.forEach((b, i) => {
    if (b.locked) return;
    const rng = makeRng(`${state.seed}:regen:${n}:${i}`);
    b.prog = mutateProg(b.srcProg || b.prog, Math.max(0.4, state.evolve || 0), rng, minor, state.style);
  });
}

// Reroll one block's progression — a fresh variation from its pristine source.
// Locked blocks are left untouched.
export function rerollBlock(state, inst) {
  const b = state.blocks[inst];
  if (!b || b.locked) return;
  const minor = flavor(state.scaleKey) === 'minor';
  const n = (b.rerollN = (b.rerollN || 0) + 1);
  const rng = makeRng(`${state.seed}:reroll:${inst}:${n}`);
  b.prog = mutateProg(b.srcProg || b.prog, Math.max(0.35, state.evolve || 0), rng, minor, state.style);
}

// Duplicate a block, inserting the copy immediately after it. Its intensity slice
// and per-part mute pattern are copied; trailing bars shift right. (Caller rebuilds.)
export function insertBlock(state, srcInst) {
  const src = state.blocks[srcInst];
  if (!src) return;
  const srcStart = blockStartOf(state, srcInst);
  const bars = src.bars;
  const startBar = srcStart + bars;
  const clone = { ...src };
  delete clone.locked;       // the copy starts unlocked
  delete clone.rerollN;
  state.blocks.splice(srcInst + 1, 0, clone);
  const slice = state.intensity.slice(srcStart, srcStart + bars);
  while (slice.length < bars) slice.push(slice.length ? slice[slice.length - 1] : 0.5);
  state.intensity = [...state.intensity.slice(0, startBar), ...slice, ...state.intensity.slice(startBar)];
  for (const k of ALL_PARTS) {
    const set = state.mutes[k];
    if (!set) continue;
    const ns = new Set();
    for (const b of set) ns.add(b >= startBar ? b + bars : b);
    for (let i = 0; i < bars; i++) if (set.has(srcStart + i)) ns.add(startBar + i);
    state.mutes[k] = ns;
  }
}

function blockStartOf(state, inst) {
  let s = 0;
  for (let i = 0; i < inst && i < state.blocks.length; i++) s += state.blocks[i].bars || 0;
  return s;
}

export function extendSong(state, count = 1) {
  const fs = state.formState || {};
  let bp = BLUEPRINTS.find((b) => b.id === fs.blueprintId);
  if (!bp) { extendSongFallback(state, count); return; }
  const rng = makeRng(`${state.seed}:ext:${state.blocks.length}`);
  let ptr = fs.loopPtr || 0;
  const loop = (bp.loop && bp.loop.length) ? bp.loop : bp.structure;
  for (let n = 0; n < count; n++) {
    const role = loop[ptr % loop.length];
    appendRoleBlock(state, role, bp.sections[role] || 'i', rng, bp.barsPer && bp.barsPer[role]);
    ptr++;
    if (ptr % (loop.length * 3) === 0 && rng() < 0.5) {  // wander to a fresh blueprint occasionally
      const nb = pickBlueprint(state, rng);
      if (nb) { bp = nb; ptr = 0; }
    }
  }
  state.formState = { blueprintId: bp.id, loopPtr: ptr };
}

// =====================================================================
// Fallback: the original procedural FAMILIES generator (used only when no
// blueprint matches). Kept intact so generation never fails.
// =====================================================================
const FAMILIES = {
  minor: [
    { A: 'i VI III VII', B: 'VI VII i i',   C: 'iv VII III VI' },
    { A: 'i VII VI VII', B: 'iv v i i',     C: 'VI III iv V' },
    { A: 'i iv VI v',    B: 'VI VII i v',   C: 'III VII i i' },
    { A: 'i VI iv v',    B: 'VII VI VII i', C: 'iv i v VI' },
  ],
  major: [
    { A: 'I V vi IV',  B: 'vi IV I V',  C: 'ii V I vi' },
    { A: 'I vi IV V',  B: 'IV V I vi',  C: 'ii IV V V' },
    { A: 'vi IV I V',  B: 'I V vi IV',  C: 'IV I V vi' },
    { A: 'I iii IV V', B: 'vi V IV V',  C: 'ii V I I' },
  ],
};
const FB_SECTION = { intro: 'A', verse: 'A', chorus: 'B', bridge: 'C' };
const INITIAL_INSTANCES = 7;

function nextRole(fs, rng) {
  if (fs.i === 0) return 'intro';
  fs.sinceBridge = (fs.sinceBridge || 0) + 1;
  const last = fs.lastRole;
  if (fs.sinceBridge >= 6 && rng() < 0.5 && last !== 'bridge') { fs.sinceBridge = 0; return 'bridge'; }
  if (last === 'intro') return 'verse';
  if (last === 'bridge') return 'chorus';
  if (last === 'verse') return rng() < 0.78 ? 'chorus' : 'verse';
  if (last === 'chorus') return rng() < 0.7 ? 'verse' : 'chorus';
  return 'verse';
}

function appendInstanceFallback(state) {
  const idx = state.blocks.length;
  const rng = makeRng(state.seed + ':' + idx);
  const role = nextRole(state.formState, rng);
  const type = FB_SECTION[role];
  const progStr = (state.family && state.family[type]) || 'i';
  appendRoleBlock(state, role, progStr, rng);
  state.blocks[idx].role = role; // keep the richer role label
  state.formState.i = idx + 1;
  state.formState.lastRole = role;
}

function generateSongFallback(state) {
  const rng = makeRng(state.seed);
  const fam = pick(rng, FAMILIES[flavor(state.scaleKey)]);
  state.family = { A: fam.A, B: fam.B, C: fam.C };
  resetSong(state);
  state.formState = { i: 0, lastRole: null, sinceBridge: 0 };
  for (let n = 0; n < INITIAL_INSTANCES; n++) appendInstanceFallback(state);
}

function extendSongFallback(state, count = 1) {
  if (!state.family) state.family = { A: 'i VI III VII', B: 'VI VII i i', C: 'iv VII III VI' };
  if (!state.formState || state.formState.i == null) state.formState = { i: state.blocks.length, lastRole: null, sinceBridge: 0 };
  for (let n = 0; n < count; n++) appendInstanceFallback(state);
}
