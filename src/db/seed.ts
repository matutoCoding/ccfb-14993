// 首次运行写入三个测试车型(轿车 / SUV / 带 HUD 区域)
import { getAll, put } from '@/db/database'
import { defaultSettings, GlassSpec, Station, Vehicle } from '@/db/models'
import { ControlCurve } from '@/physics/surface'

// 由截面矢高生成 5 点控制曲线
const curve = (v: number, w: number, sag: number): ControlCurve => ({
  v,
  pts: [-0.5, -0.25, 0, 0.25, 0.5].map((t) => ({
    u: t * w,
    z: sag * (1 - 4 * t * t),
  })),
})

const makeGlass = (
  id: string,
  name: string,
  width: number,
  height: number,
  sagW: number,
  sagTop: number,
  sagBot: number,
): GlassSpec => ({
  id,
  name,
  width,
  height,
  curves: [curve(-height / 2, width, sagBot), curve(0, width, sagW), curve(height / 2, width, sagTop)],
  thickness: { inner: 0.0021, pvb: 0.00076, outer: 0.0021 },
  defects: [],
})

const rect = (u0: number, v0: number, u1: number, v1: number) => [
  { u: u0, v: v0 },
  { u: u1, v: v0 },
  { u: u1, v: v1 },
  { u: u0, v: v1 },
]

export const seedIfEmpty = async (): Promise<void> => {
  const vehicles = await getAll<Vehicle>('vehicles')
  if (vehicles.length > 0) return

  const glasses: GlassSpec[] = [
    makeGlass('g-sedan', '轿车前挡 1460x860', 1.46, 0.86, 0.115, 0.1, 0.12),
    makeGlass('g-suv', 'SUV前挡 1520x920', 1.52, 0.92, 0.13, 0.115, 0.135),
    makeGlass('g-hud', 'HUD轿车前挡 1480x880', 1.48, 0.88, 0.118, 0.102, 0.124),
  ]
  for (const g of glasses) await put('glasses', g)

  const list: Vehicle[] = [
    {
      id: 'v-sedan',
      name: 'C200 轿车',
      kind: '轿车',
      installAngleDeg: 28,
      eyePoint: { x: -0.35, y: 0.28, z: -0.68 },
      zones: {
        a: rect(-0.4, 0.05, 0.15, 0.32),
        b: rect(-0.6, -0.25, 0.6, 0.38),
      },
      glassId: 'g-sedan',
    },
    {
      id: 'v-suv',
      name: 'X5 SUV',
      kind: 'SUV',
      installAngleDeg: 33,
      eyePoint: { x: -0.38, y: 0.33, z: -0.72 },
      zones: {
        a: rect(-0.42, 0.08, 0.16, 0.36),
        b: rect(-0.64, -0.28, 0.64, 0.42),
      },
      glassId: 'g-suv',
    },
    {
      id: 'v-hud',
      name: 'H9 旗舰轿车(HUD)',
      kind: '轿车',
      installAngleDeg: 26,
      eyePoint: { x: -0.35, y: 0.27, z: -0.68 },
      zones: {
        a: rect(-0.4, 0.05, 0.15, 0.32),
        b: rect(-0.6, -0.25, 0.6, 0.38),
        hud: rect(-0.42, -0.02, -0.12, 0.14),
      },
      glassId: 'g-hud',
    },
  ]
  for (const v of list) await put('vehicles', v)

  const stations: Station[] = list.map((v) => ({
    id: `st-${v.id}`,
    name: `${v.name} 检测工位`,
    vehicleId: v.id,
    stripeAngleDeg: 0,
    stripePeriod: 0.02,
    boardDist: 1.2,
    eyeOffset: { x: 0, y: 0, z: 0 },
  }))
  for (const s of stations) await put('stations', s)

  await put('settings', defaultSettings())
}
