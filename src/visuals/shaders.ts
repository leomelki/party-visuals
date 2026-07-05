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
uniform float u_beat;      // decaying beat pulse 0..1 (scales with strength)
uniform float u_impact;    // sharp elastic 0..1 pop, full on every beat
uniform float u_bassPunch; // fast-attack / slow-release bass envelope 0..1
uniform float u_beatAge;   // seconds since the last beat
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

// A bright ring that expands from the centre on every beat and fades out — the
// single most effective way to make a kick physically visible on screen.
float shockwave(float r, float speed, float width) {
  float radius = u_beatAge * speed;
  float ring = smoothstep(width, 0.0, abs(r - radius));
  float fade = exp(-u_beatAge * 3.2);
  return ring * fade;
}

// Punchy tone-map: lifts brightness on impact and keeps colour from clipping ugly.
vec3 bloom(vec3 c, float amount) {
  return c * (1.0 + amount) / (1.0 + amount * dot(c, vec3(0.2)));
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
  float r0 = length(uv);
  uv *= 1.0 - u_impact * 0.14;          // beat zoom-punch toward the viewer
  uv *= rot(u_spin * 0.2);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float depth = u_travel * 1.5 + 0.35 / (r + 0.06);
  float ang = a / TAU + 0.5;

  float rings = sin(depth * TAU);
  float stripes = sin(ang * 24.0 + depth * 2.0);
  float grid = smoothstep(0.55, 1.0, max(abs(rings), abs(stripes) * 0.9));
  float glow = 0.14 / (r + 0.02);

  float hue = fract(u_hue + depth * 0.04 + ang * 0.1);
  vec3 col = hsv2rgb(vec3(hue, 0.85, 1.0));
  col *= grid * (0.5 + u_treble * 2.0) + glow * (0.25 + u_bassPunch * 3.8);
  col += vec3(1.0) * u_impact * grid * 1.2;                       // beat flash
  col += hsv2rgb(vec3(fract(u_hue + 0.5), 0.7, 1.0)) * shockwave(r0, 1.5, 0.06) * 1.8;
  col *= smoothstep(0.0, 0.14, r);       // fade the far centre to black
  fragColor = vec4(bloom(col, u_impact * 0.7 + u_bassPunch * 0.3), 1.0);
}`,
}

const KALEIDOSCOPE: SceneDef = {
  id: 'kaleido',
  name: 'Kaleidoscope',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  float r0 = length(uv);
  uv *= 1.0 - u_impact * 0.12;
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float seg = TAU / (6.0 + floor(u_mid * 6.0));
  a = abs(mod(a, seg) - seg * 0.5);
  uv = vec2(cos(a), sin(a)) * r;
  uv *= rot(u_time * 0.1 + u_spin * 0.3);
  uv /= (0.42 + u_bassPunch * 1.0);      // breathe hard with the bass

  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    uv = abs(uv) / dot(uv, uv) - (0.7 + 0.2 * sin(u_time * 0.3 + u_travel * 0.2));
    v += length(uv);
  }
  float hue = fract(u_hue + v * 0.08 + r * 0.2);
  vec3 col = hsv2rgb(vec3(hue, 0.9, 1.0));
  col *= 0.35 + v * 0.14 * (0.6 + u_treble * 1.9);
  col += u_impact * 0.7;
  col += hsv2rgb(vec3(fract(u_hue + 0.5), 0.8, 1.0)) * shockwave(r0, 1.3, 0.05) * 1.2;
  fragColor = vec4(bloom(col, u_impact * 0.6), 1.0);
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
  // On a kick the stars stretch into long light-streaks — a warp-speed jump.
  float streakLen = 0.05 + u_impact * 0.55 + u_bassPunch * 0.25;
  const int STARS = 90;
  for (int i = 0; i < STARS; i++) {
    float fi = float(i);
    float seed = hash21(vec2(fi, 3.7));
    float speed = 0.15 + u_bass * 1.2;
    float z = fract(seed + u_travel * speed * (0.4 + seed));
    float rad = z * z * 1.8;                 // perspective acceleration outward
    float ang = seed * TAU + sin(fi) * 3.0;
    vec2 dir = vec2(cos(ang), sin(ang));
    // Project onto the star's outward ray to draw a streak instead of a dot.
    float along = dot(uv, dir);
    float perp = length(uv - dir * along);
    float len = streakLen * (0.3 + z);
    float onLine = smoothstep(0.006 + 0.012 * z, 0.0, perp);
    float within = step(max(0.0, rad - len), along) * step(along, rad);
    float head = smoothstep(0.03 + 0.03 * z, 0.0, length(uv - dir * rad));
    float b = (onLine * within * (0.4 + z) + head) * z;
    col += hsv2rgb(vec3(fract(u_hue + seed), 0.55, 1.0)) * b;
  }
  col += hsv2rgb(vec3(u_hue, 0.5, 1.0)) * (0.06 / (length(uv) + 0.04)) * u_bassPunch;
  col *= 0.4 + u_level * 1.7;
  fragColor = vec4(bloom(col, u_impact * 0.8), 1.0);
}`,
}

const PLASMA: SceneDef = {
  id: 'plasma',
  name: 'Liquid Plasma',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  float t = u_time * 0.4;
  float d = u_bassPunch * 4.5;            // bass warps the whole field
  float v = 0.0;
  v += sin(uv.x * 3.0 + t + d * sin(uv.y * 2.0));
  v += sin((uv.y * 3.5 - t * 1.2) + d);
  v += sin(length(uv) * 6.0 - t * 2.0 + u_travel + u_impact * 3.0);
  v += sin(dot(uv, uv) * 4.0 + t * 1.5);
  v *= 0.25;
  float hue = fract(u_hue + v * 0.5);
  vec3 col = hsv2rgb(vec3(hue, 0.85, 1.0));
  col *= 0.55 + 0.5 * sin(v * TAU * (1.0 + u_mid * 2.0));
  col += u_impact * 0.8;
  col += shockwave(length(uv), 1.6, 0.09) * 1.4;
  col *= 0.6 + u_level * 1.1 + u_bassPunch * 0.4;
  fragColor = vec4(bloom(col, u_impact * 0.6), 1.0);
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
  float base = 0.24;
  float top = base + amp * (0.6 + u_bassPunch * 0.35);

  float bar = smoothstep(0.02, 0.0, abs(r - top));               // bright rim
  float fill = step(base, r) * smoothstep(top, top - 0.012, r);  // filled bar

  float hue = fract(u_hue + x * 0.7);
  vec3 col = hsv2rgb(vec3(hue, 0.9, 1.0));
  vec3 outc = col * (fill * (0.4 + amp * 1.3) + bar * 1.8);
  // Pulsing bass core in the middle.
  float core = smoothstep(base, base - 0.12 - u_bassPunch * 0.12, r);
  outc += hsv2rgb(vec3(u_hue, 0.6, 1.0)) * core * (0.3 + u_bassPunch * 1.5);
  outc += col * shockwave(r, 1.4, 0.05) * 1.3;
  outc += u_impact * 0.35 * col;
  fragColor = vec4(bloom(outc, u_impact * 0.5), 1.0);
}`,
}

const FRACTAL: SceneDef = {
  id: 'fractal',
  name: 'Julia Bloom',
  body: /* glsl */ `
void main() {
  vec2 uv = uvCentered();
  uv *= 1.5 / (1.0 + u_impact * 0.8 + u_bassPunch * 0.6); // zoom-pop on the beat
  uv *= rot(u_spin * 0.1);
  vec2 c = vec2(0.7885 * cos(u_time * 0.2 + u_travel * 0.1),
                0.7885 * sin(u_time * 0.13));
  c += (u_mid - 0.2) * 0.14 + u_impact * 0.09;            // morph shape on kick
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
  col *= 0.3 + m * 1.3 + u_bassPunch * 0.35;
  col += u_impact * 0.35;
  fragColor = vec4(bloom(col, u_impact * 0.5), 1.0);
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
    // A ripple travels out along the floor on each beat.
    float ripple = sin(persp * 1.5 - u_beatAge * 8.0) * exp(-u_beatAge * 3.0);
    vec2 g = vec2(uv.x * persp, persp - u_travel * 2.0);
    vec2 grid = abs(fract(g * 0.5) - 0.5);
    float line = smoothstep(0.06, 0.0, min(grid.x, grid.y));
    vec3 gc = hsv2rgb(vec3(fract(u_hue + 0.5), 0.9, 1.0));
    col = mix(col, gc, line * (0.5 + u_bassPunch * 1.4));
    col += gc * line * (u_impact * 1.5 + max(0.0, ripple) * u_impact);
    col *= smoothstep(0.0, 0.35, -uv.y);   // fade toward the horizon
  } else {
    vec2 p = uv - vec2(0.0, 0.18);
    float r = length(p);
    float sun = smoothstep(0.35 + u_bassPunch * 0.06, 0.335 + u_bassPunch * 0.06, r);
    float x = clamp(uv.x * 1.4 + 0.5, 0.0, 1.0);
    float amp = spectrumAt(x);
    float slit = step(fract(uv.y * 34.0), 0.35 + (uv.y + 0.15) * 2.5);
    vec3 sunc = mix(hsv2rgb(vec3(0.13, 0.9, 1.0)),
                    hsv2rgb(vec3(0.96, 0.95, 1.0)), uv.y);
    col = mix(col, sunc, sun * slit);
    col += amp * 0.22 * hsv2rgb(vec3(fract(u_hue + 0.5), 0.8, 1.0));
    col += u_impact * 0.25 * smoothstep(0.4, 0.0, abs(uv.y)); // horizon flash
  }
  fragColor = vec4(bloom(col, u_impact * 0.45), 1.0);
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
