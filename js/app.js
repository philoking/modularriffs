// app.js — entry point. Owns the shared `state`, builds the UI, and wires the
// MIDI output, internal synth, generator, and transport together.

import { NOTE_NAMES, SCALES, parseProgression, diatonicChord, pcName } from './theory.js';
import { JamGenerator, STYLES, PROGRESSIONS } from './generator.js';
import { MidiOut } from './midi.js';
import { Synth } from './synth.js';
import { Transport } from './scheduler.js';
import { initTimeline } from './timeline.js';
import { resample } from './intensity.js';
import { generateSong, extendSong, rerollBlock, insertBlock } from './arranger.js';
import { BLUEPRINTS } from './library.js';
import { buildTimelineMidi } from './export-midi.js';

// ---- shared state (mutated live by the UI; read each bar by the generator) ----
const state = {
  rootPc: 9,            // A
  scaleKey: 'minor',
  bpm: 84,
  swing: 0,
  energy: 0.5,        // global intensity ride (0.5 = sections as authored)
  evolve: 0.4,
  blueprint: 'auto',    // 'auto' (style picks one) or a BLUEPRINTS id to pin
  melodySalt: 0,        // bumped by "Reroll melodies only" to re-seed just the lead/arp
  seed: 'modular',
  sendClock: true,
  bassStyle: 'roots',
  arpDir: 'up',
  padMode: 'note',      // 'note' = mono drone | 'chord' = full chord stacked on the pad channel
  style: 'cinematic',
  vol: 0.8,
  rev: 0,               // bumped on song/intensity/mute changes (timeline change-detection)
  family: { A: 'i VI III VII', B: 'VI VII i i', C: 'iv VII III VI' }, // default chords per type (new blocks)
  blocks: [],                                                  // arrangement: independent blocks {type, prog, bars}
  selectedBlock: 0,                                            // which block the editor focuses
  pendingEdits: [],                                            // armed structural edits, applied at the next bar (not serialised)
  song: [],                                                    // materialised per-bar timeline (derived from blocks)
  intensity: [],                                               // per-bar base intensity (0..1)
  // Each track routes independently: output 'synth' = internal synth, otherwise a
  // MIDI port id. channel (0-15) applies when routed to a port. Default to the
  // synth on distinct channels so a DAWless rig can spread tracks across gear.
  parts: {
    pad:    { enabled: true, output: 'synth', channel: 0, octave: 0, density: 0.30, velocity: 0.5, gate: 0.92 }, // mono pad
    bass:   { enabled: true, output: 'synth', channel: 1, octave: 0, density: 0.55, velocity: 0.7, gate: 0.7 },  // bassline
    melody: { enabled: true, output: 'synth', channel: 2, octave: 0, density: 0.60, velocity: 0.7, gate: 0.55 }, // arpeggiator
    alt:    { enabled: true, output: 'synth', channel: 3, octave: 0, density: 0.50, velocity: 0.7, gate: 0.7 },  // lead melody
  },
  // Per-bar mutes set from the timeline: each Set holds loop-bar indices where
  // that part is silenced (the generator skips it for those bars).
  mutes: { pad: new Set(), bass: new Set(), melody: new Set(), alt: new Set() },
};

const PART_LABELS = { pad: 'Pad', bass: 'Bassline', melody: 'Arpeggiator', alt: 'Melody' };

const midi = new MidiOut();
const synth = new Synth();
const generator = new JamGenerator(state);
let transport = null;
let running = false;
let paused = false;     // halted but holding position (resume vs start-over)
let midiEnabled = false;
const FR_KEY = 'modularriffs:onboarded'; // first-run checklist dismissal flag (declared up here so refreshFirstRun, called during the parts render, isn't in its TDZ)
// Live playback position shared with the Arrangement timeline (playhead).
const pos = { bar: 0, step: 0, atPerf: 0, stepMs: 60000 / state.bpm / 4, running: false };

const $ = (id) => document.getElementById(id);
// Brief click-confirmation pulse on a button (restarts on rapid clicks).
const flash = (el) => { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
const pct = (v) => `${Math.round(v * 100)}%`;
const swingLabel = (v) => (v < 0.02 ? 'straight' : v < 0.16 ? 'light' : v < 0.3 ? 'medium' : 'heavy');
const setStatus = (msg, isErr = false) => {
  const el = $('status');
  el.textContent = msg;
  el.parentElement.classList.toggle('err', isErr);
};

// Transport button states. The internal synth is always available, so Start is
// only blocked while already running; paused it reads "Resume". Stop halts or
// resets the cue to the top.
function updateStartEnabled() {
  const startBtn = $('btnStart');
  startBtn.disabled = running;
  startBtn.textContent = paused ? '▶ Resume'
    : (!running && (state.selectedBlock || 0) > 0 ? '▶ Play here' : '▶ Start');
  const pauseBtn = $('btnPause'); if (pauseBtn) pauseBtn.disabled = !running;
  const stopBtn = $('btnStop');
  if (stopBtn) stopBtn.disabled = !running && !paused && (state.selectedBlock || 0) === 0 && (pos.bar || 0) === 0;
}

// When stopped, the play cue follows the selected section so the playhead shows
// where ▶ will begin (selecting a section = choosing the start point).
function cueIfStopped() {
  if (running) return;
  paused = false;
  pos.bar = blockStart(state.selectedBlock || 0);
  pos.step = 0;
  updateStartEnabled();
  const blk = (state.blocks || [])[state.selectedBlock];
  if (blk) setStatus(`Cued to ${blk.type} · ${ROLE_NAME[blk.type] || ''} — press ▶ Play here to start from bar ${pos.bar + 1}.`);
}

function tonicChord() {
  const dc = diatonicChord(state.rootPc, state.scaleKey, 0);
  return { ...dc, label: 'I' };
}

const PARTS = ['pad', 'bass', 'melody', 'alt'];

// Materialise state.blocks into the per-bar song (re-keying chords for the current
// key/scale, cycling each block's progression to fill its bar length). Intensity is
// resampled to the new length; per-bar mutes are clamped.
function buildSong() {
  if (!state.blocks || !state.blocks.length) { generateSong(state); return; }
  const song = [];
  state.blocks.forEach((blk, inst) => {
    const prog = parseProgression(blk.prog || 'i', state.rootPc, state.scaleKey);
    const flat = [];
    for (const e of prog) for (let b = 0; b < e.bars; b++) flat.push({ chord: e.chord, label: e.label });
    if (!flat.length) flat.push({ chord: tonicChord(), label: 'I' });
    const len = Math.max(1, blk.bars || flat.length);
    for (let b = 0; b < len; b++) { const c = flat[b % flat.length]; song.push({ chord: c.chord, label: c.label, section: blk.type, inst }); }
  });
  if (!song.length) song.push({ chord: tonicChord(), label: 'I', section: 'A', inst: 0 });
  state.song = song;
  state.intensity = resample(state.intensity, song.length);
  for (const k of PARTS) {
    if (state.mutes[k]) state.mutes[k] = new Set([...state.mutes[k]].filter((b) => b < song.length));
  }
  state.rev = (state.rev || 0) + 1;
  refreshPartsContext();
}

// First absolute bar of a block (sum of preceding blocks' bar lengths).
function blockStart(inst) {
  let s = 0;
  for (let i = 0; i < inst && i < state.blocks.length; i++) s += state.blocks[i].bars || 0;
  return s;
}

// Resize one block's slice of the per-bar arrays in place, so changing a block's
// length preserves the other blocks' intensity/mutes (shifted, not reshaped).
function spliceBars(start, oldBars, newBars) {
  const slice = state.intensity.slice(start, start + oldBars);
  const newSlice = resample(slice, newBars);
  state.intensity = [...state.intensity.slice(0, start), ...newSlice, ...state.intensity.slice(start + oldBars)];
  const delta = newBars - oldBars;
  for (const k of PARTS) {
    if (!state.mutes[k]) continue;
    const ns = new Set();
    for (const b of state.mutes[k]) {
      if (b < start) ns.add(b);
      else if (b >= start + oldBars) ns.add(b + delta);
      else { const rel = b - start; if (rel < newBars) ns.add(start + rel); }
    }
    state.mutes[k] = ns;
  }
}

// Per-section muting now lives only on the timeline part lanes (click = bar,
// ⇧-click = whole section). The old per-card "chip" was removed; this stub keeps
// the existing call sites valid.
function refreshPartsContext() {}

// ---- select helpers ----
function fillSelect(el, entries, selected) {
  el.innerHTML = '';
  for (const [value, label] of entries) {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    if (String(value) === String(selected)) o.selected = true;
    el.appendChild(o);
  }
}

// The MIDI channel only applies when a track is routed to an interface.
function setChannelEnabled(el, p) {
  const field = el.querySelector('[data-chan-field]');
  const sel = el.querySelector('[data-ctl="channel"]');
  const midiRouted = !!p.output && p.output !== 'synth';
  if (sel) sel.disabled = !midiRouted;
  if (field) field.classList.toggle('disabled', !midiRouted);
}

// (Re)populate one track's Output select: internal synth + every available port.
// A saved-but-offline port is kept as an option so a USB device reconnecting
// doesn't silently drop the routing.
function fillPartOutputs(el, p, outs) {
  const sel = el.querySelector('[data-ctl="output"]');
  if (!sel) return;
  const entries = [['synth', 'Internal synth']];
  for (const o of outs) entries.push([o.id, o.name]);
  if (p.output && p.output !== 'synth' && !outs.some((o) => o.id === p.output)) {
    entries.push([p.output, '⚠ saved port (offline)']);
  }
  fillSelect(sel, entries, p.output);
  setChannelEnabled(el, p);
}

// Refresh all four tracks' Output menus (after Enable MIDI or a hot-plug).
function refreshPartOutputs(outs) {
  for (const key of PARTS) {
    const el = document.querySelector(`.part[data-part="${key}"]`);
    if (el) fillPartOutputs(el, state.parts[key], outs);
  }
  updateStartEnabled();
}

// { out, channel } routes for every MIDI-routed track — for the Panic button.
function midiRoutes() {
  const routes = [];
  for (const p of Object.values(state.parts)) {
    if (p.output && p.output !== 'synth') { const o = midi.get(p.output); if (o) routes.push({ out: o, channel: p.channel }); }
  }
  return routes;
}

fillSelect($('root'), NOTE_NAMES.map((n, i) => [i, n]), state.rootPc);
fillSelect($('scale'), Object.entries(SCALES).map(([k, v]) => [k, v.name]), state.scaleKey);
fillSelect($('style'), Object.entries(STYLES).map(([k, v]) => [k, v.name]), 'cinematic');

// Blueprint picker — the real song structures (from library.js) on offer for the
// current Style. 'Auto' lets generation pick one that fits; otherwise it's pinned.
function populateBlueprints() {
  const opts = [['auto', 'Auto · fits the style'],
    ...BLUEPRINTS.filter((b) => b.styles.includes(state.style)).map((b) => [b.id, b.name])];
  if (state.blueprint !== 'auto' && !opts.some(([v]) => v === state.blueprint)) state.blueprint = 'auto';
  fillSelect($('blueprint'), opts, state.blueprint);
}
populateBlueprints();
$('blueprint').addEventListener('change', (e) => { state.blueprint = e.target.value; });

// Block editor (inspector): edits the one selected block (instance). Clicking a
// block in the timeline focuses it here; ◀ ▶ step through blocks.
const progOptions = [['', '— none —'], ...PROGRESSIONS.map((p) => [p.value, p.name])];
const blkProgEl = $('blkProg');
const blkBarsEl = $('blkBars');
const blkTypeEl = $('blkType');
const blkLabelEl = $('blkLabel');
const ROLE_NAME = { A: 'verse', B: 'chorus', C: 'bridge' };
const selectedBlk = () => (state.blocks || [])[state.selectedBlock];

function syncBlockEditor() {
  const n = (state.blocks || []).length;
  state.selectedBlock = Math.max(0, Math.min(n - 1, state.selectedBlock || 0));
  const blk = selectedBlk();
  if (!blk) { blkLabelEl.textContent = '—'; refreshPartsContext(); return; }
  blkLabelEl.textContent = `block ${state.selectedBlock + 1} / ${n} · ${blk.type} (${ROLE_NAME[blk.type] || ''})`;
  blkTypeEl.value = blk.type;
  const val = blk.prog || '';
  fillSelect(blkProgEl, progOptions, val);
  if (val && ![...blkProgEl.options].some((o) => o.value === val)) {
    const o = document.createElement('option');
    o.value = val; o.textContent = val;
    blkProgEl.appendChild(o);
    blkProgEl.value = val;
  }
  blkBarsEl.value = blk.bars || 4;
  const lockBtn = $('btnLock');
  if (lockBtn) {
    lockBtn.classList.toggle('on', !!blk.locked);
    lockBtn.textContent = blk.locked ? '🔒' : '🔓';
    lockBtn.title = blk.locked ? 'Locked — survives Regenerate (click to unlock)' : 'Lock this section so Regenerate leaves it untouched';
  }
  refreshPartsContext();
}

$('blkPrev').addEventListener('click', () => { state.selectedBlock = Math.max(0, (state.selectedBlock || 0) - 1); state.rev = (state.rev || 0) + 1; syncBlockEditor(); cueIfStopped(); });
$('blkNext').addEventListener('click', () => { state.selectedBlock = Math.min((state.blocks.length || 1) - 1, (state.selectedBlock || 0) + 1); state.rev = (state.rev || 0) + 1; syncBlockEditor(); cueIfStopped(); });
blkTypeEl.addEventListener('change', () => { const blk = selectedBlk(); if (blk) { blk.type = blkTypeEl.value; buildSong(); syncBlockEditor(); } });
// Changing the chords keeps the block's length (chords re-map to fit).
blkProgEl.addEventListener('change', () => { const blk = selectedBlk(); if (blk) { blk.prog = blkProgEl.value; blk.srcProg = blkProgEl.value; buildSong(); } });
// Changing the length resizes only this block (others keep their intensity/mutes).
blkBarsEl.addEventListener('change', () => {
  const blk = selectedBlk();
  if (!blk) return;
  const v = Math.max(1, Math.min(32, parseInt(blkBarsEl.value, 10) || 4));
  blkBarsEl.value = v;
  if (v !== blk.bars) { spliceBars(blockStart(state.selectedBlock), blk.bars, v); blk.bars = v; buildSong(); }
});

// Generate a full musical song into the current state, then refresh the UI.
// buildSong after generateSong covers the lock-aware path (which only rerolls
// progressions in place and needs rematerialising).
function doGenerate() {
  generateSong(state);
  buildSong();
  syncBlockEditor();
  state.rev = (state.rev || 0) + 1;
}

// ---- performable structural edits ---------------------------------------------
// Each edit is an op {kind, inst, label, ...}. While stopped, ops apply instantly;
// while playing, they're ARMED to the next bar and drained by the scheduler at the
// boundary (see drainPending + the transport applyPending callback).
function applyEdit(op) {
  const i = op.inst != null ? op.inst : state.selectedBlock;
  switch (op.kind) {
    case 'reroll':
      rerollBlock(state, i); buildSong(); break;
    case 'resize': {
      const blk = state.blocks[i];
      if (blk) {
        const v = Math.max(1, Math.min(32, op.bars));
        if (v !== blk.bars) { spliceBars(blockStart(i), blk.bars, v); blk.bars = v; }
      }
      buildSong(); break;
    }
    case 'repeat':
      insertBlock(state, i); buildSong(); break;
    case 'regenerate':
      doGenerate(); break;
    case 'rerollMelody':
      state.melodySalt = (state.melodySalt || 0) + 1;
      if (transport && transport.gen) transport.gen.reseedMelody();
      break;
    // 'jump' carries no song mutation — the transport handles the position change.
  }
  const msgs = {
    reroll: `↻ Rerolled section ${i + 1}.`,
    resize: `Resized section ${i + 1}.`,
    repeat: `⧉ Duplicated section ${i + 1}.`,
    regenerate: '✦ Regenerated song.',
    rerollMelody: running ? '🎵 New melodies — same chords.' : '🎵 New melodies — press ▶ Start to hear.',
  };
  if (msgs[op.kind]) setStatus(msgs[op.kind]);
  state.rev = (state.rev || 0) + 1;
}

// Drain armed edits whose target bar has arrived (called by the scheduler at each
// bar boundary). Jumps are already handled by the transport, so just clear them.
function drainPending(bar) {
  if (!state.pendingEdits.length) return;
  const due = state.pendingEdits.filter((o) => o.targetBar <= bar);
  if (!due.length) return;
  state.pendingEdits = state.pendingEdits.filter((o) => o.targetBar > bar);
  for (const op of due) if (op.kind !== 'jump') applyEdit(op);
  syncBlockEditor();
  state.rev = (state.rev || 0) + 1;
}

// Arm an edit to the next bar while playing; apply it immediately when stopped.
function armOrApply(op) {
  if (running && transport) {
    op.targetBar = (pos.bar || 0) + 1;
    if (op.kind === 'jump') transport.queueJump(op.jumpTo);
    state.pendingEdits.push(op);
    setStatus(`Armed: ${op.label} → bar ${op.targetBar + 1}`);
  } else if (op.kind === 'jump') {
    setStatus('“Jump here next” works while playing.');
  } else {
    applyEdit(op);
    syncBlockEditor();
  }
  state.rev = (state.rev || 0) + 1;
}

// ---- build the four part strips: mute · name · Activity, with a ⚙ disclosure
// for the patch-time fine controls (channel/octave/velocity/gate + bass/arp). ----
const partsRoot = $('parts');
for (const key of ['pad', 'bass', 'melody', 'alt']) {
  const p = state.parts[key];
  const el = document.createElement('div');
  el.className = 'part';
  el.dataset.part = key;
  el.innerHTML = `
    <div class="part-row">
      <label class="switch"><input type="checkbox" data-ctl="enabled" ${p.enabled ? 'checked' : ''}><span class="slider"></span></label>
      <span class="name">${PART_LABELS[key]} <span class="dot" data-dot></span></span>
      <label class="act" title="Activity — how busy this part is">
        <span class="act-lbl">Activity <span class="val" data-val="density"></span></span>
        <input type="range" data-ctl="density" min="0" max="1" step="0.01" value="${p.density}">
      </label>
      <button type="button" class="settings-btn" data-settings title="Output, channel, octave &amp; fine controls">⚙</button>
    </div>
    <div class="part-settings" hidden>
      <label class="field">Output
        <select class="sel" data-ctl="output" title="Internal synth, or a MIDI interface"></select>
      </label>
      <label class="field" data-chan-field>MIDI channel
        <select class="sel" data-ctl="channel"></select>
      </label>
      ${key === 'pad' ? `<label class="field">Pad voicing
        <select class="sel" data-ctl="padMode">${[['note', 'Single note'], ['chord', 'Chord']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>` : ''}
      ${key === 'bass' ? `<label class="field">Bass style
        <select class="sel" data-ctl="bassStyle">${['roots', 'roots8', 'offbeat', 'walking', 'syncopated'].map((s) => `<option value="${s}">${s}</option>`).join('')}</select></label>` : ''}
      ${key === 'melody' ? `<label class="field">Arp pattern
        <select class="sel" data-ctl="arpDir">${['up', 'down', 'updown', 'random'].map((s) => `<option value="${s}">${s}</option>`).join('')}</select></label>` : ''}
      <label class="field">Octave <span class="val" data-val="octave"></span>
        <input type="range" data-ctl="octave" min="-2" max="2" step="1" value="${p.octave}">
      </label>
      <label class="field">Velocity <span class="val" data-val="velocity"></span>
        <input type="range" data-ctl="velocity" min="0" max="1" step="0.01" value="${p.velocity}">
      </label>
      <label class="field">Gate <span class="val" data-val="gate"></span>
        <input type="range" data-ctl="gate" min="0.05" max="1" step="0.01" value="${p.gate}">
      </label>
    </div>`;
  partsRoot.appendChild(el);

  fillSelect(el.querySelector('[data-ctl="channel"]'),
    Array.from({ length: 16 }, (_, i) => [i, `Ch ${i + 1}`]), p.channel);
  fillPartOutputs(el, p, midi.listOutputs()); // synth-only until MIDI is enabled

  el.querySelectorAll('[data-ctl]').forEach((ctl) => {
    const name = ctl.dataset.ctl;
    const apply = () => {
      if (name === 'enabled') {
        p.enabled = ctl.checked;
        el.classList.toggle('off', !ctl.checked);
        el.querySelector('[data-dot]').classList.toggle('fire', ctl.checked);
      } else if (name === 'padMode') {
        state.padMode = ctl.value;
      } else if (name === 'bassStyle') {
        state.bassStyle = ctl.value;
      } else if (name === 'arpDir') {
        state.arpDir = ctl.value;
      } else if (name === 'output') {
        p.output = ctl.value;
        setChannelEnabled(el, p);     // channel only matters when routed to MIDI
        refreshFirstRun();
      } else if (name === 'channel') {
        p.channel = parseInt(ctl.value, 10);
      } else {
        p[name] = parseFloat(ctl.value);
        const v = el.querySelector(`[data-val="${name}"]`);
        if (v) v.textContent = name === 'octave' ? (p[name] > 0 ? `+${p[name]}` : `${p[name]}`) : pct(p[name]);
      }
    };
    ctl.addEventListener('input', apply);
    apply();
  });

  // ⚙ reveals the patch-time fine controls.
  const setBtn = el.querySelector('[data-settings]');
  setBtn.addEventListener('click', () => {
    const panel = el.querySelector('.part-settings');
    panel.hidden = !panel.hidden;
    setBtn.classList.toggle('on', !panel.hidden);
  });

  el.classList.toggle('off', !p.enabled);
}

// ---- bind global controls ----
function bindRange(id, key, fmt = (v) => v.toFixed(2)) {
  const el = $(id);
  el.value = state[key];
  const lbl = $(id + 'Val');
  const apply = () => { state[key] = parseFloat(el.value); if (lbl) lbl.textContent = fmt(state[key]); };
  el.addEventListener('input', apply); apply();
}
bindRange('bpm', 'bpm', (v) => `${v | 0} BPM`);
bindRange('evolve', 'evolve', pct);          // Energy now lives on the timeline (drag the curve)
bindRange('swing', 'swing', swingLabel);
bindRange('vol', 'vol', pct);
$('vol').addEventListener('input', () => synth.setVolume(state.vol));

$('root').addEventListener('change', (e) => { state.rootPc = parseInt(e.target.value, 10); buildSong(); });
$('scale').addEventListener('change', (e) => { state.scaleKey = e.target.value; buildSong(); });

$('seed').value = state.seed;
$('seed').addEventListener('input', (e) => { state.seed = e.target.value || 'modular'; });
$('btnSeed').addEventListener('click', () => {
  state.seed = Math.random().toString(36).slice(2, 8);
  $('seed').value = state.seed;
});

$('sendClock').addEventListener('change', (e) => { state.sendClock = e.target.checked; });

// Applying a style preset: tempo/feel + a freshly generated song in that style.
$('style').addEventListener('change', (e) => applyStyle(e.target.value));
// Split generation actions (6.2): full regenerate / reroll one section / reroll
// just the melodies. All arm-to-next-bar while playing, apply instantly when stopped.
$('btnGenerate').addEventListener('click', (e) => { armOrApply({ kind: 'regenerate', label: 'regenerate song' }); flash(e.currentTarget); });
$('btnDice').addEventListener('click', (e) => {
  state.seed = Math.random().toString(36).slice(2, 8);
  $('seed').value = state.seed;
  armOrApply({ kind: 'regenerate', label: 'regenerate (new seed)' });
  flash(e.currentTarget);
});
$('btnRerollMelody').addEventListener('click', (e) => { armOrApply({ kind: 'rerollMelody', label: 'reroll melodies' }); flash(e.currentTarget); });

// One-tap structure verbs (2.2) on the selected block.
const curBlk = () => state.blocks[state.selectedBlock];
$('btnReroll').addEventListener('click', (e) => { armOrApply({ kind: 'reroll', inst: state.selectedBlock, label: 'reroll section' }); flash(e.currentTarget); });
$('btnExtend').addEventListener('click', (e) => { const b = curBlk(); if (b) armOrApply({ kind: 'resize', inst: state.selectedBlock, bars: Math.min(32, b.bars * 2), label: 'extend bars' }); flash(e.currentTarget); });
$('btnHalve').addEventListener('click', (e) => { const b = curBlk(); if (b) armOrApply({ kind: 'resize', inst: state.selectedBlock, bars: Math.max(1, Math.floor(b.bars / 2)), label: 'halve bars' }); flash(e.currentTarget); });
$('btnRepeat').addEventListener('click', (e) => { armOrApply({ kind: 'repeat', inst: state.selectedBlock, label: 'repeat next' }); flash(e.currentTarget); });
$('btnJump').addEventListener('click', (e) => { armOrApply({ kind: 'jump', inst: state.selectedBlock, jumpTo: blockStart(state.selectedBlock), label: 'jump here' }); flash(e.currentTarget); });
// Lock is a meta flag, applied instantly (locked blocks survive regeneration).
$('btnLock').addEventListener('click', () => {
  const b = curBlk();
  if (!b) return;
  b.locked = !b.locked;
  state.rev = (state.rev || 0) + 1;
  syncBlockEditor();
});
function applyStyle(key) {
  const s = STYLES[key];
  if (!s) return;
  state.style = key;
  state.bpm = s.bpm; $('bpm').value = s.bpm; $('bpmVal').textContent = `${s.bpm} BPM`;
  state.swing = s.swing; $('swing').value = s.swing; $('swingVal').textContent = s.swing.toFixed(2);
  state.bassStyle = s.bass;
  const bassSel = document.querySelector('[data-ctl="bassStyle"]'); if (bassSel) bassSel.value = s.bass;
  if (s.arp) {
    state.arpDir = s.arp;
    const arpSel = document.querySelector('[data-ctl="arpDir"]'); if (arpSel) arpSel.value = s.arp;
  }
  if (s.padDens != null) setPart('pad', 'density', s.padDens);
  setPart('melody', 'density', s.melDens);
  setPart('alt', 'density', s.leadDens);
  if (s.gate) for (const part of PARTS) if (s.gate[part] != null) setPart(part, 'gate', s.gate[part]);
  populateBlueprints(); // the blueprint choices change with the style
  doGenerate(); // author a new, complete song in this style
}
function setPart(part, name, value) {
  state.parts[part][name] = value;
  const panel = document.querySelector(`.part[data-part="${part}"]`);
  const ctl = panel?.querySelector(`[data-ctl="${name}"]`);
  if (ctl) { ctl.value = value; ctl.dispatchEvent(new Event('input')); }
}

// ---- MIDI enable ----
// Grants Web MIDI access, then lets each track's Output menu list the interfaces.
// Routing itself is per-track (in each ⚙ panel), so there's no global port pick.
$('btnEnableMidi').addEventListener('click', async () => {
  try {
    const outs = await midi.init();
    midi.onStateChange = refreshPartOutputs;   // repopulate every track on hot-plug
    midiEnabled = true;
    refreshPartOutputs(outs);
    refreshFirstRun();
    setStatus(outs.length
      ? `MIDI ready — ${outs.length} interface${outs.length > 1 ? 's' : ''} found. Open a track's ⚙ and pick its Output + channel.`
      : 'No MIDI outputs found. Plug in your interface, then re-click Enable MIDI. (Internal synth still works.)');
  } catch (err) {
    setStatus(err.message, true);
  }
});

// ---- transport ----
const beatEls = document.querySelectorAll('.beats i');

$('btnStart').addEventListener('click', () => {
  buildSong();
  if (!transport) {
    transport = new Transport(midi, synth, generator, state, {
      // Keep composing forward: ensure the song is materialised ahead of the playhead.
      ensureBar: (bar) => {
        const n0 = state.song.length;
        while (state.song.length <= bar + 16) extendSong(state);
        if (state.song.length !== n0) state.rev = (state.rev || 0) + 1;
      },
      // Apply any structural edits armed to this bar, right before it generates.
      applyPending: (bar) => drainPending(bar),
      // (The Now/Next header is driven by the timeline's frame loop, so no onBar.)
      onStep: (stepInBar, curBar) => {
        pos.bar = curBar; pos.step = stepInBar; pos.atPerf = performance.now();
        pos.stepMs = 60000 / state.bpm / 4;
        const beat = Math.floor(stepInBar / 4);
        beatEls.forEach((el, i) => el.classList.toggle('on', i === beat && stepInBar % 4 === 0));
      },
    });
  }
  // Resume from where we paused, else start from the selected section.
  const fromBar = paused ? Math.max(0, pos.bar || 0) : blockStart(state.selectedBlock || 0);
  transport.start(fromBar, paused);
  running = true; paused = false;
  pos.running = true; pos.bar = fromBar; pos.step = 0; pos.atPerf = performance.now();
  updateStartEnabled();
  setStatus(`Playing from bar ${fromBar + 1} — ${pcName(state.rootPc)} ${SCALES[state.scaleKey].name}. Tweak live; changes land next bar.`);
});

$('btnPause').addEventListener('click', () => {
  if (!running || !transport) return;
  transport.stop();              // halt + MIDI Stop, but keep pos.bar for resume
  transport.pendingJump = null;
  running = false; pos.running = false; paused = true;
  state.pendingEdits = [];
  state.rev = (state.rev || 0) + 1;
  updateStartEnabled();
  beatEls.forEach((el) => el.classList.remove('on'));
  setStatus(`Paused at bar ${(pos.bar || 0) + 1}. Edit freely, then ▶ Resume — or pick another section to start there.`);
});

$('btnStop').addEventListener('click', () => {
  if (transport) { transport.stop(); transport.pendingJump = null; }
  running = false; pos.running = false; paused = false;
  state.selectedBlock = 0;           // start over from the top
  pos.bar = 0; pos.step = 0;
  state.pendingEdits = [];           // discard anything armed but not yet landed
  state.rev = (state.rev || 0) + 1;
  syncBlockEditor();
  updateStartEnabled();
  beatEls.forEach((el) => el.classList.remove('on'));
  setStatus('Stopped — back to the top.');
});

$('btnPanic').addEventListener('click', () => {
  if (transport) { transport.stop(); transport.pendingJump = null; }
  midi.panic(midiRoutes());
  synth.panic();
  running = false; pos.running = false; paused = false;
  state.pendingEdits = [];
  updateStartEnabled();
  beatEls.forEach((el) => el.classList.remove('on'));
  setStatus('Panic — all notes off.');
});

// ---- save / recall ----
const PART_LIST = ['pad', 'bass', 'melody', 'alt'];

// A jam snapshot: all musical/arrangement state plus per-track routing (output +
// channel, carried inside parts — offline ports fall back gracefully on recall).
// Synth volume stays a machine-local pref. Sets become arrays for JSON.
function serialize() {
  return {
    v: 1,
    rootPc: state.rootPc, scaleKey: state.scaleKey, style: state.style,
    bpm: state.bpm, swing: state.swing, energy: state.energy, evolve: state.evolve,
    seed: state.seed, sendClock: state.sendClock, bassStyle: state.bassStyle, arpDir: state.arpDir, padMode: state.padMode,
    blueprint: state.blueprint, melodySalt: state.melodySalt,
    family: state.family, blocks: state.blocks, selectedBlock: state.selectedBlock,
    song: state.song, intensity: state.intensity, formState: state.formState,
    mutes: Object.fromEntries(PART_LIST.map((k) => [k, [...(state.mutes[k] || [])]])),
    parts: state.parts,
  };
}

function deserialize(d) {
  if (!d || typeof d !== 'object') throw new Error('not a Modular Riffs jam');
  const scalars = ['rootPc', 'scaleKey', 'style', 'bpm', 'swing', 'energy', 'evolve', 'seed', 'sendClock', 'bassStyle', 'arpDir', 'padMode', 'selectedBlock', 'blueprint', 'melodySalt'];
  if (d.padMode === undefined) state.padMode = 'note'; // backward-compat for older presets
  if (d.blueprint === undefined) state.blueprint = 'auto'; // backward-compat for older presets
  if (d.melodySalt === undefined) state.melodySalt = 0;
  state.pendingEdits = [];
  for (const k of scalars) if (d[k] !== undefined) state[k] = d[k];
  if (d.family) state.family = d.family;
  if (d.blocks) state.blocks = d.blocks;
  if (d.song) state.song = d.song;
  if (d.intensity) state.intensity = d.intensity;
  if (d.formState) state.formState = d.formState;
  if (d.parts) for (const k of PART_LIST) if (d.parts[k]) Object.assign(state.parts[k], d.parts[k]);
  if (d.mutes) for (const k of PART_LIST) state.mutes[k] = new Set(d.mutes[k] || []);
  state.rev = (state.rev || 0) + 1;
  syncUIFromState();
}

// Push the whole state back into the controls (used on recall).
function syncUIFromState() {
  $('root').value = state.rootPc;
  $('scale').value = state.scaleKey;
  $('style').value = state.style;
  populateBlueprints();
  $('seed').value = state.seed;
  $('sendClock').checked = state.sendClock;
  const setRange = (id, val, fmt) => { const el = $(id); if (!el) return; el.value = val; const lbl = $(id + 'Val'); if (lbl) lbl.textContent = fmt(val); };
  setRange('bpm', state.bpm, (v) => `${v | 0} BPM`);
  setRange('evolve', state.evolve, pct);
  setRange('swing', state.swing, swingLabel);
  for (const key of PART_LIST) {
    const panel = document.querySelector(`.part[data-part="${key}"]`);
    if (!panel) continue;
    const p = state.parts[key];
    const setCtl = (name, value, isCheck) => {
      const ctl = panel.querySelector(`[data-ctl="${name}"]`);
      if (!ctl) return;
      if (isCheck) ctl.checked = value; else ctl.value = value;
      ctl.dispatchEvent(new Event('input'));
    };
    setCtl('enabled', p.enabled, true);
    setCtl('channel', p.channel);
    setCtl('octave', p.octave);
    setCtl('density', p.density);
    setCtl('velocity', p.velocity);
    setCtl('gate', p.gate);
    // Rebuild the Output menu directly (a saved/offline port may not be a listed
    // option; routing through setCtl would clobber p.output back to the synth).
    fillPartOutputs(panel, p, midi.listOutputs());
  }
  const padSel = document.querySelector('[data-ctl="padMode"]'); if (padSel) padSel.value = state.padMode;
  const bassSel = document.querySelector('[data-ctl="bassStyle"]'); if (bassSel) bassSel.value = state.bassStyle;
  const arpSel = document.querySelector('[data-ctl="arpDir"]'); if (arpSel) arpSel.value = state.arpDir;
  syncBlockEditor();
}

const PRESET_PREFIX = 'modularriffs:preset:';
function listPresets() {
  const names = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PRESET_PREFIX)) names.push(k.slice(PRESET_PREFIX.length));
  }
  return names.sort();
}
function refreshPresetList() {
  fillSelect($('presetList'), [['', '— saved jams —'], ...listPresets().map((n) => [n, n])], $('presetList').value);
}
$('btnSave').addEventListener('click', () => {
  const name = $('presetName').value.trim();
  if (!name) { setStatus('Name the jam before saving.', true); return; }
  try {
    localStorage.setItem(PRESET_PREFIX + name, JSON.stringify(serialize()));
    refreshPresetList(); $('presetList').value = name;
    setStatus(`Saved "${name}".`);
  } catch (e) { setStatus('Save failed: ' + e.message, true); }
});
$('btnLoad').addEventListener('click', () => {
  const name = $('presetList').value;
  if (!name) { setStatus('Pick a saved jam to load.', true); return; }
  const raw = localStorage.getItem(PRESET_PREFIX + name);
  if (!raw) return;
  try { deserialize(JSON.parse(raw)); $('presetName').value = name; setStatus(`Loaded "${name}".`); }
  catch (e) { setStatus('Could not load: ' + e.message, true); }
});
$('btnDelete').addEventListener('click', () => {
  const name = $('presetList').value;
  if (!name) return;
  localStorage.removeItem(PRESET_PREFIX + name);
  refreshPresetList();
  setStatus(`Deleted "${name}".`);
});
$('btnExport').addEventListener('click', () => {
  const name = $('presetName').value.trim() || 'modular-riffs-jam';
  const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name + '.json'; a.click();
  URL.revokeObjectURL(url);
});
$('btnExportMidi').addEventListener('click', () => {
  buildSong(); // make sure the per-bar timeline reflects the latest edits
  const bytes = buildTimelineMidi(state);
  if (!bytes.length) { setStatus('Nothing to export — the timeline has no notes yet.', true); return; }
  const name = $('presetName').value.trim() || 'modular-riffs-timeline';
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name + '.mid'; a.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${state.song.length}-bar timeline to "${name}.mid".`);
});
$('btnImport').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { deserialize(JSON.parse(reader.result)); setStatus(`Imported "${file.name}".`); }
    catch (err) { setStatus('Import failed: ' + err.message, true); }
  };
  reader.readAsText(file);
  e.target.value = '';
});
refreshPresetList();

// ---- New-song modal ----
const newModal = $('newModal');
const closeNew = () => { newModal.hidden = true; };
$('btnNew').addEventListener('click', () => { newModal.hidden = false; });
$('btnNewGenerate').addEventListener('click', () => { doGenerate(); closeNew(); setStatus('New song generated.'); });
newModal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeNew));

// ---- keyboard shortcuts (5.3) ----
const isTyping = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
function snapshot() {
  const name = $('presetName').value.trim() || `snapshot ${new Date().toLocaleTimeString()}`;
  $('presetName').value = name;
  $('btnSave').click();
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !newModal.hidden) { closeNew(); return; }
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !newModal.hidden) return;
  switch (e.key) {
    case ' ': e.preventDefault(); (running ? $('btnPause') : $('btnStart')).click(); break;
    case '1': case '2': case '3': case '4': {
      const k = ['pad', 'bass', 'melody', 'alt'][parseInt(e.key, 10) - 1];
      const ctl = document.querySelector(`.part[data-part="${k}"] [data-ctl="enabled"]`);
      if (ctl) { ctl.checked = !ctl.checked; ctl.dispatchEvent(new Event('input')); }
      break;
    }
    case 'ArrowLeft': $('blkPrev').click(); break;
    case 'ArrowRight': $('blkNext').click(); break;
    case 's': case 'S': e.preventDefault(); snapshot(); break;
    default: break;
  }
});

// ---- first-run checklist (1.4) ---- (FR_KEY is declared near the top of the module)
function refreshFirstRun() {
  const fr = $('firstrun');
  if (!fr) return;
  if (localStorage.getItem(FR_KEY)) { fr.hidden = true; return; }
  fr.hidden = false;
  const mark = (step, ok) => { const el = fr.querySelector(`[data-step="${step}"]`); if (el) el.classList.toggle('done', ok); };
  mark('midi', midiEnabled);
  mark('route', Object.values(state.parts).some((p) => p.output && p.output !== 'synth'));
}
$('frDismiss').addEventListener('click', () => { localStorage.setItem(FR_KEY, '1'); $('firstrun').hidden = true; });

// ---- init ----
// Apply the default style, which generates a complete musical song on load.
$('style').value = 'cinematic';
applyStyle('cinematic');
initTimeline($('timeline'), state, pos, {
  onSelectBlock: (i) => { state.selectedBlock = i; syncBlockEditor(); cueIfStopped(); },
}); // Arrangement view (forecasts on every change)
updateStartEnabled(); // synth works without a MIDI port, so Start is ready immediately
refreshFirstRun();
