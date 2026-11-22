// 折射与近轴光学(ABCD 矩阵),作为光线追迹的解析对照
import { Vec3, dot, scale, add, normalize, cross } from '@/lib/vec'

// 斯涅尔折射,i 为入射方向(单位向量,指向界面),n 为界面法线
// 返回折射方向,全反射返回 null
export const refract = (i: Vec3, n: Vec3, n1: number, n2: number): Vec3 | null => {
  let nn = n
  let cosI = -dot(i, nn)
  if (cosI < 0) {
    nn = scale(n, -1)
    cosI = -dot(i, nn)
  }
  const eta = n1 / n2
  const sin2T = eta * eta * (1 - cosI * cosI)
  if (sin2T > 1) return null
  const cosT = Math.sqrt(1 - sin2T)
  return normalize(add(scale(i, eta), scale(nn, eta * cosI - cosT)))
}

// 有符号偏向角:绕 y 轴分量(用于 x 向扫描),正号约定与透镜光焦度一致(会聚为正)
export const signedDeviationY = (inc: Vec3, exit: Vec3): number => {
  // 小角度下 cross(inc, exit) 的 y 分量即绕 y 轴的偏转角
  const c = cross(inc, exit)
  return -c[1]
}

export const angleBetween = (a: Vec3, b: Vec3): number => {
  const c = cross(a, b)
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b))
}

// 2x2 矩阵,近轴光线传递 [y, n*u]
export type Mat2 = [[number, number], [number, number]]

export const mul2 = (a: Mat2, b: Mat2): Mat2 => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
]

// 球面折射矩阵,R 符号约定:曲率中心在光线前进方向下游为正
export const refractMatrix = (n1: number, n2: number, R: number): Mat2 => [
  [1, 0],
  [-(n2 - n1) / R, 1],
]

// 介质内传播矩阵,t 为几何厚度,n 为折射率
export const translateMatrix = (t: number, n: number): Mat2 => [
  [1, t / n],
  [0, 1],
]

// 夹层玻璃总光焦度(解析解,用于校验光线追迹)
// 光线顺序: 眼侧 -> 内层玻璃 -> PVB -> 外层玻璃 -> 空气
// rOuter 为最外表面(玻璃|空气)的有符号曲率半径,各界面同心
export const laminatedPower = (
  rOuter: number,
  tOut: number,
  nGlass: number,
  tPvb: number,
  nPvb: number,
  tIn: number,
): number => {
// 同心界面:越靠眼侧曲率半径绝对值越大(R 为负时继续减小)
  const r3 = rOuter - tOut
  const r2 = r3 - tPvb
  const r1 = r2 - tIn
  let m = refractMatrix(1, nGlass, r1)
  m = mul2(refractMatrix(nGlass, nPvb, r2), mul2(translateMatrix(tIn, nGlass), m))
  m = mul2(refractMatrix(nPvb, nGlass, r3), mul2(translateMatrix(tPvb, nPvb), m))
  m = mul2(refractMatrix(nGlass, 1, rOuter), mul2(translateMatrix(tOut, nGlass), m))
  return -m[1][0]
}
