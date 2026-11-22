// 制造缺陷模型:局部厚度不均 / 成型波纹 / 边部应力凸起
export type Defect =
  | { id: string; kind: 'thickness'; u0: number; v0: number; sigma: number; amp: number }
  | { id: string; kind: 'waviness'; dirDeg: number; wavelength: number; amp: number; phase: number }
  | { id: string; kind: 'edgeBump'; width: number; amp: number }

// 面形(z 向)增量:波纹直接改变外表面面形
export const surfaceDelta = (defects: Defect[], u: number, v: number): number => {
  let dz = 0
  for (const d of defects) {
    if (d.kind === 'waviness') {
      const a = (d.dirDeg * Math.PI) / 180
      dz += d.amp * Math.sin((2 * Math.PI * (u * Math.cos(a) + v * Math.sin(a))) / d.wavelength + d.phase)
    }
  }
  return dz
}

// 厚度增量:局部厚度不均(高斯包络)+ 边部应力凸起
export const thicknessDelta = (
  defects: Defect[],
  u: number,
  v: number,
  w: number,
  h: number,
): number => {
  let dt = 0
  for (const d of defects) {
    if (d.kind === 'thickness') {
      const r2 = (u - d.u0) ** 2 + (v - d.v0) ** 2
      dt += d.amp * Math.exp(-r2 / (2 * d.sigma * d.sigma))
    } else if (d.kind === 'edgeBump') {
      const edge = Math.min(u + w / 2, w / 2 - u, v + h / 2, h / 2 - v)
      dt += d.amp * Math.exp(-(edge * edge) / (2 * d.width * d.width))
    }
  }
  return dt
}

export const defectLabel = (d: Defect): string => {
  if (d.kind === 'thickness') return '局部厚度不均'
  if (d.kind === 'waviness') return '成型波纹'
  return '边部应力凸起'
}
