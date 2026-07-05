// Renderer — a thin WebGL2 wrapper that runs one fullscreen fragment shader per
// scene and feeds it the audio uniforms. Scene programs are compiled lazily and
// cached; the live spectrum lives in a 128x1 texture updated each frame.

import { SCENES, VERTEX_SHADER, fragmentSource } from './shaders'
import type { SceneDef } from './shaders'
import type { AudioFeatures } from '../audio/AudioEngine'

// Everything the renderer needs for a frame beyond the raw audio features.
export interface RenderState {
  time: number // seconds
  hue: number // 0..1
  travel: number // accumulated forward distance
  spin: number // accumulated rotation
}

const UNIFORM_NAMES = [
  'u_res', 'u_time', 'u_level', 'u_sub', 'u_bass', 'u_lowMid', 'u_mid',
  'u_highMid', 'u_treble', 'u_beat', 'u_impact', 'u_bassPunch', 'u_beatAge',
  'u_flux', 'u_hue', 'u_travel', 'u_spin', 'u_spectrum', 'u_wave',
] as const

type UniformMap = Partial<Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>>

interface CompiledScene {
  program: WebGLProgram
  uniforms: UniformMap
}

export class Renderer {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private spectrumTex: WebGLTexture
  private waveTex: WebGLTexture
  private vertexShader: WebGLShader
  private programs = new Map<string, CompiledScene>()

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL2 is not available in this browser.')
    this.gl = gl

    this.vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER)

    // Empty VAO — the fullscreen triangle is generated from gl_VertexID.
    this.vao = gl.createVertexArray()!

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.spectrumTex = this.createDataTexture(128)
    this.waveTex = this.createDataTexture(256)
  }

  // A width x1 single-channel (R8) texture we stream audio data into each frame.
  private createDataTexture(width: number): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, 1, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error(`Shader compile failed: ${log}`)
    }
    return shader
  }

  private getScene(scene: SceneDef): CompiledScene {
    const cached = this.programs.get(scene.id)
    if (cached) return cached

    const gl = this.gl
    const frag = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource(scene))
    const program = gl.createProgram()!
    gl.attachShader(program, this.vertexShader)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    gl.deleteShader(frag)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      throw new Error(`Program link failed for "${scene.id}": ${log}`)
    }

    const uniforms: UniformMap = {}
    for (const name of UNIFORM_NAMES) {
      uniforms[name] = gl.getUniformLocation(program, name)
    }
    const compiled = { program, uniforms }
    this.programs.set(scene.id, compiled)
    return compiled
  }

  // Match the drawing buffer to the element's on-screen size (accounting for
  // display density). Returns true if the size changed.
  resize(): boolean {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.floor(canvas.clientWidth * dpr)
    const h = Math.floor(canvas.clientHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      return true
    }
    return false
  }

  render(scene: SceneDef, features: AudioFeatures, state: RenderState): void {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const { program, uniforms: u } = this.getScene(scene)

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)
    gl.bindVertexArray(this.vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.spectrumTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 1, gl.RED, gl.UNSIGNED_BYTE, features.spectrum)
    if (u.u_spectrum != null) gl.uniform1i(u.u_spectrum, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, features.waveform)
    if (u.u_wave != null) gl.uniform1i(u.u_wave, 1)

    const b = features.bands
    if (u.u_res != null) gl.uniform2f(u.u_res, canvas.width, canvas.height)
    if (u.u_time != null) gl.uniform1f(u.u_time, state.time)
    if (u.u_level != null) gl.uniform1f(u.u_level, features.level)
    if (u.u_sub != null) gl.uniform1f(u.u_sub, b.sub)
    if (u.u_bass != null) gl.uniform1f(u.u_bass, b.bass)
    if (u.u_lowMid != null) gl.uniform1f(u.u_lowMid, b.lowMid)
    if (u.u_mid != null) gl.uniform1f(u.u_mid, b.mid)
    if (u.u_highMid != null) gl.uniform1f(u.u_highMid, b.highMid)
    if (u.u_treble != null) gl.uniform1f(u.u_treble, b.treble)
    if (u.u_beat != null) gl.uniform1f(u.u_beat, features.beatEnergy)
    if (u.u_impact != null) gl.uniform1f(u.u_impact, features.impact)
    if (u.u_bassPunch != null) gl.uniform1f(u.u_bassPunch, features.bassPunch)
    if (u.u_beatAge != null) gl.uniform1f(u.u_beatAge, features.beatAge)
    if (u.u_flux != null) gl.uniform1f(u.u_flux, features.flux)
    if (u.u_hue != null) gl.uniform1f(u.u_hue, state.hue)
    if (u.u_travel != null) gl.uniform1f(u.u_travel, state.travel)
    if (u.u_spin != null) gl.uniform1f(u.u_spin, state.spin)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const gl = this.gl
    for (const { program } of this.programs.values()) gl.deleteProgram(program)
    this.programs.clear()
    gl.deleteTexture(this.spectrumTex)
    gl.deleteTexture(this.waveTex)
    gl.deleteShader(this.vertexShader)
  }
}

export { SCENES }
