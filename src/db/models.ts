// 数据模型与默认设置
import { ControlCurve } from '@/physics/surface'
import { Defect } from '@/physics/defects'

export interface Pt {
  u: number
  v: number
}

export interface Zones {
  a: Pt[]
  b: Pt[]
  hud?: Pt[]
}

export interface Vehicle {
  id: string
  name: string
  kind: string
  installAngleDeg: number
  eyePoint: { x: number; y: number; z: number }
  zones: Zones
  glassId: string
}

export interface GlassSpec {
  id: string
  name: string
  width: number
  height: number
  curves: ControlCurve[]
  poly?: { deg: number; coef: number[] }
  thickness: { inner: number; pvb: number; outer: number }
  defects: Defect[]
}

export interface Station {
  id: string
  name: string
  vehicleId: string
  stripeAngleDeg: number
  stripePeriod: number
  boardDist: number
  eyeOffset: { x: number; y: number; z: number }
}

export interface BatchRecord {
  id: string
  ts: number
  vehicleId: string
  vehicleName: string
  defects: Defect[]
  maxA: number
  maxB: number
  limitA: number
  limitB: number
  verdict: 'pass' | 'fail'
}

export interface AppSettings {
  key: 'app'
  nGlass: number
  nPvb: number
  limitA: number
  limitB: number
  mapNx: number
  mapNy: number
  fieldN: number
}

export const defaultSettings = (): AppSettings => ({
  key: 'app',
  nGlass: 1.52,
  nPvb: 1.49,
  // 屈光度限值(dpt),参考企业内控标准,可在设置页调整
  limitA: 0.1,
  limitB: 0.15,
  mapNx: 120,
  mapNy: 80,
  fieldN: 400,
})

export const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// 点是否在多边形内(射线法,玻璃 uv 坐标)
export const inPolygon = (u: number, v: number, poly: Pt[]): boolean => {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.v > v !== b.v > v && u < ((b.u - a.u) * (v - a.v)) / (b.v - a.v) + a.u) inside = !inside
  }
  return inside
}
