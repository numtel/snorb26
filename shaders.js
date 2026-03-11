export const vsTerrain = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_corner;
uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH;
uniform highp usampler2D u_elevTex;
out float v_height01; out vec2 v_uv; flat out int v_tileId; flat out ivec2 v_t;

vec2 isoPoint(int x, int y){
  return vec2((float(x) - float(y)) * (u_tileW * 0.5), (float(x) + float(y)) * (u_tileH * 0.5));
}
float tileHeight(int x, int y){
  return float(texelFetch(u_elevTex, ivec2(clamp(x, 0, u_gridW - 1), clamp(y, 0, u_gridH - 1)), 0).r);
}
float vertexHeight(int vx, int vy){
  float sum = 0.0, n = 0.0;
  int tx0 = vx - 1, ty0 = vy - 1;
  if(tx0 >= 0 && ty0 >= 0 && tx0 < u_gridW && ty0 < u_gridH){ sum += tileHeight(tx0, ty0); n += 1.0; }
  if(vx  >= 0 && ty0 >= 0 && vx  < u_gridW && ty0 < u_gridH){ sum += tileHeight(vx , ty0); n += 1.0; }
  if(tx0 >= 0 && vy  >= 0 && tx0 < u_gridW && vy  < u_gridH){ sum += tileHeight(tx0, vy ); n += 1.0; }
  if(vx  >= 0 && vy  >= 0 && vx  < u_gridW && vy  < u_gridH){ sum += tileHeight(vx , vy ); n += 1.0; }
  return (n > 0.0) ? (sum / n) : 0.0;
}
void main(){
  int tx = gl_InstanceID % u_gridW, ty = gl_InstanceID / u_gridW;
  v_height01 = tileHeight(tx, ty) / 255.0;
  v_tileId = gl_InstanceID; v_t = ivec2(tx, ty); v_uv = a_corner;
  float hV = vertexHeight(tx + int(a_corner.x), ty + int(a_corner.y));
  vec2 world = isoPoint(tx + int(a_corner.x), ty + int(a_corner.y));
  world.y -= hV * u_elevStep;
  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, 1.0 - (float(tx + ty) / float(max(1, u_gridW + u_gridH - 2))) - hV * 0.0006, 1.0);
}`;

export const fsTerrain = `#version 300 es
precision highp float; precision highp int;
in float v_height01; in vec2 v_uv; flat in int v_tileId; flat in ivec2 v_t;
uniform sampler2D u_paletteTex; uniform int u_selectedId; uniform int u_hasSelection;
uniform int u_levelActive; uniform ivec2 u_levelMin; uniform ivec2 u_levelMax; uniform float u_outlinePx;
out vec4 fragColor;
void main(){
  vec4 base = texture(u_paletteTex, vec2(clamp(v_height01, 0.0, 1.0), 0.5));
  if(u_hasSelection == 1 && v_tileId == u_selectedId) base.rgb = mix(base.rgb, vec3(1.0, 1.0, 0.25), 0.35);
  if(u_levelActive == 1 && v_t.x >= u_levelMin.x && v_t.x <= u_levelMax.x && v_t.y >= u_levelMin.y && v_t.y <= u_levelMax.y)
    base.rgb = mix(base.rgb, vec3(0.35, 0.85, 1.0), 0.22);
  float d = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
  fragColor = vec4(mix(vec3(0.08), base.rgb, smoothstep(0.0, u_outlinePx * max(fwidth(v_uv.x), fwidth(v_uv.y)), d)), 1.0);
}`;

export const vsWater = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_corner;
uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom;
uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH;
uniform highp usampler2D u_elevTex;
uniform float u_waterLevel;
out float v_tileH; out vec2 v_uv; flat out int v_tileId; flat out ivec2 v_t;

vec2 isoPoint(int x, int y){
  return vec2((float(x) - float(y)) * (u_tileW * 0.5), (float(x) + float(y)) * (u_tileH * 0.5));
}

float tileHeight(int x, int y){
  return float(texelFetch(u_elevTex, ivec2(clamp(x, 0, u_gridW - 1), clamp(y, 0, u_gridH - 1)), 0).r);
}

void main(){
  int tx = gl_InstanceID % u_gridW, ty = gl_InstanceID / u_gridW;
  v_tileH = tileHeight(tx, ty);
  v_tileId = gl_InstanceID; v_t = ivec2(tx, ty); v_uv = a_corner;

  float hV = u_waterLevel;
  vec2 world = isoPoint(tx + int(a_corner.x), ty + int(a_corner.y));
  world.y -= hV * u_elevStep;
  vec2 clip = (((world - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, 1.0 - (float(tx + ty) / float(max(1, u_gridW + u_gridH - 2))) - hV * 0.0006, 1.0);
}`;
export const fsWater = `#version 300 es
precision highp float; precision highp int;
in float v_tileH; in vec2 v_uv; flat in ivec2 v_t;
uniform sampler2D u_paletteTex; uniform float u_waterLevel; uniform float u_alpha; uniform float u_time;
uniform int u_gridW; uniform int u_gridH; uniform highp usampler2D u_elevTex;
out vec4 fragColor;
float tH(int x, int y){ return float(texelFetch(u_elevTex, ivec2(clamp(x, 0, u_gridW - 1), clamp(y, 0, u_gridH - 1)), 0).r); }
void main(){
  if(v_tileH >= u_waterLevel) discard;
  vec3 base = texture(u_paletteTex, vec2(clamp((u_waterLevel - 6.0) / 255.0, 0.0, 1.0), 0.5)).rgb;
  float shore = step(u_waterLevel, max(max(tH(v_t.x-1, v_t.y), tH(v_t.x+1, v_t.y)), max(tH(v_t.x, v_t.y-1), tH(v_t.x, v_t.y+1))));
  float edge = 1.0 - smoothstep(0.08, 0.22, min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y)));
  float waves = shore * edge * (sin(u_time * 2.2 + (float(v_t.x) * 0.27 + float(v_t.y) * 0.19) + (v_uv.x * 6.0 + v_uv.y * 6.0)) * 0.5 + 0.5);
  fragColor = vec4(base * (1.0 + waves * 0.12), u_alpha + waves * 0.06);
}`;

export const vsBuild = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec2 a_pos; layout(location=1) in vec2 a_uv; layout(location=2) in ivec2 a_tile; layout(location=3) in float a_spr;
uniform vec2 u_viewSize; uniform vec2 u_pan; uniform float u_zoom; uniform float u_tileW; uniform float u_tileH; uniform float u_elevStep;
uniform int u_gridW; uniform int u_gridH; uniform highp usampler2D u_elevTex; uniform vec2 u_spritePx;
out vec2 v_uv; out float v_spr;
void main(){
  float h = float(texelFetch(u_elevTex, ivec2(clamp(a_tile.x, 0, u_gridW - 1), clamp(a_tile.y, 0, u_gridH - 1)), 0).r);
  vec2 base = vec2((float(a_tile.x) - float(a_tile.y)) * (u_tileW * 0.5), (float(a_tile.x) + float(a_tile.y) + 1.0) * (u_tileH * 0.5));
  vec2 clip = ((((base + vec2(0, -h * u_elevStep) + vec2(a_pos.x * u_spritePx.x, -a_pos.y * u_spritePx.y)) - u_pan) * u_zoom + (u_viewSize * 0.5)) / u_viewSize) * 2.0 - 1.0; clip.y *= -1.0;
  gl_Position = vec4(clip, 1.0 - (float(a_tile.x + a_tile.y) / float(max(1, u_gridW + u_gridH - 2))) - h * 0.0006 - 0.00085, 1.0);
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
