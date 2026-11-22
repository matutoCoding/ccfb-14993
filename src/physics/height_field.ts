// 高度场:z = f(x, y),双线性采样 + 牛顿法求交
import { Vec3, at, normalize } from '@/lib/vec'

export interface HeightField {
  nx: number
  ny: number
  x0: number
  y0: number
  dx: number
  dy: number
  z: Float32Array
}

export const makeField = (
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fn: (x: number, y: number) => number,
): HeightField => {
  const z = new Float32Array(nx * ny)
  const dx = (x1 - x0) / (nx - 1)
  const dy = (y1 - y0) / (ny - 1)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      z[j * nx + i] = fn(x0 + i * dx, y0 + j * dy)
    }
  }
  return { nx, ny, x0, y0, dx, dy, z }
}

export const inside = (f: HeightField, x: number, y: number): boolean =>
  x >= f.x0 && x <= f.x0 + f.dx * (f.nx - 1) && y >= f.y0 && y <= f.y0 + f.dy * (f.ny - 1)

// Catmull-Rom 三次核及其导数
const cr = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  0.5 *
  (2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)

const crd = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  0.5 * (-p0 + p2 + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t)

// 双三次采样(C1 连续,梯度可用于光学计算),返回 z 与梯度
export const sample = (f: HeightField, x: number, y: number): { z: number; gx: number; gy: number } => {
  const fx = Math.min(Math.max((x - f.x0) / f.dx, 0), f.nx - 1 - 1e-9)
  const fy = Math.min(Math.max((y - f.y0) / f.dy, 0), f.ny - 1 - 1e-9)
  const i = Math.min(Math.floor(fx), f.nx - 2)
  const j = Math.min(Math.floor(fy), f.ny - 2)
  const u = fx - i
  const v = fy - j
  const at_ = (ii: number, jj: number): number =>
    f.z[Math.min(Math.max(jj, 0), f.ny - 1) * f.nx + Math.min(Math.max(ii, 0), f.nx - 1)]
  const q: number[] = []
  const qd: number[] = []
  for (let m = -1; m <= 2; m++) {
    const p0 = at_(i - 1, j + m)
    const p1 = at_(i, j + m)
    const p2 = at_(i + 1, j + m)
    const p3 = at_(i + 2, j + m)
    q.push(cr(p0, p1, p2, p3, u))
    qd.push(crd(p0, p1, p2, p3, u))
  }
  const z = cr(q[0], q[1], q[2], q[3], v)
  const gx = cr(qd[0], qd[1], qd[2], qd[3], v) / f.dx
  const gy = crd(q[0], q[1], q[2], q[3], v) / f.dy
  return { z, gx, gy }
}

export const sampleNormal = (f: HeightField, x: number, y: number): Vec3 => {
  const { gx, gy } = sample(f, x, y)
  return normalize([-gx, -gy, 1])
}

// 光线与高度场求交:平面估计起步(必要时用 xy 包围盒入口修正),牛顿迭代
export const intersect = (f: HeightField, o: Vec3, d: Vec3): number | null => {
  const x1 = f.x0 + f.dx * (f.nx - 1)
  const y1 = f.y0 + f.dy * (f.ny - 1)
  // xy 方向 slab 测试,求光线进入/离开场域的参数区间
  let tEnter = -Infinity
  let tExit = Infinity
  if (Math.abs(d[0]) > 1e-12) {
    let ta = (f.x0 - o[0]) / d[0]
    let tb = (x1 - o[0]) / d[0]
    if (ta > tb) [ta, tb] = [tb, ta]
    tEnter = Math.max(tEnter, ta)
    tExit = Math.min(tExit, tb)
  } else if (o[0] < f.x0 || o[0] > x1) return null
  if (Math.abs(d[1]) > 1e-12) {
    let ta = (f.y0 - o[1]) / d[1]
    let tb = (y1 - o[1]) / d[1]
    if (ta > tb) [ta, tb] = [tb, ta]
    tEnter = Math.max(tEnter, ta)
    tExit = Math.min(tExit, tb)
  } else if (o[1] < f.y0 || o[1] > y1) return null
  if (tEnter >= tExit || tExit < 0) return null
  const zMid = f.z[Math.floor(f.ny / 2) * f.nx + Math.floor(f.nx / 2)]
  let t = d[2] !== 0 ? (zMid - o[2]) / d[2] : 0
  t = Math.max(t, tEnter, 0)
  if (t >= tExit) t = (tEnter + tExit) / 2
  for (let k = 0; k < 16; k++) {
    const p = at(o, d, t)
    if (!inside(f, p[0], p[1])) {
      // 迭代中跑出边界:向包围盒内回退
      t = (t + Math.max(tEnter, 0)) / 2
      continue
    }
    const s = sample(f, p[0], p[1])
    const g = p[2] - s.z
    if (Math.abs(g) < 1e-12) return t
    const dgdt = d[2] - (s.gx * d[0] + s.gy * d[1])
    if (Math.abs(dgdt) < 1e-12) return null
    t -= g / dgdt
    if (t < 0) return null
  }
  const p = at(o, d, t)
  return inside(f, p[0], p[1]) && Math.abs(p[2] - sample(f, p[0], p[1]).z) < 1e-6 ? t : null
}

// 沿法线偏移生成新高度场(一阶精确:z' = z - d / |n_z 归一因子|)
export const offsetField = (f: HeightField, dist: (x: number, y: number) => number): HeightField => {
  const out = new Float32Array(f.nx * f.ny)
  for (let j = 0; j < f.ny; j++) {
    for (let i = 0; i < f.nx; i++) {
      const x = f.x0 + i * f.dx
      const y = f.y0 + j * f.dy
      const { z, gx, gy } = sample(f, x, y)
      const L = Math.sqrt(1 + gx * gx + gy * gy)
      out[j * f.nx + i] = z - dist(x, y) / L
    }
  }
  return { ...f, z: out }
}
