# Modular Riffs

A generative MIDI backing tool for jamming over your modular synth.
Pick a key, scale/mode, style, and a **blueprint** (a real song structure), and it
composes four evolving **monophonic** parts — **pad, bassline, arpeggiator, melody** —
that *imply* the harmony between them, streamed out your USB MIDI interface on
channels 1–4. It also acts as the master **MIDI clock** so your modular's
sequencers and LFOs lock to the tempo, and a built-in synth lets you hear it all
without patching.

<img width="1506" height="1631" alt="Modular Riffs" src="https://github.com/user-attachments/assets/660ff158-8f05-4377-b9dc-e412088af08a" />

Crucially, it doesn't generate at random: every song is **derived from a real
chord-progression + structure blueprint and a library of known-good melodic
shapes, then mutated** — so the output sounds like a genre rather than a random
walk. It composes *forward forever* (no looping) until you stop.

It runs entirely in the browser (Chrome or Edge) — no install, no build step.

---

## The music: theory

This is the heart of the tool, so it's worth understanding.

### Monophonic harmony — implied, not stacked

A modular synth voice plays **one note at a time**. You can't play a four-note
chord down a single CV/gate pair. So Modular Riffs never sends block chords —
instead it spreads the harmony across the four parts so the chord is **implied by
their combination**, the way a jazz trio or a string quartet outlines harmony with
independent monophonic lines:

| Part | What it contributes to the chord |
|------|----------------------------------|
| **Pad** | One sustained, voice-led chord tone — the held centre of gravity |
| **Bassline** | The chord's **root** (the harmonic foundation), with style variations |
| **Arpeggiator** | The chord spelled out one tone at a time (root–3rd–5th–7th…) |
| **Melody** | A melodic line that **targets chord tones on strong beats**, passing/neighbour tones in between |

Put together at any instant they sound the full chord, but every individual line
is a clean monophonic sequence. Every part is also **forced strictly monophonic**:
notes that would share a start step are dropped, and each note is clipped to end a
small gap before the next (and before the bar line). That guarantees a clean
**gate retrigger** on monophonic gear — no tied/overlapping notes swallowing a gate.

> The app outputs **notes and gates only**. Envelopes, glide/portamento, and
> filter shaping live in *your patch* — Modular Riffs deliberately stays out of
> that. Gate **length** (the "gate" knob per part) is the one expressive note
> parameter it controls, because it's still just a gate.

### Scales & modes

Everything generated is constrained to the chosen **root + scale**. Twelve are
built in:

- **Major (Ionian)** and the church modes: **Dorian, Phrygian, Lydian, Mixolydian, Aeolian (natural minor), Locrian**
- **Harmonic minor**, **Melodic minor**
- **Major / Minor pentatonic**, **Blues**

A scale is stored as semitone intervals from the root (e.g. major = `0 2 4 5 7 9 11`).
All note choices — chord tones, bass roots, arpeggios, melodic contours — are
filtered to the scale's pitch classes, so nothing ever lands out of key (the one
deliberate exception is borrowed chords; see below).

### How chords are built

Chords are **diatonic by default**: starting on a scale degree, the engine stacks
**thirds within the scale**, four notes deep. Because the stack follows the scale,
the chord's quality falls out automatically — in major, degree I is a major 7th,
ii is a minor 7th, V is a dominant 7th, vii is half-diminished, and so on. The
arpeggiator spells up to four of those tones, so **sevenths appear naturally**;
the pad and bass take the tones they need (a single voice-led tone, the root).

### The chord language (roman numerals)

Progressions are written in **roman numerals** so they're key-independent — the
same `I V vi IV` works in any key or scale you pick. The parser understands:

| You write | You get | Notes |
|-----------|---------|-------|
| `I` `ii` `iii` `IV` `V` `vi` `vii` | Diatonic chord on that scale degree | Case is a label; the *sound* follows the scale |
| `V7` `ii7` `Imaj7` `vi7` | Explicit 7th-chord quality | `7` is dominant on an uppercase numeral, minor on a lowercase one |
| `Isus4` `I6` `IIm7b5` `vii°` | sus / 6 / half-dim / dim / aug qualities | From a full quality table |
| `bVII` `bVI` `bIII` `#iv` | **Borrowed / chromatic** chords | Root is offset from the major-scale degree; still transposes |
| `II7` `III7` `VI7` | **Secondary dominants** | `II7` = V7/V, `VI7` = V7/ii, etc. — written as accidental/quality romans |
| `Cmaj7` `F#m7` `Gsus4` | **Absolute** chord symbols | Fixed pitch (does not transpose) — escape hatch |
| `I:2 vi:2 IV V` | Per-chord **bar lengths** | `:N` = hold this chord N bars |

Plain diatonic numerals take an untouched "stack the scale's thirds" path
(zero surprises); only an accidental or an explicit quality switches to the
chromatic reading. This is what lets jazz (`ii7 V7 Imaj7`), gospel (`I III7 vi IV`),
blues (`I7 IV7 V7`), and pop with a borrowed `bVII` all sound like themselves while
still following the key.

You can type these into any **Chord progression** box in the per-section editor,
or let the blueprints supply them.

---

## The music: structure

Generation has two layers, and both follow the same idea — **start from something
known to be good, then mutate it.** How far it strays is set by the **Evolve**
slider (low = faithful to the source, high = derivative).

### Blueprints (harmony + form)

A **blueprint** (`js/library.js → BLUEPRINTS`) is a real song template: a set of
named sections, each with a roman-numeral progression, plus a realistic **section
order** and a loop for going on forever. ~18 are built in, covering every style:

- **Verse–Chorus pop**, **50s doo-wop**, **Rock anthem**, **Three-chord folk**
- **AABA standard**, **ii–V–I jazz cycle**, **Bossa ii–V chains**, **Gospel cycle**
- **12-bar blues** (`I7:4 IV7:2 I7:2 V7 IV7 I7 V7` — the canonical turnaround)
- **EDM build–drop**, **Minor club vamp**, **Cinematic minor epic**, **Andalusian cadence**
- **Trap minor loop**, **Funk one-chord vamp**, **Disco four-on-the-floor**, **Reggae one-drop**, **Ambient drift**

When you **Generate**, the arranger:

1. **Picks a blueprint** — the one you pinned in the **Blueprint** dropdown, or, on
   *Auto*, one tagged for your Style and biased to your scale's major/minor flavour.
2. **Instantiates it** in your key/scale (roman numerals → actual chords).
3. **Mutates it** by the Evolve amount — substituting chords within their
   **functional group** (tonic `I/iii/vi`, subdominant `IV/ii`, dominant `V/vii`)
   and adding the odd passing 7th. The **first chord of each section is always
   kept**, so it still resolves where you expect. At Evolve 0 it's verbatim.
4. **Lays out the structure** as a row of editable blocks.

Each section role carries musical defaults: an **intensity** (an intro is quiet,
a chorus/drop is loud) and **which parts play** (an intro might be pad + melody
only; a chorus is all four). Roles map to the **A/B/C** colours you see in the
timeline.

### The arrangement (blocks)

A song is a list of independent **blocks** — `{ type, role, progression, bars }`.
Each block is its own editable instance: select it in the timeline and change its
**type, chords, or length** without touching any other block. The **Arrangement**
timeline shows the whole song as lanes — section bands, an **intensity envelope**,
and one lane per part — that you can scroll, and that auto-follows the playhead
while playing.

### Forward forever (no looping)

The song isn't a fixed loop. As the playhead approaches the end, the arranger
**keeps composing ahead** — cycling the blueprint's loop sections (freshly mutated
each time, occasionally wandering to a related blueprint) so it develops
indefinitely and never repeats verbatim, until you press Stop.

### Melodies (motif development)

The lead line is built the same way — from **known-good shapes**, not noise.
`js/library.js → MOTIFS` holds ~21 archetypal melodic **contours** — arch,
gap-fill, neighbour-tone, pentatonic riff, call-and-response — as scale-degree
arrays, grouped by how busy they are. Each phrase:

1. **States an archetype** suited to the current density.
2. **Develops it** with classic motivic techniques, scaled by Evolve:
   **retrograde** (reverse it), **diatonic sequence** (restate it a step higher/
   lower), **fragmentation** (use just a piece), **inversion** (flip the contour),
   and phrase-end **thinning** so it breathes and cadences.
3. **Anchors to harmony** — the downbeat and the phrase's final note snap to a
   chord tone; the rest of the contour supplies the passing/neighbour motion.

So phrases sound *related and intentional* — a theme that's stated and varied —
rather than a random walk. (These contours are generic/archetypal and
public-domain idioms, not transcriptions of copyrighted melodies.)

### Voice leading & idiom

Beyond the notes, the engine applies working-musician habits: the **pad leans on
guide tones** (the 3rd & 7th) and voice-leads between them while the **bass owns the
root**; over a borrowed chord or secondary dominant the **lead borrows that chord's
own scale** for passing tones (Mixolydian over a dom7, Lydian over a bVII);
**cadences are protected** — mutation keeps each section's first *and* last chord, and
phrases land on stable degrees; the **walking bass** approaches the next root
chromatically on beat 4; strong-beat melody notes dodge the obvious clashes (the
natural-4 over a major chord, the b9 over a dom7); velocities follow a **metric accent
contour**; and at high Evolve, **idiom-aware substitutions** kick in by style —
tritone subs in jazz, the borrowed minor iv in pop.

### Energy, intensity & swing

- **Intensity envelope** — a per-bar 0–1 curve, set from each section's role and
  freely re-shaped by dragging the timeline's Intensity lane. It scales each part's
  density and activity bar by bar (build-ups, drops).
- **Energy** — a global lift on the whole envelope, set by **dragging the Intensity
  lane's label** up/down (it's no longer a separate slider).
- **Swing** — delays the offbeat sixteenths for shuffle/lo-fi/jazz feel.
- **Seed** — the generator is fully seeded (a small deterministic PRNG), so the
  same seed reproduces the same jam from the downbeat. The 🎲 reseeds for a new
  variation; type a word to keep one you like.

### Styles

A **Style** is a feel preset (24 of them, chill → energetic): it sets tempo, swing,
bass pattern, arp direction, the part densities, and per-part **gate lengths**
(staccato for funk/techno, long and legato for ambient/ballad), and it filters
which blueprints are on offer. It's a springboard — override anything after.

> Ambient · Drone/Minimal · Cinematic · Lo-fi · Ballad · Soul/R&B · Gospel · Folk ·
> Country · Reggae/Dub · Blues · Bossa Nova · Funk · Afrobeat · Disco · House ·
> Synthwave · Rock · Jazz · Techno · Trance · Trap · Drum & Bass · Metal

---

## Channel layout (defaults)

| Channel | Part         | Role                                                        |
|--------:|--------------|-------------------------------------------------------------|
| 1       | Pad          | One sustained, voice-led chord tone per chord (mono drone)  |
| 2       | Bassline     | The root; styles: roots, 8ths, offbeat, walking, syncopated |
| 3       | Arpeggiator  | Mono arpeggio spelling the chord tones (up/down/updown/random) |
| 4       | Melody       | Motif-based melodic lead that outlines the chords           |

Each part's channel is reassignable under its **⚙** settings (Ch 1–16). Plus **MIDI
Clock** (24 PPQN) + **Start / Stop / Continue** on the same port when "Send MIDI
clock" is on.

---

## The interface

The app is a control panel — the **Arrangement timeline is the hero**, with setup
tucked into a modal.

- **Top bar** — the transport (**▶ Start / Play here**, **⏸ Pause**, **⏹ Stop**,
  **Panic**), **Enable MIDI** + interface picker, **Tempo**, a **Bar** counter
  (current / total), and four beat LEDs.
- **Arrangement** — a big **Now/Next** readout (current section · bar · chord → next
  in N bars) over the timeline. Section bands, a draggable **Intensity** envelope, and
  a lane per part in its cable color. Drag the Intensity lane to shape the energy arc
  (⇧-drag = whole section); drag its **label** up/down to set global **Energy**; click
  a **part** cell to mute/unmute a bar (⇧ = whole section); click a **section** band to
  select it (and, when stopped, cue playback there). The toolbar beneath edits the
  selected section — **Type / Chords / Bars** — and carries the structure verbs.
- **Parts** — a compact strip per part: mute, name, and one **Activity** macro
  (busyness). A **⚙** reveals the patch-time controls: MIDI channel, octave, velocity,
  gate length (+ bass style / arp pattern).
- **Feel & output** — **Evolve** (faithful → derivative), **Swing**, **Seed**;
  **Output** (synth + MIDI / synth only / MIDI only), **Synth volume**, **Send MIDI
  clock**.
- **✦ New song…** opens a modal to set **Key / Scale / Style / Blueprint** and
  generate a fresh song.
- **Presets** — save/recall to the browser, or export/import JSON (the whole `state`
  is plain JSON).

## Performing live

Everything is built to be played, not just configured.

- **Transport** — **▶ Start** plays from the **selected section** (the playhead cues
  there when you pick one, and the button reads "Play here"); **⏸ Pause** holds your
  place and **▶ Resume** continues from that bar (sending MIDI *Continue* so slaved
  gear stays in sync); **⏹ Stop** rewinds to the top.
- **Quantized structure edits** — while playing, any structural change **arms to the
  next bar** (the block pulses; a strip reads "applies at bar N") and lands cleanly on
  the bar line; stopped, it applies instantly. The one-tap verbs on the selected
  section: **Reroll** (new chords), **×2 / ÷2** (length), **Repeat** (duplicate after),
  **Jump** (move playback here at the next bar).
- **Locks** — 🔒 a section and it survives **Regenerate** untouched.
- **Split generation** — **Regenerate song** (lock-aware), **Reroll section**, or
  **🎵 Melodies** (new lead/arp over the *same* chords & structure).
- **Live tweaks** — change anything mid-jam; non-armed changes land on the next bar,
  so they're musically quantised rather than glitchy. **Panic** = All-Notes-Off on
  every used channel.

**Keyboard:** `Space` play/pause · `1`–`4` mute parts · `←`/`→` step sections · `S`
snapshot.

## Look & feel

Modular Riffs is dressed as the gear it drives — a **Eurorack control panel**, not a
dashboard: warm powder-coat charcoal, silkscreen-cream type, and an **LED state
language** (amber = running, red = armed) with glow reserved for those alone. Each
part owns a **patch-cable color** — Pad blue, Bass orange-red, Arp yellow, Melody
violet — shared by the timeline lanes and the mixer, so arrangement and mix read as
one language; section roles stay desaturated so the cables stay loudest. Type is
Archivo (brand + silkscreen labels), Inter (UI), and IBM Plex Mono (all music data).
The full token system lives at the top of `styles.css`.

---

## Run it

Works the same on **macOS, Windows, and Linux** — it's a browser app. You just need
a tiny local server so the browser will grant MIDI access (see the note below). Use
**Chrome or Edge**.

**macOS / Linux:**

```bash
./serve.sh            # serves on http://localhost:8765 and opens your browser
./serve.sh 9000       # or pick a port
```

**Windows:** double-click **`serve.cmd`** (or `serve.cmd 9000`). It finds Python,
starts the server, and opens your browser. (Any static file server works — e.g.
`npx serve` if you prefer Node.)

Then in the page:

**Just to hear it (no patching):** press **▶ Start** — the built-in synth plays all
four parts. Set **Output** to *Internal synth only* if you don't want MIDI going out.

**To drive your modular:**

1. Click **Enable MIDI** and approve the browser's MIDI permission prompt.
2. Choose your **USB MIDI interface** in the output dropdown.
3. Set **Output** to *Internal synth + MIDI* (monitor while you patch) or *MIDI only*.
4. Press **▶ Start**.

> Why a local server? The Web MIDI API only works in a "secure context".
> `http://localhost` qualifies; opening the file directly (`file://`) does not.

**Browser:** Chrome or Edge (they implement Web MIDI). Safari and Firefox do not.

### Platform notes

- **macOS** — USB MIDI interfaces are class-compliant and just work; no drivers.
- **Windows** — works in Chrome/Edge. The output dropdown may also list
  **"Microsoft GS Wavetable Synth"** (Windows' built-in synth, not your hardware) —
  pick your USB interface. Windows also gives one app exclusive access to a MIDI
  port, so close any DAW holding it first.
- **Linux** — works in Chrome; make sure your user can access the ALSA MIDI device.

---

## Deploy on an always-on server (optional)

The app runs **in the browser**, and Web MIDI talks to the interface on the machine
running that browser. So:

- A **headless server** just **serves the files** — always on.
- The **studio machine** opens the app in Chrome/Edge, with the USB MIDI interface
  attached to *it*. Web MIDI on that machine drives your modular.

Web MIDI needs a **secure context**, so the app must reach the studio machine over
**HTTPS**. Put a reverse proxy (e.g. Nginx Proxy Manager, Caddy, Traefik) in front
to handle the domain + Let's Encrypt cert; the container serves plain **HTTP** on a port.

**1. On the server:**

```bash
git clone https://github.com/philoking/modularriffs.git
cd ModularRiffs
echo "HOST_PORT=7000" > .env          # optional — pick any free port
docker compose up -d --build
curl -sI http://localhost:7000/ | head -1   # sanity check: should be HTTP 200
```

Redeploy after pushing changes with `./deploy.sh`.

**2. In your reverse proxy:** add a host — forward your domain to the server's IP
+ `7000` (scheme **http**), and enable an SSL cert + Force SSL.

**3. On the studio machine:** open `https://<your-domain>/`, Enable MIDI,
pick your USB interface, and play.

### Dev → prod loop

Develop locally with `./serve.sh` (the internal synth lets you work
without any MIDI hardware). Commit, push, then run `./deploy.sh` on the server.

---

## How it works (for tinkering)

| File | Responsibility |
|------|----------------|
| `js/theory.js`    | Scales/modes, chord building, roman-numeral + chord-symbol parsing (7ths, borrowed chords, secondary dominants) |
| `js/library.js`   | **BLUEPRINTS** (song structures + progressions) and **MOTIFS** (melodic archetypes) — the "known-good starting points" |
| `js/arranger.js`  | Picks + instantiates + **mutates** a blueprint into editable blocks; per-role intensity/parts; endless forward extension |
| `js/generator.js` | The four part generators, the 24 Style presets, motif statement + development, mono enforcement, seeded RNG |
| `js/intensity.js` | The Energy ride + per-bar intensity resampling |
| `js/timeline.js`  | The Arrangement view — section/intensity/part lanes, muting, intensity drag, playhead |
| `js/scheduler.js` | Lookahead transport, 24 PPQN clock + Start/Stop/Continue, swing, pause/resume + play-from-bar, the quantized-edit boundary hook |
| `js/midi.js`      | Web MIDI output: note/clock/transport messages, panic |
| `js/synth.js`     | Built-in Web Audio synth — one voice per part, for monitoring |
| `js/app.js`       | Shared state, the whole UI, the performable edit queue, transport + keyboard shortcuts, presets |

Timing uses a **lookahead scheduler** driven by a Web Worker timer, sending each
MIDI message with an absolute timestamp so the OS MIDI layer dispatches it
precisely — tight even if the browser tab is busy. Tempo changes are integrated
incrementally, so they apply smoothly.

### Extending the libraries

Adding to `js/library.js` is the easiest high-impact change:

- **A blueprint** = `{ id, name, styles[], mode, sections{role: 'roman numerals'},
  structure[], loop[] }`. Use the chord language above; sections transpose to any key.
- **A motif** = `{ tier, shape, rhythm[{step,dur}], degrees[] }` — a scale-degree
  contour the lead will state and develop.
- Keep new melodic material **archetypal / public-domain**, never transcriptions of
  copyrighted tunes (progressions and structures are generic and fine to encode;
  specific melodies are copyrightable).

### Other ideas
- More time signatures (currently 4/4), or finer chord-per-beat resolution.
- More blueprints/motifs per genre; richer mutation operators.
- A second harmonic instrument, or per-part swing.

---

## License

Released under the [MIT License](LICENSE).
