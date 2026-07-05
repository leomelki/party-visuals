// Visualizer — the conductor. Owns the audio engine, the WebGL renderer and the
// DOM strobe overlay, and runs the single requestAnimationFrame loop that ties
// them together. React talks to it through plain methods and a status callback;
// the per-frame work never touches React state so rendering stays smooth.

import { AudioEngine } from '../audio/AudioEngine'
import type { AudioFeatures } from '../audio/AudioEngine'
import { Renderer, SCENES } from '../visuals/Renderer'
import type { RenderState } from '../visuals/Renderer'

export interface VisualizerConfig {
  sensitivity: number // 0..1, forwarded to the audio engine
  strobe: boolean // fire the white flash overlay on beats
  strobeIntensity: number // 0..1 peak opacity of a flash
  autoSwitch: boolean // rotate scenes automatically
  autoSwitchBeats: number // how many beats between auto switches
}

export interface VisualizerStatus {
  running: boolean
  sceneIndex: number
  sceneName: string
  bpm: number
  level: number
  bass: number
  mid: number
  treble: number
  beat: boolean
  error: string | null
}

const DEFAULT_CONFIG: VisualizerConfig = {
  sensitivity: 0.5,
  strobe: true,
  strobeIntensity: 0.85,
  autoSwitch: false,
  autoSwitchBeats: 32,
}

export class Visualizer {
  config: VisualizerConfig = { ...DEFAULT_CONFIG }

  private audio = new AudioEngine()
  private renderer: Renderer
  private strobeEl: HTMLElement
  private onStatus: (s: VisualizerStatus) => void

  private raf = 0
  private running = false
  private startTime = 0
  private lastFrame = 0
  private sceneIndex = 0
  private beatsSinceSwitch = 0
  private strobeLevel = 0
  private error: string | null = null

  // Persisted "motion" accumulators so the visuals keep flowing forward even
  // through quiet passages, but surge with the music.
  private state: RenderState = { time: 0, hue: 0, travel: 0, spin: 0 }

  private statusThrottle = 0

  constructor(
    canvas: HTMLCanvasElement,
    strobeEl: HTMLElement,
    onStatus: (s: VisualizerStatus) => void,
  ) {
    this.renderer = new Renderer(canvas)
    this.strobeEl = strobeEl
    this.onStatus = onStatus
  }

  async start(): Promise<void> {
    if (this.running) return
    try {
      this.audio.config.sensitivity = this.config.sensitivity
      await this.audio.start()
      this.error = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      this.emitStatus(null)
      return
    }
    this.running = true
    this.startTime = performance.now()
    this.lastFrame = this.startTime
    this.loop(this.startTime)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.audio.stop()
    this.strobeEl.style.opacity = '0'
    this.emitStatus(null)
  }

  setConfig(patch: Partial<VisualizerConfig>): void {
    this.config = { ...this.config, ...patch }
    this.audio.config.sensitivity = this.config.sensitivity
  }

  setScene(index: number): void {
    this.sceneIndex = ((index % SCENES.length) + SCENES.length) % SCENES.length
    this.beatsSinceSwitch = 0
  }

  nextScene(): void {
    this.setScene(this.sceneIndex + 1)
  }

  prevScene(): void {
    this.setScene(this.sceneIndex - 1)
  }

  get scenes() {
    return SCENES
  }

  dispose(): void {
    this.stop()
    this.renderer.dispose()
  }

  private loop = (now: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)

    const dt = Math.min(0.05, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.renderer.resize()

    const features = this.audio.update(now)
    if (!features) return

    this.advanceMotion(dt, features)
    this.handleAutoSwitch(features)
    this.handleStrobe(dt, features)

    this.renderer.render(SCENES[this.sceneIndex], features, this.state)
    this.emitStatus(features)
  }

  // Drive the accumulators. Base speeds keep everything alive at silence; audio
  // adds surge on top so drops and builds feel physical.
  private advanceMotion(dt: number, f: AudioFeatures): void {
    const s = this.state
    s.time += dt
    s.travel += dt * (0.25 + f.bands.bass * 2.2 + f.beatEnergy * 1.5)
    s.spin += dt * (0.15 + (f.bands.mid + f.bands.highMid) * 0.9)
    // Hue drifts continuously and kicks forward on every beat for colour pops.
    s.hue = (s.hue + dt * 0.03 + (f.beat ? 0.04 : 0)) % 1
  }

  private handleAutoSwitch(f: AudioFeatures): void {
    if (!this.config.autoSwitch || !f.beat) return
    this.beatsSinceSwitch++
    if (this.beatsSinceSwitch >= this.config.autoSwitchBeats) {
      this.nextScene()
    }
  }

  private handleStrobe(dt: number, f: AudioFeatures): void {
    if (this.config.strobe && (f.beat || f.onset)) {
      const hit = f.beat ? Math.max(0.7, f.beatStrength) : f.flux * 0.8
      this.strobeLevel = Math.max(this.strobeLevel, hit * this.config.strobeIntensity)
    }
    // Fast exponential decay (~45ms time constant) gives a crisp stroboscopic
    // snap rather than a soft fade — a flash lands in well under a beat.
    this.strobeLevel *= Math.exp(-dt / 0.045)
    if (this.strobeLevel < 0.01) this.strobeLevel = 0
    this.strobeEl.style.opacity = String(this.strobeLevel)
  }

  private emitStatus(f: AudioFeatures | null): void {
    // Throttle React updates to ~15 Hz; the render loop itself is unthrottled.
    const nowMs = this.lastFrame
    if (f && nowMs - this.statusThrottle < 66) return
    this.statusThrottle = nowMs
    this.onStatus({
      running: this.running,
      sceneIndex: this.sceneIndex,
      sceneName: SCENES[this.sceneIndex].name,
      bpm: f?.bpm ?? 0,
      level: f?.level ?? 0,
      bass: f?.bands.bass ?? 0,
      mid: f?.bands.mid ?? 0,
      treble: f?.bands.treble ?? 0,
      beat: f?.beat ?? false,
      error: this.error,
    })
  }
}
