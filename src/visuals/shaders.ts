// GLSL for the visualizer. Every scene shares one vertex shader (a fullscreen
// triangle) and a common fragment prelude that declares the audio uniforms and
// a few helpers, so each scene only has to supply its main() body.

export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;
// A single oversized triangle covering the viewport — no vertex buffer needed.
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAGMENT_PRELUDE = /* glsl */ `#version 300 es
precision highp float;

uniform vec2  u_res;       // viewport size in pixels
uniform float u_time;      // seconds since start
uniform float u_level;     // overall loudness 0..1
uniform float u_sub;
uniform float u_bass;
uniform float u_lowMid;
uniform float u_mid;
uniform float u_highMid;
uniform float u_treble;
uniform float u_beat;      // decaying beat pulse 0..1
uniform float u_flux;      // broadband transient energy 0..1
uniform float u_hue;       // slowly rotating base hue 0..1
uniform float u_travel;    // ever-increasing "forward" distance (bass-driven)
uniform float u_spin;      // ever-increasing rotation (mid-driven)
uniform sampler2D u_spectrum; // 128x1 log spectrum, value in .r

out vec4 fragColor;

const float TAU = 6.28318530718;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Centered coordinates, aspect-corrected so shapes stay round.
vec2 uvCentered() {
  return (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
}

float spectrumAt(float x) {
  return texture(u_spectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}
`

export interface SceneDef {
  id: string
  name: string
  body: string // the main() { ... } for this scene
}

// --- Scenes ------------------------------------------------------------------

const TUNNEL: SceneDef = {
  id: 'tunnel',
  name: 'Neon Tunnel',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  uv *= rot(u_spin * 0.2);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float depth = u_travel * 1.5 + 0.35 / (r + 0.06);
  float ang = a / TAU + 0.5;

  float rings = sin(depth * TAU);
  float stripes = sin(ang * 24.0 + depth * 2.0);
  float grid = smoothstep(0.6, 1.0, max(abs(rings), abs(stripes) * 0.9));
  float glow = 0.14 / (r + 0.02);

  float hue = fract(u_hue + depth * 0.04 + ang * 0.1);
  vec3 col = hsv2rgb(vec3(hue, 0.85, 1.0));
  col *= grid * (0.5 + u_treble * 1.6) + glow * (0.25 + u_bass * 2.2);
  col += vec3(1.0) * u_beat * grid * 0.9;
  col *= smoothstep(0.0, 0.14, r); // fade the far center to black
  fragColor = vec4(col, 1.0);
}`,
}

const KALEIDOSCOPE: SceneDef = {
  id: 'kaleido',
  name: 'Kaleidoscope',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float seg = TAU / (6.0 + floor(u_mid * 6.0));
  a = abs(mod(a, seg) - seg * 0.5);
  uv = vec2(cos(a), sin(a)) * r;
  uv *= rot(u_time * 0.1 + u_spin * 0.3);
  uv /= (0.5 + u_bass * 0.7); // breathe with the bass

  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    uv = abs(uv) / dot(uv, uv) - (0.7 + 0.2 * sin(u_time * 0.3 + u_travel * 0.2));
    v += length(uv);
  }
  float hue = fract(u_hue + v * 0.08 + r * 0.2);
  vec3 col = hsv2rgb(vec3(hue, 0.9, 1.0));
  col *= 0.35 + v * 0.14 * (0.6 + u_treble * 1.5);
  col += u_beat * 0.5;
  fragColor = vec4(col, 1.0);
}`,
}

const WARP: SceneDef = {
  id: 'warp',
  name: 'Hyperspace',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  uv *= rot(u_spin * 0.15);
  vec3 col = vec3(0.0);
  const int STARS = 90;
  for (int i = 0; i < STARS; i++) {
    float fi = float(i);
    float seed = hash21(vec2(fi, 3.7));
    float speed = 0.15 + u_bass * 1.1;
    float z = fract(seed + u_travel * speed * (0.4 + seed));
    float rad = z * z * 1.7;               // perspective acceleration outward
    float ang = seed * TAU + sin(fi) * 3.0;
    vec2 sp = vec2(cos(ang), sin(ang)) * rad;
    float d = length(uv - sp);
    float size = 0.006 + 0.02 * z;
    float b = pow(size / (d + 0.001), 1.4) * z;
    col += hsv2rgb(vec3(fract(u_hue + seed), 0.55, 1.0)) * b;
  }
  col *= 0.4 + u_level * 1.6;
  col += u_beat * 0.3;
  fragColor = vec4(col, 1.0);
}`,
}

const PLASMA: SceneDef = {
  id: 'plasma',
  name: 'Liquid Plasma',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  float t = u_time * 0.4;
  float d = u_bass * 2.5;
  float v = 0.0;
  v += sin(uv.x * 3.0 + t + d * sin(uv.y * 2.0));
  v += sin((uv.y * 3.5 - t * 1.2) + d);
  v += sin(length(uv) * 6.0 - t * 2.0 + u_travel);
  v += sin(dot(uv, uv) * 4.0 + t * 1.5);
  v *= 0.25;
  float hue = fract(u_hue + v * 0.5);
  vec3 col = hsv2rgb(vec3(hue, 0.85, 1.0));
  col *= 0.55 + 0.5 * sin(v * TAU * (1.0 + u_mid * 1.5));
  col += u_beat * 0.6;
  col *= 0.7 + u_level * 0.9;
  fragColor = vec4(col, 1.0);
}`,
}

const SPECTRUM: SceneDef = {
  id: 'spectrum',
  name: 'Radial Spectrum',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  uv *= rot(u_spin * 0.2);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float x = abs(a / 3.14159265);       // 0..1, mirrored left/right
  float amp = spectrumAt(x);
  float base = 0.26;
  float top = base + amp * 0.55;

  float bar = smoothstep(0.02, 0.0, abs(r - top));           // bright rim
  float fill = step(base, r) * smoothstep(top, top - 0.012, r); // filled bar

  float hue = fract(u_hue + x * 0.7);
  vec3 col = hsv2rgb(vec3(hue, 0.9, 1.0));
  vec3 outc = col * (fill * (0.4 + amp) + bar * 1.6);
  outc += hsv2rgb(vec3(u_hue, 0.6, 1.0)) * (0.08 / (r + 0.05)) * u_bass;
  outc += u_beat * 0.3 * col;
  fragColor = vec4(outc, 1.0);
}`,
}

const FRACTAL: SceneDef = {
  id: 'fractal',
  name: 'Julia Bloom',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  uv *= 1.4 / (1.0 + u_beat * 0.5 + u_bass * 0.3); // zoom pulse on the beat
  uv *= rot(u_spin * 0.1);
  vec2 c = vec2(0.7885 * cos(u_time * 0.2 + u_travel * 0.1),
                0.7885 * sin(u_time * 0.13));
  c += (u_mid - 0.2) * 0.12;
  vec2 z = uv * 1.5;
  const float MAX = 64.0;
  float it = 0.0;
  for (int i = 0; i < 64; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 4.0) break;
    it += 1.0;
  }
  float m = it / MAX;
  float hue = fract(u_hue + m * 0.8 + 0.5 * u_treble);
  vec3 col = hsv2rgb(vec3(hue, 0.85, m < 1.0 ? 1.0 : 0.0));
  col *= 0.3 + m * 1.3;
  col += u_beat * 0.25;
  fragColor = vec4(col, 1.0);
}`,
}

const GRID: SceneDef = {
  id: 'grid',
  name: 'Synthwave Grid',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  vec3 sky = mix(hsv2rgb(vec3(fract(u_hue + 0.75), 0.7, 0.45)),
                 hsv2rgb(vec3(u_hue, 0.9, 0.12)), uv.y * 0.5 + 0.5);
  vec3 col = sky;

  if (uv.y < -0.02) {
    float persp = 1.0 / (-uv.y + 0.001);
    vec2 g = vec2(uv.x * persp, persp - u_travel * 2.0);
    vec2 grid = abs(fract(g * 0.5) - 0.5);
    float line = smoothstep(0.06, 0.0, min(grid.x, grid.y));
    vec3 gc = hsv2rgb(vec3(fract(u_hue + 0.5), 0.9, 1.0));
    col = mix(col, gc, line * (0.5 + u_bass));
    col += gc * line * u_beat;
    col *= smoothstep(0.0, 0.35, -uv.y); // fade toward the horizon
  } else {
    vec2 p = uv - vec2(0.0, 0.18);
    float r = length(p);
    float sun = smoothstep(0.35, 0.335, r);
    float x = clamp(uv.x * 1.4 + 0.5, 0.0, 1.0);
    float amp = spectrumAt(x);
    float slit = step(fract(uv.y * 34.0), 0.35 + (uv.y + 0.15) * 2.5);
    vec3 sunc = mix(hsv2rgb(vec3(0.13, 0.9, 1.0)),
                    hsv2rgb(vec3(0.96, 0.95, 1.0)), uv.y);
    col = mix(col, sunc, sun * slit);
    col += amp * 0.18 * hsv2rgb(vec3(fract(u_hue + 0.5), 0.8, 1.0));
  }
  col += u_beat * 0.12;
  fragColor = vec4(col, 1.0);
}`,
}

export const SCENES: SceneDef[] = [
  TUNNEL,
  WARP,
  KALEIDOSCOPE,
  PLASMA,
  SPECTRUM,
  FRACTAL,
  GRID,
]

export function fragmentSource(scene: SceneDef): string {
  return FRAGMENT_PRELUDE + '\n' + scene.body
}
