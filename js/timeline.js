// timeline.js — the Arrangement view.
//
// A forward-looking, editable map of the song. Because playback composes forward
// forever, the song grows without bound, so the view shows a WINDOW of bars that
// you can scroll (wheel / ◀ ▶) and that auto-follows the playhead while playing.
// Section blocks + chords, the intensity envelope, a lane per part (click to
// mute that bar, shift-click the section), a moving playhead, and a readout.

import { withEnergy } from './intensity.js';

const PART_KEYS = ['pad', 'bass', 'melody', 'alt'];
const PART_NAMES = { pad: 'Pad', bass: 'Bass', melody: 'Arp', alt: 'Melody' };
const WINDOW = 32;            // bars shown at once
const FOLLOW_PAUSE_MS = 2500; // after a manual scroll, pause auto-follow this long
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Per-part "activity" estimate from density + intensity (mirrors how the
// generator scales each part), purely for the visual height of the lane.
const PART_ACTIVITY = {
  pad: (d, e) => d * (0.6 + e * 0.5),
  bass: (d, e) => d * (0.5 + e * 0.5),
  melody: (d, e) => d * (0.6 + e * 0.6),
  alt: (d, e) => d * (0.6 + e * 0.7),
};

// Per-bar forecast for the whole song.
export function computeTimeline(state) {
  const song = state.song || [];
  const mutes = state.mutes || {};
  const out = [];
  for (let i = 0; i < song.length; i++) {
    const s = song[i];
    const intensity = withEnergy(state.intensity ? state.intensity[i] : null, state.energy);
    const parts = {};
    for (const k of PART_KEYS) {
      const p = state.parts[k];
      const muted = !!(mutes[k] && mutes[k].has(i));
      parts[k] = { on: !!p.enabled, muted, v: p.enabled ? clamp(PART_ACTIVITY[k](p.density, intensity), 0, 1) : 0 };
    }
    out.push({ section: s.section, inst: s.inst, chord: s.label, intensity, parts });
  }
  return out;
}

// Intensity reads as warmth: dim amber-brown (low) → bright amber (high).
const intensityColor = (v) => `hsl(${Math.round(44 - v * 16)}, ${Math.round(34 + v * 46)}%, ${Math.round(38 + v * 16)}%)`;

export function initTimeline(wrap, state, pos, cbs = {}) {
  wrap.classList.add('timeline-wrap');
  wrap.innerHTML = `
    <div class="tl-head">
      <div class="tl-next" id="tlNext">—</div>
      <div class="tl-headctl">
        <button class="tl-clear" id="tlClear" type="button" hidden>clear mutes</button>
        <button class="tl-scrollbtn" id="tlPrev" type="button" title="scroll left">◀</button>
        <button class="tl-scrollbtn" id="tlFwd" type="button" title="scroll right">▶</button>
      </div>
    </div>
    <div class="tl-armstrip" id="tlArm" hidden></div>
    <div class="timeline"><div class="tl-body"></div><div class="tl-playhead"></div></div>`;
  const body = wrap.querySelector('.tl-body');
  const playhead = wrap.querySelector('.tl-playhead');
  const nextEl = wrap.querySelector('#tlNext');
  const clearEl = wrap.querySelector('#tlClear');
  const armEl = wrap.querySelector('#tlArm');
  // Topbar bar counter (current / total bars so far).
  const barNowEl = document.getElementById('barNow');
  const barTotalEl = document.getElementById('barTotal');
  let lastBarNow = -1, lastBarTotal = -1;
  const timelineEl = wrap.querySelector('.timeline');

  let viewStart = 0;
  let lastUserScroll = -1e9;
  let lastCueBar = -1;

  const songLen = () => (state.song || []).length;
  const maxStart = () => Math.max(0, songLen() - WINDOW);
  const visN = () => Math.max(1, Math.min(WINDOW, songLen() - viewStart));

  // Cheap change-detection (the song can grow huge): a revision counter bumped
  // on any structural/mute change, plus the scalar controls that affect the view.
  let lastSig = '';
  const sig = () => JSON.stringify({
    rev: state.rev || 0,
    vs: viewStart,
    e: state.energy,
    p: PART_KEYS.map((k) => [state.parts[k].enabled, state.parts[k].density]),
  });
  const bumpRev = () => { state.rev = (state.rev || 0) + 1; };

  const row = (label, cellsHtml, cls = '') =>
    `<div class="tl-row ${cls}"><div class="tl-label">${label}</div><div class="tl-cells">${cellsHtml}</div></div>`;

  function build() {
    const data = computeTimeline(state);
    const lo = viewStart;
    const hi = Math.min(data.length, viewStart + WINDOW);
    const armedInsts = new Set((state.pendingEdits || []).map((o) => o.inst).filter((x) => x != null));
    const lockedInsts = new Set((state.blocks || []).map((b, i) => (b.locked ? i : null)).filter((x) => x != null));

    let sec = '';
    for (let i = lo; i < hi; i++) {
      const b = data[i];
      const runStart = i === lo || data[i - 1].inst !== b.inst; // block boundary
      const selCls = b.inst === state.selectedBlock ? ' selected' : '';
      const armCls = armedInsts.has(b.inst) ? ' tl-armed' : '';
      const lock = runStart && lockedInsts.has(b.inst) ? ' 🔒' : '';
      sec += `<div class="tl-cell tl-sec sec-${b.section}${selCls}${armCls} ${runStart ? 'runstart' : ''}" data-inst="${b.inst}" title="Bar ${i + 1} · ${b.chord} · block ${b.inst + 1} (${b.section}) — click to edit">`
        + `${runStart ? `<span class="tl-secletter">${b.section}${lock}</span>` : ''}`
        + `<span class="tl-chord">${b.chord}</span></div>`;
    }
    updateArm();

    let intens = '';
    for (let i = lo; i < hi; i++) {
      const b = data[i];
      const sel = b.inst === state.selectedBlock ? ' in-sel' : '';
      intens += `<div class="tl-cell tl-int${sel}" title="bar ${i + 1} · intensity ${Math.round(b.intensity * 100)}%">`
        + `<div class="tl-fill" style="height:${Math.round(b.intensity * 100)}%;background:${intensityColor(b.intensity)}"></div></div>`;
    }

    let partRows = '';
    for (const k of PART_KEYS) {
      let cells = '';
      for (let i = lo; i < hi; i++) {
        const pv = data[i].parts[k];
        const cls = !pv.on ? 'muted' : (pv.muted ? 'bmute' : '');
        const sel = data[i].inst === state.selectedBlock ? ' in-sel' : '';
        const h = (pv.on && !pv.muted) ? Math.round(pv.v * 100) : 0;
        cells += `<div class="tl-cell tl-part ${cls}${sel}" data-part="${k}" data-bar="${i}"`
          + ` title="${PART_NAMES[k]} · bar ${i + 1}${pv.muted ? ' (muted — click to enable; shift = section)' : ' (click to mute; shift = section)'}">`
          + `<div class="tl-fill" style="height:${h}%"></div></div>`;
      }
      const allOff = data.length > 0 && data.every((b) => !b.parts[k].on);
      partRows += row(PART_NAMES[k], cells, `lane-${k}${allOff ? ' off' : ''}`);
    }

    const energyPct = Math.round((state.energy == null ? 0.5 : state.energy) * 100);
    const intensLabel = `Intensity<span class="tl-elabel" title="Energy — drag up/down to lift or drop the whole song">⇅ E ${energyPct}%</span>`;
    body.innerHTML = row('Section', sec, 'tl-secrow') + row(intensLabel, intens, 'tl-introw') + partRows;
  }

  // The bar range of the block (instance) a bar belongs to.
  const blockRun = (bar) => {
    const song = state.song || [];
    if (!song.length) return [bar, bar];
    const inst = song[bar].inst;
    let lo = bar, hi = bar;
    while (lo > 0 && song[lo - 1].inst === inst) lo--;
    while (hi < song.length - 1 && song[hi + 1].inst === inst) hi++;
    return [lo, hi];
  };

  // Click a part cell to mute/unmute that bar; shift-click for the whole section.
  body.addEventListener('click', (e) => {
    const cell = e.target.closest('.tl-part[data-part]');
    if (!cell) return;
    const part = cell.dataset.part;
    if (!state.parts[part].enabled) return;
    const bar = parseInt(cell.dataset.bar, 10);
    if (!state.mutes[part]) state.mutes[part] = new Set();
    const set = state.mutes[part];
    if (e.shiftKey) {
      const muting = !set.has(bar);
      const [lo, hi] = blockRun(bar);
      for (let i = lo; i <= hi; i++) { if (muting) set.add(i); else set.delete(i); }
    } else if (set.has(bar)) {
      set.delete(bar);
    } else {
      set.add(bar);
    }
    bumpRev();
    build();
    lastSig = sig();
    if (cbs.onMutate) cbs.onMutate();
  });

  clearEl.addEventListener('click', () => {
    for (const k of PART_KEYS) if (state.mutes[k]) state.mutes[k].clear();
    bumpRev();
    build();
    lastSig = sig();
    if (cbs.onMutate) cbs.onMutate();
  });

  // Click a block band to focus the editor on that block.
  body.addEventListener('click', (e) => {
    const sc = e.target.closest('.tl-sec[data-inst]');
    if (!sc) return;
    state.selectedBlock = parseInt(sc.dataset.inst, 10);
    bumpRev();
    build();
    lastSig = sig();
    if (cbs.onSelectBlock) cbs.onSelectBlock(state.selectedBlock);
  });

  const updateClear = () => {
    let n = 0;
    for (const k of PART_KEYS) if (state.mutes && state.mutes[k]) n += state.mutes[k].size;
    clearEl.hidden = n === 0;
    clearEl.textContent = `✕ clear mutes (${n})`;
  };

  // Show the count + target of structural edits armed to land at the next bar.
  function updateArm() {
    const arm = state.pendingEdits || [];
    if (!arm.length) { armEl.hidden = true; return; }
    const minBar = Math.min(...arm.map((o) => o.targetBar || 0));
    armEl.hidden = false;
    armEl.innerHTML = `<span class="dotpulse"></span> ${arm.length} edit${arm.length > 1 ? 's' : ''} armed → bar ${minBar + 1}`;
  }

  // ---- scrolling ----
  function scrollBy(delta) {
    const want = Math.max(0, Math.min(maxStart(), Math.round(viewStart + delta)));
    if (want === viewStart) return;
    viewStart = want;
    lastUserScroll = performance.now();
    build();
  }
  timelineEl.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    scrollBy(d > 0 ? 2 : -2);
  }, { passive: false });
  wrap.querySelector('#tlPrev').addEventListener('click', () => scrollBy(-8));
  wrap.querySelector('#tlFwd').addEventListener('click', () => scrollBy(8));

  // ---- draggable intensity ----
  // Drag the Intensity lane to shape the arc (vertical = level), drag across to
  // paint, shift-drag to set the whole section. We store the BASE value so the
  // visual matches where you drag at the current Energy ride.
  let dragging = false, dragShift = false;
  function intensityAt(e) {
    const cells = body.querySelector('.tl-introw .tl-cells');
    if (!cells) return null;
    const r = cells.getBoundingClientRect();
    if (r.width <= 0) return null;
    const x = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width));
    const bar = viewStart + Math.floor(x * visN());
    if (bar < 0 || bar >= songLen()) return null;
    const eff = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    return { bar, eff };
  }
  function applyIntensity(bar, eff, shift) {
    if (!state.intensity) state.intensity = [];
    const base = clamp(eff - ((state.energy || 0.5) - 0.5), 0, 1);
    if (shift) {
      const [lo, hi] = blockRun(bar);
      for (let i = lo; i <= hi; i++) state.intensity[i] = base;
    } else {
      state.intensity[bar] = base;
    }
    lastUserScroll = performance.now(); // pause auto-follow while editing
    bumpRev();
    build();
    lastSig = sig();
  }
  body.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.tl-int')) return;
    e.preventDefault();
    dragging = true; dragShift = e.shiftKey;
    const r = intensityAt(e);
    if (r) applyIntensity(r.bar, r.eff, dragShift);
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = intensityAt(e);
    if (r) applyIntensity(r.bar, r.eff, dragShift);
  });
  window.addEventListener('pointerup', () => { dragging = false; });

  // ---- Energy: a global lift on the whole intensity curve. Drag the Intensity
  // row's label up/down to set state.energy; the lane re-renders via withEnergy. ----
  let energyDrag = null;
  body.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.tl-introw .tl-label')) return;
    e.preventDefault();
    energyDrag = { y: e.clientY, e0: state.energy == null ? 0.5 : state.energy };
  });
  window.addEventListener('pointermove', (e) => {
    if (!energyDrag) return;
    const dy = energyDrag.y - e.clientY; // up = louder
    state.energy = clamp(energyDrag.e0 + dy / 160, 0, 1);
    lastUserScroll = performance.now();
    bumpRev(); build(); lastSig = sig();
  });
  window.addEventListener('pointerup', () => { energyDrag = null; });

  function curFrac() {
    let frac = 0;
    if (pos.running && pos.stepMs) frac = clamp((performance.now() - pos.atPerf) / pos.stepMs, 0, 1);
    const p = pos.bar + (pos.step + frac) / 16; // absolute position in bars
    return (p - viewStart) / visN();
  }

  const ROLE_LABEL = { A: 'verse', B: 'chorus', C: 'bridge' };
  // Big Now/Next header: current section + bar-in-section + chord, then the next
  // section and a countdown.
  function updateNext() {
    const song = state.song || [];
    const n = song.length;
    if (!n) { nextEl.innerHTML = '<span class="nn-dim">— press ▶ Start —</span>'; return; }
    const cb = clamp(pos.bar, 0, n - 1);
    const here = song[cb];
    let lo = cb; while (lo > 0 && song[lo - 1].inst === here.inst) lo--;
    let hi = cb; while (hi < n - 1 && song[hi + 1].inst === here.inst) hi++;
    const inBlk = cb - lo + 1, blkLen = hi - lo + 1;
    const role = ROLE_LABEL[here.section] || here.section;
    const now = `<b class="nn-sec sec-${here.section}">${role}</b><span class="nn-meta">bar ${inBlk}/${blkLen}</span><b class="nn-chord">${here.label}</b>`;
    if (hi + 1 >= n) { nextEl.innerHTML = now; return; }
    const nx = song[hi + 1];
    const inBars = (hi + 1) - cb;
    nextEl.innerHTML = `${now}<span class="nn-arrow">→</span><span class="nn-next">next <b class="sec-${nx.section}">${ROLE_LABEL[nx.section] || nx.section}</b> in ${inBars} bar${inBars === 1 ? '' : 's'}</span>`;
  }

  function frame() {
    let need = false;
    const s = sig();
    if (s !== lastSig) { lastSig = s; need = true; }

    // auto-follow the playhead while playing (unless the user just scrolled)
    if (pos.running && performance.now() - lastUserScroll > FOLLOW_PAUSE_MS) {
      const want = Math.max(0, Math.min(maxStart(), Math.round(pos.bar - WINDOW / 3)));
      if (want !== viewStart) { viewStart = want; need = true; }
    }
    // When stopped, snap the view to a newly-cued playhead so the start point shows.
    if (!pos.running && pos.bar !== lastCueBar) {
      lastCueBar = pos.bar;
      const want = Math.max(0, Math.min(maxStart(), Math.round(pos.bar - WINDOW / 3)));
      if (want !== viewStart) { viewStart = want; need = true; }
    }
    if (viewStart > maxStart()) { viewStart = maxStart(); need = true; }
    if (need) { build(); lastSig = sig(); }

    const f = curFrac();
    playhead.style.setProperty('--pos', clamp(f, 0, 1));
    playhead.style.opacity = (f < -0.001 || f > 1.001) ? '0' : '';
    playhead.classList.toggle('live', !!pos.running);
    updateNext();
    updateClear();
    if (barNowEl) {
      const n = (state.song || []).length;
      const cur = n ? clamp(pos.bar, 0, n - 1) + 1 : 0;
      if (cur !== lastBarNow) { barNowEl.textContent = cur || '—'; lastBarNow = cur; }
      if (n !== lastBarTotal) { if (barTotalEl) barTotalEl.textContent = n || '—'; lastBarTotal = n; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
