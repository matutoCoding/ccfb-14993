// 核心精度校验:
// 1. 光线追迹屈光度 vs ABCD 解析公式,误差 < 0.01 dpt
// 2. 条纹反推屈光度 vs 直接计算,结果一致
import { describe, it, expect } from 'vitest'
import { refractMatrix, laminatedPower } from '@/physics/optics'
import { makeField } from '@/physics/height_field'
import { buildStack, diopterAt, Laminate } from '@/physics/ray_trace'
import { renderStripeImage, invertDiopter, Board } from '@/physics/stripe'
import { Defect } from '@/physics/defects'

const LAM: Laminate = { tInner: 0.0021, tPvb: 0.00076, tOuter: 0.0021, nGlass: 1.52, nPvb: 1.49 }

// 球面高度场:曲率中心在 -z 侧(凹向眼点),顶点在原点
const sphereField = (a: number, half: number, n: number) =>
  makeField(n, n, -half, -half, half, half, (x, y) => {
    const r2 = x * x + y * y
    return r2 >= a * a ? 0 : Math.sqrt(a * a - r2) - a
  })

describe('解析公式 sanity', () => {
  it('单折射面光焦度 = (n2-n1)/R', () => {
    const m = refractMatrix(1, 1.52, 0.5)
    expect(-m[1][0]).toBeCloseTo(1.04, 10)
  })

  it('平板夹层光焦度为 0', () => {
    expect(laminatedPower(-1e9, LAM.tOuter, 1.52, LAM.tPvb, 1.49, LAM.tInner)).toBeCloseTo(0, 8)
  })
})

describe('屈光度: 光线追迹 vs 解析公式', () => {
  it('已知曲率球面夹层玻璃,误差 < 0.01 dpt', () => {
    const a = 0.25 // 曲率半径 250mm,强曲面以拉开信号
    const field = sphereField(a, 0.08, 641)
    const stack = buildStack(field, LAM, [], 0.16, 0.16)
    const src = { kind: 'parallel' as const, dir: [0, 0, 1] as [number, number, number] }
    const d = diopterAt(stack, src, 0.01, 0.005)
    expect(d).not.toBeNull()
    const analytic = laminatedPower(-a, LAM.tOuter, LAM.nGlass, LAM.tPvb, LAM.nPvb, LAM.tInner)
    // 解析值约 -0.04 dpt,远大于容差,是有效对照
    expect(Math.abs(analytic)).toBeGreaterThan(0.02)
    expect(Math.abs(d!.du - analytic)).toBeLessThan(0.01)
    expect(Math.abs(d!.dv - analytic)).toBeLessThan(0.01)
  })

  it('平板玻璃屈光度为 0', () => {
    const field = makeField(65, 65, -0.1, -0.1, 0.1, 0.1, () => 0)
    const stack = buildStack(field, LAM, [], 0.2, 0.2)
    const src = { kind: 'eye' as const, eye: [0, 0, -0.6] as [number, number, number] }
    const d = diopterAt(stack, src, 0.02, 0.01)
    expect(d).not.toBeNull()
    expect(d!.mag).toBeLessThan(1e-6)
  })
})

describe('条纹反推 vs 直接计算', () => {
  it('反推屈光度与直接计算一致', () => {
    // 1.5m 球面基底 + 中央局部厚度缺陷
    const field = sphereField(1.5, 0.25, 801)
    const defects: Defect[] = [
      { id: 'd1', kind: 'thickness', u0: 0, v0: 0, sigma: 0.03, amp: 0.0003 },
    ]
    const w = 0.5
    const h = 0.4
    const stack = buildStack(field, LAM, defects, w, h)
    const eye: [number, number, number] = [0, 0, -0.6]
    const board: Board = { dist: 1.2, angleDeg: 0, period: 0.02 }
    const nx = 800
    const ny = 96
    // 解析抗锯齿渲染,等效相机像元积分
    const img = renderStripeImage(stack, eye, board, w, h, nx, ny)
    const inv = invertDiopter(img, nx, ny, stack, eye, board, w, h)
    expect(inv.x.length).toBeGreaterThan(10)
    const src = { kind: 'eye', eye } as const
    // 同一玻璃坐标上直接计算,比较 RMS
    let sum = 0
    let cnt = 0
    let maxDiff = 0
    for (let k = 0; k < inv.x.length; k++) {
      const direct = diopterAt(stack, src, inv.x[k], 0)
      if (!direct) continue
      const diff = Math.abs(inv.diopter[k] - direct.du)
      sum += diff * diff
      cnt++
      maxDiff = Math.max(maxDiff, diff)
    }
    const rms = Math.sqrt(sum / cnt)
    // 缺陷峰值屈光度约 0.1 dpt,反推 RMS 应远小于信号
    expect(rms).toBeLessThan(0.01)
    expect(maxDiff).toBeLessThan(0.03)
    console.log(`stripe inversion: rms=${rms.toFixed(5)} dpt, max=${maxDiff.toFixed(5)} dpt, n=${cnt}`)
  }, 60000)
})
