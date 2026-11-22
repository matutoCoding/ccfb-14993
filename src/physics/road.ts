// 主驾视角路面场景(玻璃局部坐标系):地面、车道线、天空
import { Vec3 } from '@/lib/vec'

// 返回 RGB(0-1),roadY 为路面在玻璃坐标系中的高度
export const roadColor = (eye: Vec3, dir: Vec3, roadY: number): [number, number, number] => {
  if (dir[1] < -1e-4) {
    const t = (roadY - eye[1]) / dir[1]
    const x = eye[0] + dir[0] * t
    const z = eye[2] + dir[2] * t
    // 车道线:x = ±1.75(本车道),±5.25(邻车道),虚线 4m 线 6m 空
    const laneX = [1.75, -1.75, 5.25, -5.25]
    let lane = 0
    for (const lx of laneX) {
      if (Math.abs(x - lx) < 0.08 && z % 10 < 4) lane = 1
    }
    // 距离雾化成地平线
    const fog = Math.min(1, Math.max(0, (t - 30) / 120))
    const base: [number, number, number] = lane > 0 ? [0.92, 0.92, 0.9] : [0.32, 0.33, 0.35]
    const sky: [number, number, number] = [0.62, 0.72, 0.82]
    return [
      base[0] * (1 - fog) + sky[0] * fog,
      base[1] * (1 - fog) + sky[1] * fog,
      base[2] * (1 - fog) + sky[2] * fog,
    ]
  }
  // 天空渐变
  const g = Math.min(1, Math.max(0, dir[1] * 3))
  return [0.62 + 0.25 * g, 0.72 + 0.2 * g, 0.82 + 0.15 * g]
}
