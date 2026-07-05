// AudioEngine — captures the microphone and extracts musically-meaningful
// features every frame: frequency bands, overall level, a beat detector, and a
// spectral-flux onset detector. Everything is auto-gained so the visuals stay
// lively whether the room is quiet or slammed.

export interface AudioBands {
  sub: number // 20-60 Hz    (the deep floor rumble)
  bass: number // 60-160 Hz   (kick drum)
  lowMid: number // 160-500 Hz  (bass guitar, low vocals)
  mid: number // 500-2k Hz   (vocals, snare body)
  highMid: number // 2k-6k Hz    (presence, snare crack)
  treble: number // 6k-16k Hz   (hats, cymbals, air)
}

export interface AudioFeatures {
  level: number // overall loudness, auto-gained 0..1
  bands: AudioBands // per-band energy, each auto-gained 0..1
  beat: boolean // a kick/beat landed on this frame
  beatStrength: number // how far above the local average the beat was
  beatEnergy: number // smooth decaying pulse 0..1 (great for visuals)
  impact: number // sharp elastic 0..1 pop on every beat (for zoom/flash punch)
  bassPunch: number // fast-attack/slow-release bass envelope 0..1 (pumps)
  beatAge: number // seconds since the last beat (drives expanding shockwaves)
  bpm: number // running tempo estimate
  flux: number // spectral flux, auto-gained 0..1 (transient energy)
  onset: boolean // a broadband transient (hat/clap) landed this frame
  spectrum: Uint8Array // 128-bin log-scaled spectrum for the shaders (0..255)
}

export interface AudioEngineConfig {
  // 0..1 — higher makes the beat detector and normalisation more eager.
  sensitivity: number
}

const BAND_EDGES_HZ: Array<[keyof AudioBands, number, number]> = [
  ['sub', 20, 60],
  ['bass', 60, 160],
  ['lowMid', 160, 500],
  ['mid', 500, 2000],
  ['highMid', 2000, 6000],
  ['treble', 6000, 16000],
]

const HISTORY = 60 // ~1s of frames for the beat detector's local window
const SPECTRUM_BINS = 128

// A one-pole envelope that tracks a running maximum with slow decay. Dividing a
// signal by its envelope gives us cheap, smooth auto-gain.
class PeakFollower {
  private value = 0.001
  private readonly decay: number
  private readonly floor: number
  constructor(decay: number, floor: number) {
    this.decay = decay
    this.floor = floor
  }
  push(x: number): number {
    this.value = Math.max(x, this.value * this.decay, this.floor)
    return x / this.value
  }
}

export class AudioEngine {
  config: AudioEngineConfig = { sensitivity: 0.5 }

  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private freq = new Uint8Array(0) // raw byte spectrum
  private prevFreq = new Float32Array(0) // previous frame, for spectral flux
  private binHz = 0

  // Auto-gain followers.
  private levelPeak = new PeakFollower(0.9995, 0.02)
  private bandPeaks = new Map<keyof AudioBands, PeakFollower>()
  private fluxPeak = new PeakFollower(0.998, 0.001)

  // Beat detector state.
  private bassHistory: number[] = []
  private beatEnergy = 0
  private impact = 0
  private bassPunch = 0
  private lastBeatTime = 0
  private beatIntervals: number[] = []
  private bpm = 0

  private spectrum = new Uint8Array(SPECTRUM_BINS)
  private spectrumBinMap: number[][] = []

  constructor() {
    for (const [name] of BAND_EDGES_HZ) {
      this.bandPeaks.set(name, new PeakFollower(0.9995, 0.02))
    }
  }

  get isRunning(): boolean {
    return this.ctx !== null
  }

  async start(): Promise<void> {
    if (this.ctx) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // We want the raw signal — these "helpful" DSP steps flatten the music.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    })

    const ctx = new AudioContext()
    await ctx.resume()
    const source = ctx.createMediaStreamSource(this.stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.55
    source.connect(analyser)

    this.ctx = ctx
    this.analyser = analyser
    this.binHz = ctx.sampleRate / analyser.fftSize
    this.freq = new Uint8Array(analyser.frequencyBinCount)
    this.prevFreq = new Float32Array(analyser.frequencyBinCount)
    this.buildSpectrumMap(analyser.frequencyBinCount)
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
    this.stream = null
  }

  // Pre-compute which FFT bins feed each of the log-spaced display bins so the
  // spectrum texture has rich low-end detail (where music lives) per frame.
  private buildSpectrumMap(binCount: number): void {
    const minHz = 30
    const maxHz = 17000
    const map: number[][] = []
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const f0 = minHz * Math.pow(maxHz / minHz, i / SPECTRUM_BINS)
      const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / SPECTRUM_BINS)
      const b0 = Math.min(binCount - 1, Math.max(0, Math.floor(f0 / this.binHz)))
      const b1 = Math.min(binCount - 1, Math.max(b0, Math.floor(f1 / this.binHz)))
      const bins: number[] = []
      for (let b = b0; b <= b1; b++) bins.push(b)
      map.push(bins)
    }
    this.spectrumBinMap = map
  }

  private bandEnergy(loHz: number, hiHz: number): number {
    const lo = Math.max(1, Math.floor(loHz / this.binHz))
    const hi = Math.min(this.freq.length - 1, Math.ceil(hiHz / this.binHz))
    let sum = 0
    for (let i = lo; i <= hi; i++) sum += this.freq[i]
    return sum / (hi - lo + 1) / 255
  }

  // Called once per animation frame; returns null until start() has run.
  update(now: number): AudioFeatures | null {
    const analyser = this.analyser
    if (!analyser) return null
    analyser.getByteFrequencyData(this.freq)

    const sens = this.config.sensitivity

    // --- Per-band energy, auto-gained ---
    const bands = {} as AudioBands
    let levelAccum = 0
    for (const [name, lo, hi] of BAND_EDGES_HZ) {
      const raw = this.bandEnergy(lo, hi)
      const norm = Math.min(1, this.bandPeaks.get(name)!.push(raw) * (0.6 + sens))
      bands[name] = norm
      levelAccum += raw
    }
    const level = Math.min(1, this.levelPeak.push(levelAccum / BAND_EDGES_HZ.length) * (0.6 + sens))

    // --- Spectral flux: sum of positive changes across the spectrum ---
    let flux = 0
    for (let i = 0; i < this.freq.length; i++) {
      const v = this.freq[i] / 255
      const d = v - this.prevFreq[i]
      if (d > 0) flux += d
      this.prevFreq[i] = v
    }
    flux /= this.freq.length
    const fluxNorm = Math.min(1, this.fluxPeak.push(flux) * (0.6 + sens))
    const onset = fluxNorm > 0.55

    // --- Beat detection on the kick band (energy vs. local variance) ---
    const instant = (bands.sub + bands.bass) * 0.5
    const hist = this.bassHistory
    hist.push(instant)
    if (hist.length > HISTORY) hist.shift()
    let avg = 0
    for (const v of hist) avg += v
    avg /= hist.length
    let variance = 0
    for (const v of hist) variance += (v - avg) * (v - avg)
    variance /= hist.length

    // Louder + steadier passages need a higher bar; the sensitivity slider
    // shifts the whole threshold. Classic energy-beat detection, tuned.
    const thresholdMul = 1.05 + (1 - sens) * 0.6 + variance * 8
    const refractoryMs = 120 // ignore double-triggers faster than ~500 BPM
    let beat = false
    let beatStrength = 0
    if (
      instant > avg * thresholdMul &&
      instant > 0.12 &&
      now - this.lastBeatTime > refractoryMs
    ) {
      beat = true
      beatStrength = Math.min(1, (instant - avg) / (avg + 0.001))
      if (this.lastBeatTime > 0) {
        const interval = now - this.lastBeatTime
        if (interval < 2000) {
          this.beatIntervals.push(interval)
          if (this.beatIntervals.length > 16) this.beatIntervals.shift()
          const sorted = [...this.beatIntervals].sort((a, b) => a - b)
          const median = sorted[sorted.length >> 1]
          this.bpm = Math.round(60000 / median)
        }
      }
      this.lastBeatTime = now
    }

    // Smooth decaying pulse — the workhorse for driving visual flashes.
    this.beatEnergy = Math.max(this.beatEnergy * 0.9, beat ? Math.max(0.6, beatStrength) : 0)

    // Impact: a normalised, sharp elastic pop that fires to full on every beat
    // regardless of strength, then snaps back — great for zoom/flash punches.
    this.impact = Math.max(this.impact * 0.86, beat ? 1 : 0)

    // BassPunch: instant attack, slow release. Sits high while the low end is
    // driving and eases down in the gaps, so shapes visibly "pump" with the bass.
    const bassNow = Math.max(bands.sub, bands.bass)
    this.bassPunch = bassNow > this.bassPunch ? bassNow : this.bassPunch * 0.9

    const beatAge = Math.min(4, (now - this.lastBeatTime) / 1000)

    // --- Log-scaled spectrum for the shaders ---
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const bins = this.spectrumBinMap[i]
      let m = 0
      for (const b of bins) m = Math.max(m, this.freq[b])
      // Slight upward tilt so the airy high end stays visible.
      this.spectrum[i] = Math.min(255, m * (1 + i / SPECTRUM_BINS))
    }

    return {
      level,
      bands,
      beat,
      beatStrength,
      beatEnergy: this.beatEnergy,
      impact: this.impact,
      bassPunch: this.bassPunch,
      beatAge,
      bpm: this.bpm,
      flux: fluxNorm,
      onset,
      spectrum: this.spectrum,
    }
  }
}
