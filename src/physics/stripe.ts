// 斑马板:正向投影(透过玻璃看条纹)与条纹反推屈光度
import { Vec3, sub, normalize, cross } from '@/lib/vec'
import { Stack, traceStack } from '@/physics/ray_trace'
import { sample } from '@/physics/height_field'

export interface Board {
  // 板平面:玻璃局部坐标系内 z = dist
  dist: number
  angleDeg: number
  period: number
}

// 板面条纹相位,中央为参考条纹(索引 0)
export const stripePhase = (X: number, Y: number, board: Board): number => {
  const a = (board.angleDeg * Math.PI) / 180
  return (X * Math.cos(a) + Y * Math.sin(a)) / board.period
}

// 条纹亮度:方波,参考条纹(中心一条)用灰色标识便于目视定位
export const stripeIntensity = (phase: number): number => {
  const idx = Math.round(phase)
  if (idx === 0 && Math.abs(phase) < 0.5) return 0.5
  const f = phase - Math.floor(phase)
  return f < 0.5 ? 1 : 0.08
}

// 光线穿出玻璃后与板平面求交
const hitBoard = (p: Vec3, d: Vec3, board: Board): Vec3 | null => {
  if (Math.abs(d[2]) < 1e-9) return null
  const t = (board.dist - p[2]) / d[2]
  if (t < 0) return null
  return [p[0] + d[0] * t, p[1] + d[1] * t, board.dist]
}

// 无玻璃参考:眼点直线到板
export const refBoardHit = (eye: Vec3, target: Vec3, board: Board): Vec3 | null =>
  hitBoard(eye, normalize(sub(target, eye)), board)

// 条纹亮度在半整数相位网格上分段恒定,可解析积分
const avgIntensity = (a: number, b: number): number => {
  if (b <= a) return stripeIntensity(a)
  let sum = 0
  let cur = a
  let bp = Math.ceil(a * 2 - 1e-9) / 2
  if (bp <= a) bp += 0.5
  while (bp < b) {
    sum += stripeIntensity((cur + bp) / 2) * (bp - cur)
    cur = bp
    bp += 0.5
  }
  sum += stripeIntensity((cur + b) / 2) * (b - cur)
  return sum / (b - a)
}

// 由相位场生成抗锯齿图像:像素值 = 像素覆盖相位区间内条纹亮度的解析积分
const imageFromPhases = (ph: Float64Array, nx: number, ny: number): Float32Array => {
  const img = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = ph[j * nx + i]
      if (Number.isNaN(p)) {
        img[j * nx + i] = 0.2
        continue
      }
      const pl = i > 0 ? ph[j * nx + i - 1] : p
      const pr = i < nx - 1 ? ph[j * nx + i + 1] : p
      const a = Number.isNaN(pl) ? p : (p + pl) / 2
      const b = Number.isNaN(pr) ? p : (p + pr) / 2
      img[j * nx + i] = avgIntensity(Math.min(a, b), Math.max(a, b))
    }
  }
  return img
}

// 正向渲染:每个像素对应玻璃上一点,透过夹层追到斑马板
// 像素值用解析抗锯齿(像元积分),等效无限超采样,供反推达到亚像素精度
export const renderStripeImage = (
  stack: Stack,
  eye: Vec3,
  board: Board,
  w: number,
  h: number,
  nx: number,
  ny: number,
): Float32Array => {
  const ph = new Float64Array(nx * ny).fill(NaN)
  for (let j = 0; j < ny; j++) {
    const y = -h / 2 + (h * j) / (ny - 1)
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + (w * i) / (nx - 1)
      const z = sample(stack.base, x, y).z
      const target: Vec3 = [x, y, z]
      const inc = normalize(sub(target, eye))
      const tr = traceStack(stack, eye, inc)
      const hit = tr ? hitBoard(tr.point, tr.dir, board) : refBoardHit(eye, target, board)
      if (hit) ph[j * nx + i] = stripePhase(hit[0], hit[1], board)
    }
  }
  return imageFromPhases(ph, nx, ny)
}

// 无玻璃参考图像(同样的解析抗锯齿)
export const renderRefImage = (
  stack: Stack,
  eye: Vec3,
  board: Board,
  w: number,
  h: number,
  nx: number,
  ny: number,
): Float32Array => {
  const ph = new Float64Array(nx * ny).fill(NaN)
  for (let j = 0; j < ny; j++) {
    const y = -h / 2 + (h * j) / (ny - 1)
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + (w * i) / (nx - 1)
      const z = sample(stack.base, x, y).z
      const ref = refBoardHit(eye, [x, y, z], board)
      if (ref) ph[j * nx + i] = stripePhase(ref[0], ref[1], board)
    }
  }
  return imageFromPhases(ph, nx, ny)
}

// 跳变沿检测阈值:亮暗两级的中点
const THRESH = (1 + 0.08) / 2

// 灰度序列的亮暗跳变沿:盒式像元模型下,混合像素的灰度值直接给出沿的精确位置
// 亮暗两级取跳变沿外侧的饱和像素;上升沿与下降沿在混合像素内的位置公式不同
const crossingsOf = (vals: number[]): number[] => {
  const out: number[] = []
  const n = vals.length
  for (let i = 1; i < n; i++) {
    const a = vals[i - 1] >= THRESH ? 1 : 0
    const b = vals[i] >= THRESH ? 1 : 0
    if (a === b) continue
    const rising = vals[i] > vals[i - 1]
    const before = i >= 2 ? vals[i - 2] : vals[i - 1]
    const after = i < n - 1 ? vals[i + 1] : vals[i]
    const lo = Math.min(before, after)
    const hi = Math.max(before, after)
    if (hi - lo < 1e-9) {
      out.push(i - 0.5)
      continue
    }
    const eps = (hi - lo) * 1e-6
    let pos = i - 0.5
    for (const m of [i - 1, i]) {
      if (vals[m] > lo + eps && vals[m] < hi - eps) {
        const f = (vals[m] - lo) / (hi - lo)
        pos = rising ? m + 0.5 - f : m - 0.5 + f
        break
      }
    }
    out.push(pos)
  }
  return out
}

export interface InvertResult {
  x: number[]
  diopter: number[]
}

// 条纹反推:取图像中间一行,检测条纹跳变沿,
// 与无玻璃参考模型的跳变沿按序配对得到条纹相位,
// 由板面位移反算偏向角,再对玻璃坐标求梯度得屈光度
export const invertDiopter = (
  img: Float32Array,
  nx: number,
  ny: number,
  stack: Stack,
  eye: Vec3,
  board: Board,
  w: number,
  h: number,
): InvertResult => {
  const j = Math.floor(ny / 2)
  const y = -h / 2 + (h * j) / (ny - 1)
  const row: number[] = []
  for (let i = 0; i < nx; i++) row.push(img[j * nx + i])
  // 参考模型用同一套解析抗锯齿生成,保证跳变沿检测口径一致
  const refImg = renderRefImage(stack, eye, board, w, h, nx, ny)
  const refRow: number[] = []
  for (let i = 0; i < nx; i++) refRow.push(refImg[j * nx + i])
  const obs = crossingsOf(row)
  const ref = crossingsOf(refRow)
  if (obs.length < 5 || ref.length < 5) return { x: [], diopter: [] }
  // 对齐:允许首尾错位 ±2,取总距离最小的配对
  let bestOff = 0
  let bestCost = Infinity
  for (let off = -2; off <= 2; off++) {
    let cost = 0
    let cnt = 0
    for (let k = 0; k < obs.length; k++) {
      const r = k + off
      if (r < 0 || r >= ref.length) continue
      cost += Math.abs(obs[k] - ref[r])
      cnt++
    }
    if (cnt > 0 && cost / cnt < bestCost) {
      bestCost = cost / cnt
      bestOff = off
    }
  }
  // 参考跳变沿 k 对应的板面条纹相位由参考模型给出(半周期整数)
  // 偏向角必须在同一玻璃点上比较:实际命中 vs 该点无玻璃参考命中
  const xs: number[] = []
  const deltas: number[] = []
  const a = (board.angleDeg * Math.PI) / 180
  for (let k = 0; k < obs.length; k++) {
    const r = k + bestOff
    if (r < 0 || r >= ref.length) continue
    const xi = -w / 2 + (w * obs[k]) / (nx - 1)
    // 参考跳变沿的板面命中点 -> 该条纹边的相位身份
    const ri = -w / 2 + (w * ref[r]) / (nx - 1)
    const zr = sample(stack.base, ri, y).z
    const refEdge = refBoardHit(eye, [ri, y, zr], board)
    if (!refEdge) continue
    // 同一玻璃点 xi 的无玻璃参考命中
    const zi = sample(stack.base, xi, y).z
    const refHit = refBoardHit(eye, [xi, y, zi], board)
    if (!refHit) continue
    // 条纹边相位为半周期整数(整数=暗转亮,半整数=亮转暗)
    const edgePhase = Math.round(stripePhase(refEdge[0], refEdge[1], board) * 2) / 2
    const Xp = (edgePhase * board.period - refHit[1] * Math.sin(a)) / Math.cos(a)
    // 偏向角 = 出射光线(玻璃出射点->实际命中)与入射光线(眼点->参考命中)的夹角
    // 出射点用玻璃表面点近似(厚度毫米级,误差可忽略)
    const act = normalize(sub([Xp, refHit[1], board.dist], [xi, y, zi]))
    const rdir = normalize(sub(refHit, eye))
    const c = cross(rdir, act)
    xs.push(xi)
    deltas.push(c[1])
  }
  // 对玻璃坐标求梯度得屈光度:窗口内二次拟合(屈光度线性变化时无偏)
  const out: InvertResult = { x: [], diopter: [] }
  const W = 2
  for (let k = W; k < xs.length - W; k++) {
    // 以 xs[k] 为原点最小二乘: delta = c0 + c1*u + c2*u^2, 屈光度 = -c1
    let s1 = 0
    let s2 = 0
    let s3 = 0
    let s4 = 0
    let t0 = 0
    let t1 = 0
    let t2 = 0
    const x0 = xs[k]
    const n = 2 * W + 1
    for (let m = k - W; m <= k + W; m++) {
      const u = xs[m] - x0
      const u2 = u * u
      s1 += u
      s2 += u2
      s3 += u2 * u
      s4 += u2 * u2
      t0 += deltas[m]
      t1 += u * deltas[m]
      t2 += u2 * deltas[m]
    }
    // 解 3x3 正规方程求 c1
    const b1 = s1
    const b2 = s2
    const det =
      n * (s2 * s4 - s3 * s3) - b1 * (b1 * s4 - s3 * s2) + b2 * (b1 * s3 - s2 * s2)
    if (Math.abs(det) < 1e-24) continue
    // 克拉默法则求 c1(正规方程第二列换成右端)
    const det2 =
      n * (t1 * s4 - s3 * t2) - t0 * (b1 * s4 - s3 * s2) + b2 * (b1 * t2 - t1 * s2)
    const c1 = det2 / det
    out.x.push(x0)
    out.diopter.push(-c1)
  }
  return out
}
