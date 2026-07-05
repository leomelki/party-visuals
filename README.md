# Party Visuals

Real-time, microphone-reactive visuals for parties — built to fill a projector or
big screen with movement, colour and beat-synced strobing. Point it at the room
(or the speaker output), hit **Start**, go fullscreen, and let the music drive it.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL, allow microphone access, and press **START**. Use a browser
tab whose audio the mic can hear (or a loopback/aggregate audio device to capture
the system output directly for the cleanest signal).

## How the sound analysis works

All analysis runs off a Web Audio `AnalyserNode` (2048-point FFT), in
`src/audio/AudioEngine.ts`:

- **Frequency bands** — the spectrum is split into six perceptual bands mapped to
  real Hz ranges (sub, bass, low-mid, mid, high-mid, treble) so different
  instruments drive different parts of the visuals.
- **Auto-gain** — every band and the overall level pass through a peak-follower
  that tracks a slowly-decaying maximum, so the visuals stay responsive whether
  the room is quiet or the system is slammed. No manual level-setting needed.
- **Beat detection** — an energy-vs-local-variance detector on the kick band
  (sub+bass) with a refractory period rejects double-triggers and yields a live
  **BPM** estimate plus a smooth decaying beat pulse used everywhere in the shaders.
- **Spectral flux** — the sum of positive frame-to-frame spectrum changes detects
  broadband transients (hats, claps, snares) independently of the kick, driving
  the finer strobe/onset flashes.

## The visuals

Each scene is a fullscreen WebGL2 fragment shader (`src/visuals/shaders.ts`) fed a
shared set of audio uniforms — the bands, the beat pulse, spectral flux, plus
ever-increasing `travel`/`spin`/`hue` accumulators so motion keeps flowing at
silence and surges on drops. A live 128-bin log-scaled spectrum is uploaded as a
texture for the spectrum-based scenes.

1. **Neon Tunnel** — flight through a glowing tunnel; speed follows the bass.
2. **Hyperspace** — warp-speed starfield; stars stretch into streaks on the kick.
3. **Aurora Flow** — domain-warped fractal noise, flowing liquid curtains of light.
4. **Liquid Plasma** — flowing plasma field, distorted by low end, flashed by beats.
5. **Liquid Orbs** — gooey metaballs that swell with the bass and jump on the beat.
6. **Kaleidoscope** — mirrored fractal folds that breathe with the bass.
7. **Radial Spectrum** — the live spectrum drawn as a mirrored radial bar burst.
8. **Waveform** — the actual audio waveform as a glowing neon oscilloscope ribbon.
9. **Julia Bloom** — an animated Julia fractal that zoom-pulses on every beat.
10. **Neon Lattice** — a raymarched 3D grid of glowing tubes you fly through.
11. **Synthwave Grid** — scrolling perspective grid + spectrum sun.

A full-screen **stroboscope** overlay flashes white on beats/onsets (toggle and
intensity in the panel).

## Controls & shortcuts

The control panel auto-hides after a few seconds of stillness (move the mouse to
bring it back). Keyboard:

| Key | Action |
| --- | --- |
| `Space` / `→` | Next scene |
| `←` | Previous scene |
| `1`–`9` | Jump to a scene |
| `F` | Toggle fullscreen |
| `S` | Toggle strobe |
| `A` | Toggle auto scene-switching (rotates every N beats) |
| `H` | Hide/show the control panel |

Sensitivity and strobe intensity are sliders in the panel.
