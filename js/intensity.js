// intensity.js — per-bar intensity helpers shared by the generator (curEnergy)
// and the timeline (forecast), so they always agree.
//
// Intensity is now a per-bar array (state.intensity) — authored by Generate and
// (next) draggable in the timeline. The global Energy slider rides it live.

// Apply the global Energy slider as a +/- ride on top of the authored base
// (Energy 0.5 = neutral / as authored).
export function withEnergy(base, energy) {
  const b = base == null ? 0.55 : base;
  const e = energy == null ? 0.5 : energy;
  return Math.max(0, Math.min(1, b + (e - 0.5)));
}

// Resize a per-bar intensity array to a new length, preserving its shape
// (linear resample). Keeps a drawn arc intact when the song structure changes.
export function resample(arr, newLen) {
  if (!newLen || newLen < 1) return [];
  if (!arr || !arr.length) return new Array(newLen).fill(0.55);
  if (arr.length === newLen) return arr.slice();
  const out = new Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const t = newLen === 1 ? 0 : (i / (newLen - 1)) * (arr.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(arr.length - 1, lo + 1);
    out[i] = arr[lo] * (1 - (t - lo)) + arr[hi] * (t - lo);
  }
  return out;
}
