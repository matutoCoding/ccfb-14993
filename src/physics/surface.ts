// 玻璃曲面:控制曲线放样 / 点云多项式拟合
import { HeightField, makeField } from '@/physics/height_field'

export interface ControlPoint {
  u: number
  z: number
}

export interface ControlCurve {
  v: number
  pts: ControlPoint[]
}

export interface SurfaceSpec {
  width: number
  height: number
  curves: ControlCurve[]
  // 点云拟合得到的多项式系数,存在时优先于控制曲线
  // z = sum c[k] * u^i * v^j,按 (i+j<=deg) 排列
  poly?: { deg: number; coef: number[] }
}

// Catmull-Rom 一维插值,pts 按 u 升序
export const interpCurve = (pts: ControlPoint[], u: number): number => {
  const n = pts.length
  if (u <= pts[0].u) return pts[0].z
  if (u >= pts[n - 1].u) return pts[n - 1].z
  let k = 0
  while (k < n - 2 && u > pts[k + 1].u) k++
  const p0 = pts[Math.max(0, k - 1)]
  const p1 = pts[k]
  const p2 = pts[k + 1]
  const p3 = pts[Math.min(n - 1, k + 2)]
  const t = (u - p1.u) / (p2.u - p1.u)
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  )
}

const evalPoly = (deg: number, coef: number[], u: number, v: number): number => {
  let z = 0
  let k = 0
  for (let s = 0; s <= deg; s++) {
    for (let i = 0; i <= s; i++) {
      z += coef[k++] * Math.pow(u, i) * Math.pow(v, s - i)
    }
  }
  return z
}

// 曲面求值:多条截面曲线沿 v 分段线性放样
export const evalSurface = (spec: SurfaceSpec, u: number, v: number): number => {
  if (spec.poly) return evalPoly(spec.poly.deg, spec.poly.coef, u, v)
  const curves = [...spec.curves].sort((a, b) => a.v - b.v)
  if (v <= curves[0].v) return interpCurve(curves[0].pts, u)
  if (v >= curves[curves.length - 1].v) return interpCurve(curves[curves.length - 1].pts, u)
  for (let k = 0; k < curves.length - 1; k++) {
    if (v <= curves[k + 1].v) {
      const t = (v - curves[k].v) / (curves[k + 1].v - curves[k].v)
      const za = interpCurve(curves[k].pts, u)
      const zb = interpCurve(curves[k + 1].pts, u)
      return za * (1 - t) + zb * t
    }
  }
  return interpCurve(curves[0].pts, u)
}

// 点云最小二乘拟合多项式曲面
export const fitPoly = (
  cloud: { x: number; y: number; z: number }[],
  deg: number,
): { deg: number; coef: number[] } => {
  const terms: [number, number][] = []
  for (let s = 0; s <= deg; s++) for (let i = 0; i <= s; i++) terms.push([i, s - i])
  const m = terms.length
  const a: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0))
  for (const p of cloud) {
    const row = terms.map(([i, j]) => Math.pow(p.x, i) * Math.pow(p.y, j))
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) a[r][c] += row[r] * row[c]
      a[r][m] += row[r] * p.z
    }
  }
  // 高斯消元
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    ;[a[c], a[piv]] = [a[piv], a[c]]
    for (let r = 0; r < m; r++) {
      if (r === c) continue
      const f = a[r][c] / a[c][c]
      for (let k = c; k <= m; k++) a[r][k] -= f * a[c][k]
    }
  }
  return { deg, coef: terms.map((_, i) => a[i][m] / a[i][i]) }
}

// 烘焙为高度场,u/v 以玻璃中心为原点
export const bakeField = (spec: SurfaceSpec, nx: number, ny: number): HeightField =>
  makeField(
    nx,
    ny,
    -spec.width / 2,
    -spec.height / 2,
    spec.width / 2,
    spec.height / 2,
    (x, y) => evalSurface(spec, x, y),
  )
