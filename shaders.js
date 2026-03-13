export const vsTerrain = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_corner;
uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform float u_rotation;
uniform highp usampler2D u_elevTex;
out float v_height01; out vec2 v_uv; flat out int v_tileId; flat out ivec2 v_t;

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
    float depthZ = 1.0 - ((r.x + r.y + float(u_gridW + u_gridH)*0.5) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006;
    return vec3(world, depthZ);
}
void main(){
  int tx = gl_InstanceID % u_gridW, ty = gl_InstanceID / u_gridW;
  v_tileId = gl_InstanceID; v_t = ivec2(tx, ty); v_uv = a_corner;
  float hV = vertexHeight(tx + int(a_corner.x), ty + int(a_corner.y));
  v_height01 = hV / 255.0;
  
  vec3 iso = rotatedIso(float(tx) + a_corner.x, float(ty) + a_corner.y, hV);
  vec2 world = iso.xy;
  world.y -= hV * u_elevStep;
  
  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, iso.z, 1.0);
}`;

export const fsTerrain = `#version 300 es
precision highp float; precision highp int;
in float v_height01; in vec2 v_uv; flat in int v_tileId; flat in ivec2 v_t;
uniform sampler2D u_paletteTex; uniform int u_selectedId; uniform int u_hasSelection;
uniform int u_levelActive; uniform ivec2 u_levelMin; uniform ivec2 u_levelMax; uniform float u_outlinePx;
uniform int u_showGrid; uniform float u_zoom;
out vec4 fragColor;
void main(){
  vec4 base = texture(u_paletteTex, vec2(clamp(v_height01, 0.0, 1.0), 0.5));
  float dots = smoothstep(0.2, 0.35, length(fract(v_uv * 8.0) - 0.5));
  float dotStrength = smoothstep(0.4, 1.2, u_zoom);
  float dotDarkness = mix(1.0, 0.92, dotStrength);
  base.rgb *= mix(dotDarkness, 1.0, dots);

  if(u_hasSelection == 1 && v_tileId == u_selectedId) base.rgb = mix(base.rgb, vec3(1.0, 1.0, 0.25), 0.35);
  if(u_levelActive == 1 && v_t.x >= u_levelMin.x && v_t.x <= u_levelMax.x && v_t.y >= u_levelMin.y && v_t.y <= u_levelMax.y)
    base.rgb = mix(base.rgb, vec3(0.35, 0.85, 1.0), 0.22);

  float d = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
  float gridLine = (u_showGrid == 1) ? smoothstep(0.0, u_outlinePx * max(fwidth(v_uv.x), fwidth(v_uv.y)), d) : 1.0;
  fragColor = vec4(mix(vec3(0.08), base.rgb, gridLine), 1.0);
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
    float depthZ = 1.0 - ((r.x + r.y + float(u_gridW + u_gridH)*0.5) / float(max(1, u_gridW + u_gridH))) - hV * 0.0006;
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
  float depthZ = 1.0 - ((r.x + r.y + float(u_gridW + u_gridH)*0.5) / float(u_gridW + u_gridH)) - (h * 0.0006);

  vec2 localOffset = vec2(a_pos.x * u_spritePx.x, -a_pos.y * u_spritePx.y);
  vec2 world = base + vec2(0.0, -h * u_elevStep) + localOffset;

  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, depthZ, 1.0);
  v_uv = a_uv; v_spr = a_spr;
}`;

export const fsBuild = `#version 300 es
precision highp float; in vec2 v_uv; in float v_spr; uniform sampler2D u_sheet; uniform float u_sheetCols; out vec4 fragColor;
void main(){
  vec4 c = texture(u_sheet, vec2(v_uv.x * (1.0 / u_sheetCols) + floor(v_spr + 0.5) * (1.0 / u_sheetCols), v_uv.y));
  if(c.a < 0.05) discard; fragColor = c;
}`;

export const vsPick = vsTerrain;
export const fsPick = `#version 300 es
precision highp float; precision highp int; flat in int v_tileId; out vec4 fragColor;
void main(){ int v = v_tileId + 1; fragColor = vec4(mod(float(v), 256.0)/255.0, float((v >> 8) & 255)/255.0, float((v >> 16) & 255)/255.0, 1.0); }`;
