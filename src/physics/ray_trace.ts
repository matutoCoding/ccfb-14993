// 双层玻璃 + PVB 夹层光线追迹与逐点屈光度计算
import { Vec3, sub, normalize, at, cross } from '@/lib/vec'
import { refract } from '@/physics/optics'
import { HeightField, intersect, sampleNormal, offsetField, sample } from '@/physics/height_field'
import { Defect, thicknessDelta } from '@/physics/defects'

export interface Laminate {
  tInner: number
  tPvb: number
  tOuter: number
  nGlass: number
  nPvb: number
}

// 四个折射界面,按光线前进顺序: 内表面 -> 玻璃|PVB -> PVB|玻璃 -> 外表面
export interface Stack {
  base: HeightField
  fields: HeightField[]
  lam: Laminate
}

export const buildStack = (
  base: HeightField,
  lam: Laminate,
  defects: Defect[],
  w: number,
  h: number,
): Stack => {
  const dt = (x: number, y: number) => thicknessDelta(defects, x, y, w, h)
  // 厚度缺陷加在内层玻璃上(向眼侧增厚),只影响最内侧界面
  const f4 = base
  const f3 = offsetField(base, () => lam.tOuter)
  const f2 = offsetField(base, () => lam.tOuter + lam.tPvb)
  const f1 = offsetField(base, (x, y) => lam.tOuter + lam.tPvb + lam.tInner + dt(x, y))
  return { base, fields: [f1, f2, f3, f4], lam }
}

export interface TraceResult {
  point: Vec3
  dir: Vec3
}

// 穿过整个夹层,返回出射点与方向,未命中返回 null
export const traceStack = (stack: Stack, o: Vec3, d: Vec3): TraceResult | null => {
  const media = [1, stack.lam.nGlass, stack.lam.nPvb, stack.lam.nGlass, 1]
  let p = o
  let dir = d
  for (let k = 0; k < 4; k++) {
    const t = intersect(stack.fields[k], p, dir)
    if (t === null) return null
    p = at(p, dir, t)
    const n = sampleNormal(stack.fields[k], p[0], p[1])
    const r = refract(dir, n, media[k], media[k + 1])
    if (r === null) return null
    dir = r
  }
  return { point: p, dir }
}

// 光源描述:有限远眼点 或 平行光(校验用)
export type Source = { kind: 'eye'; eye: Vec3 } | { kind: 'parallel'; dir: Vec3 }

const incidentAt = (src: Source, target: Vec3): { o: Vec3; d: Vec3 } => {
  if (src.kind === 'eye') return { o: src.eye, d: normalize(sub(target, src.eye)) }
  return { o: sub(target, [src.dir[0] * 5, src.dir[1] * 5, src.dir[2] * 5]), d: src.dir }
}

// 偏向角矢量:cross(inc, exit) 的 x/y 分量,小角度下即偏转角的两个分量
export interface Deviation {
  wx: number
  wy: number
}

export const deviationAt = (stack: Stack, src: Source, x: number, y: number): Deviation | null => {
  const z = sample(stack.base, x, y).z
  const target: Vec3 = [x, y, z]
  const { o, d } = incidentAt(src, target)
  const tr = traceStack(stack, o, d)
  if (!tr) return null
  const c = cross(d, tr.dir)
  return { wx: c[0], wy: c[1] }
}

export interface Diopter {
  du: number
  dv: number
  mag: number
}

// 逐点屈光度:偏向角对玻璃坐标的梯度,符号约定与透镜光焦度一致(会聚为正)
export const diopterAt = (stack: Stack, src: Source, x: number, y: number, hStep = 0.002): Diopter | null => {
  const dxp = deviationAt(stack, src, x + hStep, y)
  const dxm = deviationAt(stack, src, x - hStep, y)
  const dyp = deviationAt(stack, src, x, y + hStep)
  const dym = deviationAt(stack, src, x, y - hStep)
  if (!dxp || !dxm || !dyp || !dym) return null
  const du = -(dxp.wy - dxm.wy) / (2 * hStep)
  const dv = (dyp.wx - dym.wx) / (2 * hStep)
  return { du, dv, mag: Math.hypot(du, dv) }
}

// 全玻璃屈光度图,供畸变分析页使用
export const diopterMap = (
  stack: Stack,
  src: Source,
  w: number,
  h: number,
  nx: number,
  ny: number,
  onRow?: (j: number) => void,
): Float32Array => {
  const out = new Float32Array(nx * ny).fill(NaN)
  for (let j = 0; j < ny; j++) {
    const y = -h / 2 + (h * j) / (ny - 1)
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + (w * i) / (nx - 1)
      const d = diopterAt(stack, src, x, y)
      if (d) out[j * nx + i] = d.mag
    }
    if (onRow) onRow(j)
  }
  return out
}
