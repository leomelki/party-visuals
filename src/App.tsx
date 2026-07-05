import { useCallback, useEffect, useRef, useState } from 'react'
import { Visualizer } from './visualizer/Visualizer'
import type { VisualizerConfig, VisualizerStatus } from './visualizer/Visualizer'
import { SCENES } from './visuals/Renderer'
import './App.css'

const INITIAL_STATUS: VisualizerStatus = {
  running: false,
  sceneIndex: 0,
  sceneName: SCENES[0].name,
  bpm: 0,
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: false,
  error: null,
}

const INITIAL_CONFIG: VisualizerConfig = {
  sensitivity: 0.5,
  strobe: true,
  strobeIntensity: 0.85,
  autoSwitch: false,
  autoSwitchBeats: 32,
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strobeRef = useRef<HTMLDivElement>(null)
  const vizRef = useRef<Visualizer | null>(null)

  const [status, setStatus] = useState<VisualizerStatus>(INITIAL_STATUS)
  const [config, setConfig] = useState<VisualizerConfig>(INITIAL_CONFIG)
  const [uiVisible, setUiVisible] = useState(true)

  // Instantiate the visualizer once the canvas exists.
  useEffect(() => {
    if (!canvasRef.current || !strobeRef.current) return
    const viz = new Visualizer(canvasRef.current, strobeRef.current, setStatus)
    viz.setConfig(INITIAL_CONFIG)
    vizRef.current = viz
    return () => viz.dispose()
  }, [])

  const updateConfig = useCallback((patch: Partial<VisualizerConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch }
      vizRef.current?.setConfig(next)
      return next
    })
  }, [])

  const start = useCallback(() => {
    void vizRef.current?.start()
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  const pickScene = useCallback((i: number) => {
    vizRef.current?.setScene(i)
    setStatus((s) => ({ ...s, sceneIndex: i, sceneName: SCENES[i].name }))
  }, [])

  // Keyboard shortcuts — the whole point is running this hands-off on a big screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const viz = vizRef.current
      if (!viz) return
      switch (e.key.toLowerCase()) {
        case ' ':
        case 'arrowright':
          viz.nextScene()
          e.preventDefault()
          break
        case 'arrowleft':
          viz.prevScene()
          break
        case 'f':
          toggleFullscreen()
          break
        case 'h':
          setUiVisible((v) => !v)
          break
        case 's':
          updateConfig({ strobe: !vizRef.current!.config.strobe })
          break
        case 'a':
          updateConfig({ autoSwitch: !vizRef.current!.config.autoSwitch })
          break
        default:
          if (e.key >= '1' && e.key <= '9') {
            const idx = Number(e.key) - 1
            if (idx < SCENES.length) pickScene(idx)
          }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFullscreen, updateConfig, pickScene])

  // Auto-hide the UI (and cursor) after a few seconds of stillness once running.
  useEffect(() => {
    if (!status.running) return
    let timer: number
    const bump = () => {
      setUiVisible(true)
      clearTimeout(timer)
      timer = window.setTimeout(() => setUiVisible(false), 3500)
    }
    bump()
    window.addEventListener('mousemove', bump)
    window.addEventListener('touchstart', bump)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', bump)
      window.removeEventListener('touchstart', bump)
    }
  }, [status.running])

  return (
    <div className={`app ${uiVisible ? '' : 'hide-cursor'}`}>
      <canvas ref={canvasRef} className="viz-canvas" />
      <div ref={strobeRef} className="strobe" />

      {!status.running && (
        <div className="intro">
          <h1>PARTY&nbsp;VISUALS</h1>
          <p className="tagline">Real-time, mic-reactive visuals for the big screen.</p>
          {status.error ? (
            <p className="error">🎤 {status.error}</p>
          ) : (
            <p className="hint">Allow microphone access, crank the speakers, go fullscreen.</p>
          )}
          <button type="button" className="start-btn" onClick={start}>
            ▶ START
          </button>
          <p className="shortcuts">
            Space / → next scene · 1–9 pick · F fullscreen · S strobe · A auto · H hide panel
          </p>
        </div>
      )}

      <div className={`panel ${status.running && uiVisible ? 'visible' : 'gone'}`}>
        <div className="panel-row scenes">
          {SCENES.map((scene, i) => (
            <button
              type="button"
              key={scene.id}
              className={`scene-btn ${i === status.sceneIndex ? 'active' : ''}`}
              onClick={() => pickScene(i)}
            >
              <span className="scene-num">{i + 1}</span>
              {scene.name}
            </button>
          ))}
        </div>

        <div className="panel-row controls">
          <label className="control">
            <span>Sensitivity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.sensitivity}
              onChange={(e) => updateConfig({ sensitivity: Number(e.target.value) })}
            />
          </label>

          <label className="control">
            <span>Strobe</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.strobeIntensity}
              disabled={!config.strobe}
              onChange={(e) => updateConfig({ strobeIntensity: Number(e.target.value) })}
            />
          </label>

          <button
            type="button"
            className={`toggle ${config.strobe ? 'on' : ''}`}
            onClick={() => updateConfig({ strobe: !config.strobe })}
          >
            Strobe {config.strobe ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            className={`toggle ${config.autoSwitch ? 'on' : ''}`}
            onClick={() => updateConfig({ autoSwitch: !config.autoSwitch })}
          >
            Auto {config.autoSwitch ? 'ON' : 'OFF'}
          </button>

          <button type="button" className="toggle" onClick={toggleFullscreen}>
            ⛶ Fullscreen
          </button>
        </div>

        <div className="panel-row meters">
          <Meter label="BASS" value={status.bass} color="#ff2d6b" />
          <Meter label="MID" value={status.mid} color="#3bffb0" />
          <Meter label="TREB" value={status.treble} color="#3b9bff" />
          <div className={`bpm ${status.beat ? 'flash' : ''}`}>
            <strong>{status.bpm || '—'}</strong>
            <span>BPM</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div
          className="meter-fill"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
    </div>
  )
}

export default App
