export const vsTerrain = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_corner;
uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex;
out float v_height01; out vec2 v_uv; flat out int v_tileId; flat out ivec2 v_t;
out vec3 v_normal;

float tileHeight(int x, int y){ return float(texelFetch(u_elevTex, ivec2(clamp(x, 0, u_gridW - 1), clamp(y, 0, u_gridH - 1)), 0).r); }
float vertexHeight(int vx, int vy){
  float sum = 0.0, n = 0.0; int tx0 = vx - 1, ty0 = vy - 1;
  if(tx0 >= 0 && ty0 >= 0 && tx0 < u_gridW && ty0 < u_gridH){ sum += tileHeight(tx0, ty0); n += 1.0; }
  if(vx  >= 0 && ty0 >= 0 && vx  < u_gridW && ty0 < u_gridH){ sum += tileHeight(vx , ty0); n += 1.0; }
  if(tx0 >= 0 && vy  >= 0 && tx0 < u_gridW && vy  < u_gridH){ sum += tileHeight(tx0, vy ); n += 1.0; }
  if(vx  >= 0 && vy  >= 0 && vx  < u_gridW && vy  < u_gridH){ sum += tileHeight(vx , vy ); n += 1.0; }
  return (n > 0.0) ? (sum / n) : 0.0;
}
vec3 rotatedIso(float x, float y, float hV) {
    vec2 p = vec2(x, y) - vec2(float(u_gridW)*0.5, float(u_gridH)*0.5);
    float c = cos(u_rotation); float s = sin(u_rotation);
    vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    vec2 world = vec2((r.x - r.y) * (u_tileW * 0.5), (r.x + r.y) * (u_tileH * 0.5));
    float depthZ = -((r.x + r.y) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006;
    return vec3(world, depthZ);
}
void main(){
  int tx = gl_InstanceID % u_gridW, ty = gl_InstanceID / u_gridW;
  v_tileId = gl_InstanceID; v_t = ivec2(tx, ty); v_uv = a_corner;
  float hV = vertexHeight(tx + int(a_corner.x), ty + int(a_corner.y));
  v_height01 = hV / 255.0;

  // Estimate the normal by looking at neighboring heights
  float hR = vertexHeight(tx + int(a_corner.x) + 1, ty + int(a_corner.y));
  float hD = vertexHeight(tx + int(a_corner.x), ty + int(a_corner.y) + 1);
  // These vectors represent the change in height over the grid distance
  // We scale the height by u_elevStep to match world-space proportions
  vec3 dx = vec3(u_tileW, (hR - hV) * u_elevStep, 0.0);
  vec3 dy = vec3(0.0, (hD - hV) * u_elevStep, u_tileH);
  v_normal = normalize(cross(dy, dx));
  
  vec3 iso = rotatedIso(float(tx) + a_corner.x, float(ty) + a_corner.y, hV);
  vec2 world = iso.xy;
  world.y -= hV * u_elevStep;
  
  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, iso.z, 1.0);
}`;

export const fsTerrain = `#version 300 es
precision highp float; precision highp int;
in float v_height01; in vec2 v_uv; flat in int v_tileId; flat in ivec2 v_t;
in vec3 v_normal;
uniform sampler2D u_paletteTex; uniform int u_selectedId; uniform int u_hasSelection;
uniform int u_levelActive; uniform ivec2 u_levelMin; uniform ivec2 u_levelMax; uniform float u_outlinePx;
uniform int u_showGrid; uniform float u_zoom; uniform float u_alpha;
out vec4 fragColor;
void main(){
  vec4 base = texture(u_paletteTex, vec2(clamp(v_height01, 0.0, 1.0), 0.5));

  // Define a light direction (imagined from the top-right/back)
  // You can adjust these values to change the sun's position
  vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));

  // Calculate Diffuse lighting (Lambertian)
  float diff = dot(v_normal, lightDir);

  // Wrap the lighting slightly so shadows aren't pitch black (Ambient)
  float shadow = mix(0.6, 1.1, clamp(diff, 0.0, 1.0));

  // Apply shadow to base color
  base.rgb *= shadow;

  float dots = smoothstep(0.2, 0.35, length(fract(v_uv * 8.0) - 0.5));
  float dotStrength = smoothstep(0.4, 1.2, u_zoom);
  float dotDarkness = mix(1.0, 0.92, dotStrength);
  base.rgb *= mix(dotDarkness, 1.0, dots);

  if(u_hasSelection == 1 && v_tileId == u_selectedId) base.rgb = mix(base.rgb, vec3(1.0, 1.0, 0.25), 0.35);
  if(u_levelActive == 1 && v_t.x >= u_levelMin.x && v_t.x <= u_levelMax.x && v_t.y >= u_levelMin.y && v_t.y <= u_levelMax.y)
    base.rgb = mix(base.rgb, vec3(0.35, 0.85, 1.0), 0.22);

  float d = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
  float gridLine = (u_showGrid == 1) ? smoothstep(0.0, u_outlinePx * max(fwidth(v_uv.x), fwidth(v_uv.y)), d) : 1.0;
  fragColor = vec4(mix(vec3(0.08), base.rgb, gridLine), u_alpha);
}`;

export const vsWater = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_corner;
uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex; uniform float u_waterLevel;
out float v_vertexH; out vec2 v_uv; flat out int v_tileId; flat out ivec2 v_t;

float tileHeight(int x, int y){ return float(texelFetch(u_elevTex, ivec2(clamp(x, 0, u_gridW - 1), clamp(y, 0, u_gridH - 1)), 0).r); }
float vertexHeight(int vx, int vy){
  float sum = 0.0, n = 0.0; int tx0 = vx - 1, ty0 = vy - 1;
  if(tx0 >= 0 && ty0 >= 0 && tx0 < u_gridW && ty0 < u_gridH){ sum += tileHeight(tx0, ty0); n += 1.0; }
  if(vx  >= 0 && ty0 >= 0 && vx  < u_gridW && ty0 < u_gridH){ sum += tileHeight(vx , ty0); n += 1.0; }
  if(tx0 >= 0 && vy  >= 0 && tx0 < u_gridW && vy  < u_gridH){ sum += tileHeight(tx0, vy ); n += 1.0; }
  if(vx  >= 0 && vy  >= 0 && vx  < u_gridW && vy  < u_gridH){ sum += tileHeight(vx , vy ); n += 1.0; }
  return (n > 0.0) ? (sum / n) : 0.0;
}
vec3 rotatedIso(float x, float y, float hV) {
    vec2 p = vec2(x, y) - vec2(float(u_gridW)*0.5, float(u_gridH)*0.5);
    float c = cos(u_rotation); float s = sin(u_rotation);
    vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    vec2 world = vec2((r.x - r.y) * (u_tileW * 0.5), (r.x + r.y) * (u_tileH * 0.5));
    float depthZ = -((r.x + r.y) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006;
    return vec3(world, depthZ);
}
void main(){
  int tx = gl_InstanceID % u_gridW, ty = gl_InstanceID / u_gridW;
  v_tileId = gl_InstanceID; v_t = ivec2(tx, ty); v_uv = a_corner;
  v_vertexH = vertexHeight(tx + int(a_corner.x), ty + int(a_corner.y));
  
  float hV = u_waterLevel;
  vec3 iso = rotatedIso(float(tx) + a_corner.x, float(ty) + a_corner.y, hV);
  vec2 world = iso.xy;
  world.y -= hV * u_elevStep;
  
  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, iso.z, 1.0);
}`;

export const fsWater = `#version 300 es
precision highp float; precision highp int;
in float v_vertexH; in vec2 v_uv; flat in ivec2 v_t;
uniform float u_waterLevel; uniform float u_alpha; uniform float u_time;
out vec4 fragColor;
void main(){
  if(v_vertexH >= u_waterLevel) discard;
  float depth = u_waterLevel - v_vertexH;
  vec3 base = vec3(120./255., 176./255., 195./255.);
  float shoreAlpha = smoothstep(0.0, 1.5, depth);
  float edge = 1.0 - smoothstep(0.08, 0.22, min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y)));
  float waves = shoreAlpha * edge * (sin(u_time * 2.2 + (float(v_t.x) * 0.27 + float(v_t.y) * 0.19) + (v_uv.x * 6.0 + v_uv.y * 6.0)) * 0.5 + 0.5);
  fragColor = vec4(base * (1.0 + waves * 0.12), (u_alpha + waves * 0.06) * shoreAlpha);
}`;

export const vsBuild = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in ivec2 a_tile;
layout(location=3) in float a_spr;

uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex; uniform vec2 u_spritePx;
out vec2 v_uv; out float v_spr;

void main(){
  float h = float(texelFetch(u_elevTex, ivec2(clamp(a_tile.x, 0, u_gridW - 1), clamp(a_tile.y, 0, u_gridH - 1)), 0).r);

  vec2 p = vec2(float(a_tile.x), float(a_tile.y) + 1.0) - vec2(float(u_gridW)*0.5, float(u_gridH)*0.5);
  float c = cos(u_rotation); float s = sin(u_rotation);
  vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 base = vec2((r.x - r.y) * (u_tileW * 0.5), (r.x + r.y) * (u_tileH * 0.5));
  float depthZ = -((r.x + r.y) / float(u_gridW + u_gridH)) - (h * 0.0006);

  vec2 localOffset = vec2(a_pos.x * u_spritePx.x, -a_pos.y * u_spritePx.y);
  vec2 world = base + vec2(0.0, -h * u_elevStep) + localOffset;

  // Shift depth forward based on vertical offset to prevent clipping into steep terrain
  float zOffset = (localOffset.y / u_elevStep) * 0.0006;

  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, depthZ + zOffset, 1.0);
  v_uv = a_uv; v_spr = a_spr;
}`;

export const fsBuild = `#version 300 es
precision highp float; in vec2 v_uv; in float v_spr; uniform sampler2D u_sheet; uniform float u_sheetCols; uniform float u_alpha; out vec4 fragColor;
void main(){
  vec4 c = texture(u_sheet, vec2(v_uv.x * (1.0 / u_sheetCols) + floor(v_spr + 0.5) * (1.0 / u_sheetCols), v_uv.y));
  if(c.a < 0.05) discard; c.a *= u_alpha; fragColor = c;
}`;

export const vsPick = vsTerrain;
export const fsPick = `#version 300 es
precision highp float; precision highp int; flat in int v_tileId; out vec4 fragColor;
void main(){ int v = v_tileId + 1; fragColor = vec4(mod(float(v), 256.0)/255.0, float((v >> 8) & 255)/255.0, float((v >> 16) & 255)/255.0, 1.0); }`;

export const vsSky = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = a_pos; // Range [0, 1]
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.9999, 1.0); // Render at far plane
}`;

export const fsSky = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_tilt;
uniform float u_rotation;
uniform vec2 u_pan;
out vec4 fragColor;

void main() {
    // Adjust horizon based on camera tilt and vertical pan
    float horizonShift = (u_tilt * 0.5) - (u_pan.y * 0.0005);
    float v = v_uv.y + horizonShift;

    // Horizontal shift based on rotation to move the "sun"
    float sunX = fract(u_rotation / 6.2831) - 0.5;
    float h = v_uv.x + sunX;

    // Sunset Colors
    vec3 space = vec3(0.10, 0.10, 0.25);  // Deep Indigo
    vec3 sunset = vec3(1.0, 0.35, 0.1);   // Burning Orange
    vec3 horizon = vec3(1.0, 0.7, 0.3);   // Golden Glow

    // Create the vertical gradient
    vec3 color = mix(sunset, space, smoothstep(0.4, 0.9, v));
    color = mix(horizon, color, smoothstep(0.3, 0.5, v));

    // Add a subtle radial "glow" for the sun location
    float sunGlow = 1.0 - distance(vec2(h, v), vec2(0.5, 0.4));
    color += sunset * pow(max(0.0, sunGlow), 4.0) * 0.5;

    fragColor = vec4(color, 1.0);
}`;

export const vsExtrude = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_zOffset;
layout(location=2) in vec3 a_normal;
layout(location=3) in vec3 a_color;

uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex;

out vec3 v_normal;
out vec3 v_color;

float getInterpolatedHeight(vec2 pos) {
    vec2 p = clamp(pos, vec2(0.0), vec2(float(u_gridW - 1), float(u_gridH - 1)));
    ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
    float h00 = float(texelFetch(u_elevTex, i, 0).r);
    float h10 = float(texelFetch(u_elevTex, i + ivec2(1, 0), 0).r);
    float h01 = float(texelFetch(u_elevTex, i + ivec2(0, 1), 0).r);
    float h11 = float(texelFetch(u_elevTex, i + ivec2(1, 1), 0).r);
    float h0 = mix(h00, h10, f.x); float h1 = mix(h01, h11, f.x);
    return mix(h0, h1, f.y);
}

void main() {
    float hV = getInterpolatedHeight(a_pos);
    vec2 p = a_pos - vec2(float(u_gridW)*0.5, float(u_gridH)*0.5);
    float c = cos(u_rotation); float s = sin(u_rotation);
    vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    vec2 world = vec2((r.x - r.y) * (u_tileW * 0.5), (r.x + r.y) * (u_tileH * 0.5));
    float depthZ = -((r.x + r.y) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006 - a_zOffset * 0.001;

    world.y -= hV * u_elevStep + (a_zOffset * u_elevStep);

    vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
    gl_Position = vec4(clip, depthZ, 1.0);
    v_normal = a_normal;
    v_color = a_color;
}`;

export const fsExtrude = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
out vec4 fragColor;
void main() {
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
    float diff = max(dot(normalize(v_normal), lightDir), 0.0);
    float shadow = mix(0.5, 1.0, diff);
    fragColor = vec4(v_color * shadow, 1.0);
}`;

export const vsEditor = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;

uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex;

float getInterpolatedHeight(vec2 pos) {
    vec2 p = clamp(pos, vec2(0.0), vec2(float(u_gridW - 1), float(u_gridH - 1)));
    ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
    float h00 = float(texelFetch(u_elevTex, i, 0).r);
    float h10 = float(texelFetch(u_elevTex, i + ivec2(1, 0), 0).r);
    float h01 = float(texelFetch(u_elevTex, i + ivec2(0, 1), 0).r);
    float h11 = float(texelFetch(u_elevTex, i + ivec2(1, 1), 0).r);
    float h0 = mix(h00, h10, f.x); float h1 = mix(h01, h11, f.x);
    return mix(h0, h1, f.y);
}

void main() {
    float hV = getInterpolatedHeight(a_pos);
    vec2 p = a_pos - vec2(float(u_gridW)*0.5, float(u_gridH)*0.5);
    float c = cos(u_rotation); float s = sin(u_rotation);
    vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    vec2 world = vec2((r.x - r.y) * (u_tileW * 0.5), (r.x + r.y) * (u_tileH * 0.5));
    // Pop it slightly forward (-0.002) so it doesn't z-fight with the geometry
    float depthZ = -((r.x + r.y) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006 - 0.002;

    world.y -= hV * u_elevStep;

    vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
    gl_Position = vec4(clip, depthZ, 1.0);
    gl_PointSize = 12.0;
}`;

export const fsEditor = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
    // Draw circles instead of flat squares
    vec2 pc = gl_PointCoord - vec2(0.5);
    if(length(pc) > 0.5) discard;
    fragColor = vec4(1.0, 0.85, 0.1, 1.0); // Editor Yellow
}`;

export const vsLemming = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_angle;
layout(location=2) in vec3 a_color;
layout(location=3) in float a_size;
layout(location=4) in float a_dance;
layout(location=5) in float a_glisten;
layout(location=6) in float a_age;

uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex;

out vec3 v_color;
out float v_angle;
out float v_dance;
out float v_glisten;
out float v_age;
out float v_pointSizeWorld;

float getInterpolatedHeight(vec2 pos) {
    vec2 p = clamp(pos, vec2(0.0), vec2(float(u_gridW - 1), float(u_gridH - 1)));
    ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
    float h00 = float(texelFetch(u_elevTex, i, 0).r);
    float h10 = float(texelFetch(u_elevTex, i + ivec2(1, 0), 0).r);
    float h01 = float(texelFetch(u_elevTex, i + ivec2(0, 1), 0).r);
    float h11 = float(texelFetch(u_elevTex, i + ivec2(1, 1), 0).r);
    float h0 = mix(h00, h10, f.x); float h1 = mix(h01, h11, f.x);
    return mix(h0, h1, f.y);
}

void main() {
    float hV = getInterpolatedHeight(a_pos);
    vec2 p = a_pos - vec2(float(u_gridW)*0.5, float(u_gridH)*0.5);
    float c = cos(u_rotation); float s = sin(u_rotation);
    vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    vec2 world = vec2((r.x - r.y) * (u_tileW * 0.5), (r.x + r.y) * (u_tileH * 0.5));
    float depthZ = -((r.x + r.y) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006 - 0.002;

    // Make the point larger so we have enough canvas to draw a procedural person
    float pSize = max(16.0, 48.0 * u_zoom) * a_size;
    gl_PointSize = pSize;
    v_pointSizeWorld = pSize / u_zoom;

    world.y -= hV * u_elevStep;

    // Shift the point sprite up so the visual feet (at uv.y = -0.6) sit exactly on the terrain anchor point
    world.y -= 0.6 * (v_pointSizeWorld * 0.5);

    vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
    gl_Position = vec4(clip, depthZ, 1.0);
    v_color = a_color;

    // Add camera rotation to the lemming's world angle so they flip directions relative to the screen
    v_angle = a_angle + u_rotation;

    v_dance = a_dance;
    v_glisten = a_glisten;
    v_age = a_age;
}`;

export const fsLemming = `#version 300 es
precision highp float;
in vec3 v_color;
in float v_angle;
in float v_dance;
in float v_glisten;
in float v_age;
in float v_pointSizeWorld;
uniform float u_time;
uniform float u_elevStep;
out vec4 fragColor;

// Helper to draw lines for limbs
float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    // Remap gl_PointCoord to [-1, 1], flip Y so positive is up
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    uv.y = -uv.y;

    // Pivot the depth exactly at the feet (uv.y = -0.6) so they perfectly match the terrain depth
    float yWorldOffset = -(uv.y + 0.6) * (v_pointSizeWorld * 0.5);
    float zOffset = (yWorldOffset / u_elevStep) * 0.0006;
    
    // Multiply by 0.5 because clip-space Z maps to half-scale in window-space depth
    gl_FragDepth = gl_FragCoord.z + zOffset * 0.5;

    // Face left or right based on projected angle
    float facing = sign(cos(v_angle));
    if (facing == 0.0) facing = 1.0;
    uv.x *= facing;

    // Walk cycle animation (offset by angle so they don't all march perfectly in sync)
    float walk = u_time * 15.0 + v_angle * 10.0;
    // Time calculations for regular walk vs dance
    float danceTime = u_time * 24.0 + v_angle * 5.0;

    // Bob up and down (jump higher when dancing)
    float walkBob = abs(sin(walk)) * 0.08;
    float danceBob = abs(sin(danceTime)) * 0.15 + 0.05;
    uv.y -= mix(walkBob, danceBob, v_dance);

    float d = 1.0;
    float r = 0.12; // Limb thickness

    // --- Hip Sway Logic ---
    float hipSway = sin(danceTime * 0.5) * 0.2 * v_dance;
    vec2 hipPos = vec2(hipSway, -0.2);

    // Calculate how badly their back hurts (starts slumping after 60)
    float slump = clamp((v_age - 60.0) * 0.005, 0.0, 0.25);

    // 1. Head (Offset forward by slump)
    vec2 headPos = vec2(hipSway * 0.3 + (slump * 1.5), 0.5 - slump);
    d = min(d, length(uv - headPos) - 0.2);

    // 2. Torso (Offset shoulders forward by slump)
    vec2 shoulderPos = vec2(slump, 0.3 - (slump * 0.5));
    d = min(d, sdSegment(uv, shoulderPos, hipPos) - r);

    // 3. Legs (Anchored to the moving hips instead of 0.0)
    vec2 leftFoot = mix(
        vec2(sin(walk)*0.3, -0.6 + cos(walk)*0.1),
        vec2(-0.2 - sin(danceTime)*0.1, -0.6 + cos(danceTime)*0.2), // Tapping out
        v_dance
    );
    vec2 rightFoot = mix(
        vec2(-sin(walk)*0.3, -0.6 - cos(walk)*0.1),
        vec2(0.2 + sin(danceTime)*0.1, -0.6 + sin(danceTime)*0.2), // Tapping out
        v_dance
    );
    d = min(d, sdSegment(uv, hipPos, leftFoot) - r);
    d = min(d, sdSegment(uv, hipPos, rightFoot) - r);

    // 4. Arms (Waving side to side with the groove)
    vec2 leftHand = mix(
        vec2(-cos(walk)*0.3, 0.0 - sin(walk)*0.1),
        vec2(-0.4 + hipSway, 0.1 + sin(danceTime)*0.2),
        v_dance
    );
    vec2 rightHand = mix(
        vec2(cos(walk)*0.3, 0.0 + sin(walk)*0.1),
        vec2(0.4 + hipSway, 0.1 + cos(danceTime)*0.2),
        v_dance
    );
    vec2 armPivot = vec2(0.0, 0.2); // Pivot just below the shoulders
    d = min(d, sdSegment(uv, armPivot, leftHand) - 0.08);
    d = min(d, sdSegment(uv, armPivot, rightHand) - 0.08);

    // Smooth anti-aliasing
    float alpha = smoothstep(0.05, 0.0, d);
    if (alpha < 0.1) discard;

    // Inner shadow/outline effect
    vec3 col = mix(v_color * 0.4, v_color, smoothstep(-0.05, 0.0, d));

    if (v_glisten > 0.0) {
        float g = (sin(u_time * 15.0 + uv.x * 20.0 - uv.y * 10.0) * 0.5 + 0.5) * min(v_glisten, 1.0);
        col += vec3(1.0, 1.0, 0.8) * g; // Adds a bright golden-white shine
    }
    fragColor = vec4(col, alpha);
}`;
