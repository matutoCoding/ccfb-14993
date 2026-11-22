// 检测工位渲染着色器:双层折射光线追迹 + 斑马板/路面场景
export const STATION_WGSL = /* wgsl */ `
struct U {
  eye: vec4f,     // xyz 眼点, w 模式(0 斑马板 1 路面)
  board: vec4f,   // 板距, 条纹角(rad), 周期, 保留
  glass: vec4f,   // 玻璃宽, 高, 内层厚, PVB厚
  misc: vec4f,    // 外层厚, 玻璃折射率, PVB折射率, 路面高度
  meta: vec4f,    // 高度场 x0, y0, dx, dy
  meta2: vec4f,   // 场 nx, ny, 画布宽, 画布高
  view: vec4f,    // 视野半宽, 半高(玻璃坐标), 保留, 保留
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fieldTex: texture_2d<f32>;

struct FS {
  z: vec4f,
  gx: vec4f,
  gy: vec4f,
}

fn sampleFieldG(p: vec2f) -> FS {
  let fx = clamp((p.x - u.meta.x) / u.meta.z, 0.0, u.meta2.x - 1.001);
  let fy = clamp((p.y - u.meta.y) / u.meta.w, 0.0, u.meta2.y - 1.001);
  let i = i32(floor(fx));
  let j = i32(floor(fy));
  let fu = fx - floor(fx);
  let fv = fy - floor(fy);
  let c00 = textureLoad(fieldTex, vec2i(i, j), 0);
  let c10 = textureLoad(fieldTex, vec2i(i + 1, j), 0);
  let c01 = textureLoad(fieldTex, vec2i(i, j + 1), 0);
  let c11 = textureLoad(fieldTex, vec2i(i + 1, j + 1), 0);
  var out: FS;
  out.z = mix(mix(c00, c10, fu), mix(c01, c11, fu), fv);
  out.gx = (mix(c10, c11, fv) - mix(c00, c01, fv)) / u.meta.z;
  out.gy = (mix(c01, c11, fu) - mix(c00, c10, fu)) / u.meta.w;
  return out;
}

fn insideF(p: vec2f) -> bool {
  return p.x >= u.meta.x && p.x <= u.meta.x + u.meta.z * (u.meta2.x - 1.0) &&
         p.y >= u.meta.y && p.y <= u.meta.y + u.meta.w * (u.meta2.y - 1.0);
}

// 与某一层面高度场求交,未命中返回 -1
fn intersectLayer(o: vec3f, d: vec3f, layer: i32) -> f32 {
  let x1 = u.meta.x + u.meta.z * (u.meta2.x - 1.0);
  let y1 = u.meta.y + u.meta.w * (u.meta2.y - 1.0);
  var tEnter = -1e30;
  var tExit = 1e30;
  if (abs(d.x) > 1e-12) {
    var ta = (u.meta.x - o.x) / d.x;
    var tb = (x1 - o.x) / d.x;
    if (ta > tb) { let tmp = ta; ta = tb; tb = tmp; }
    tEnter = max(tEnter, ta);
    tExit = min(tExit, tb);
  } else if (o.x < u.meta.x || o.x > x1) { return -1.0; }
  if (abs(d.y) > 1e-12) {
    var ta = (u.meta.y - o.y) / d.y;
    var tb = (y1 - o.y) / d.y;
    if (ta > tb) { let tmp = ta; ta = tb; tb = tmp; }
    tEnter = max(tEnter, ta);
    tExit = min(tExit, tb);
  } else if (o.y < u.meta.y || o.y > y1) { return -1.0; }
  if (tEnter >= tExit || tExit < 0.0) { return -1.0; }
  var t = (0.0 - o.z) / d.z;
  t = max(max(t, tEnter), 0.0);
  if (t >= tExit) { t = (tEnter + tExit) * 0.5; }
  for (var k = 0; k < 10; k++) {
    let p = o + t * d;
    if (!insideF(p.xy)) {
      t = (t + max(tEnter, 0.0)) * 0.5;
      continue;
    }
    let fld = sampleFieldG(p.xy);
    let g = p.z - fld.z[layer];
    let dg = d.z - (fld.gx[layer] * d.x + fld.gy[layer] * d.y);
    if (abs(dg) < 1e-12) { return -1.0; }
    t -= g / dg;
    if (t < 0.0) { return -1.0; }
    if (abs(g) < 1e-9) { return t; }
  }
  return t;
}

fn refractV(i: vec3f, n: vec3f, n1: f32, n2: f32) -> vec3f {
  var nn = n;
  var cosI = -dot(i, nn);
  if (cosI < 0.0) {
    nn = -nn;
    cosI = -dot(i, nn);
  }
  let eta = n1 / n2;
  let s2 = eta * eta * (1.0 - cosI * cosI);
  if (s2 > 1.0) { return vec3f(0.0, 0.0, -1.0); }
  let cosT = sqrt(1.0 - s2);
  return normalize(eta * i + (eta * cosI - cosT) * nn);
}

fn stripeIntensity(phase: f32) -> f32 {
  let idx = round(phase);
  if (idx == 0.0 && abs(phase) < 0.5) { return 0.5; }
  let f = phase - floor(phase);
  return select(0.08, 1.0, f < 0.5);
}

fn roadScene(eye: vec3f, d: vec3f) -> vec3f {
  if (d.y < -1e-4) {
    let t = (u.misc.w - eye.y) / d.y;
    let x = eye.x + d.x * t;
    let z = eye.z + d.z * t;
    var lane = 0.0;
    let lanes = array<f32, 4>(1.75, -1.75, 5.25, -5.25);
    for (var k = 0; k < 4; k++) {
      if (abs(x - lanes[k]) < 0.08 && (z % 10.0) < 4.0) { lane = 1.0; }
    }
    let fog = clamp((t - 30.0) / 120.0, 0.0, 1.0);
    let base = mix(vec3f(0.32, 0.33, 0.35), vec3f(0.92, 0.92, 0.9), lane);
    let sky = vec3f(0.62, 0.72, 0.82);
    return mix(base, sky, fog);
  }
  let g = clamp(d.y * 3.0, 0.0, 1.0);
  return vec3f(0.62 + 0.25 * g, 0.72 + 0.2 * g, 0.82 + 0.15 * g);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ndc = vec2f(fc.x / u.meta2.z * 2.0 - 1.0, 1.0 - fc.y / u.meta2.w * 2.0);
  let gx = ndc.x * u.view.x;
  let gy = ndc.y * u.view.y;
  let eye = u.eye.xyz;
  let inGlass = abs(gx) <= u.glass.x * 0.5 && abs(gy) <= u.glass.y * 0.5;
  // 目标点:玻璃外表面(第 4 层)上的点
  var dir: vec3f;
  var p = eye;
  if (inGlass) {
    let zb = sampleFieldG(vec2f(gx, gy)).z[3];
    dir = normalize(vec3f(gx, gy, zb) - eye);
    // 依次穿过 4 个界面
    let media = array<f32, 5>(1.0, u.misc.y, u.misc.z, u.misc.y, 1.0);
    var ok = true;
    for (var layer = 0; layer < 4; layer++) {
      let t = intersectLayer(p, dir, layer);
      if (t < 0.0) { ok = false; break; }
      p = p + t * dir;
      let fld = sampleFieldG(p.xy);
      let n = normalize(vec3f(-fld.gx[layer], -fld.gy[layer], 1.0));
      dir = refractV(dir, n, media[layer], media[layer + 1]);
    }
    if (!ok) {
      dir = normalize(vec3f(gx, gy, zb) - eye);
      p = eye;
    }
  } else {
    dir = normalize(vec3f(gx, gy, 0.0) - eye);
  }
  if (u.eye.w > 0.5) {
    return vec4f(roadScene(p, dir), 1.0);
  }
  // 斑马板:平面 z = dist
  var color = vec3f(0.2, 0.22, 0.25);
  if (abs(dir.z) > 1e-9) {
    let t = (u.board.x - p.z) / dir.z;
    if (t > 0.0) {
      let hit = p + t * dir;
      let phase = (hit.x * cos(u.board.y) + hit.y * sin(u.board.y)) / u.board.z;
      let v = stripeIntensity(phase);
      color = vec3f(v, v, v);
    }
  }
  if (inGlass) {
    color = color * vec3f(0.96, 0.98, 1.0);
  } else {
    color = color * 0.55;
  }
  return vec4f(color, 1.0);
}
`
