// 由玻璃档案和设置构建光线追迹夹层
import { AppSettings, GlassSpec } from '@/db/models'
import { makeField } from '@/physics/height_field'
import { evalSurface } from '@/physics/surface'
import { surfaceDelta } from '@/physics/defects'
import { buildStack, Stack } from '@/physics/ray_trace'

export const buildGlassStack = (glass: GlassSpec, settings: AppSettings): Stack => {
  const nx = settings.fieldN
  const ny = Math.max(32, Math.round((settings.fieldN * glass.height) / glass.width))
  const spec = {
    width: glass.width,
    height: glass.height,
    curves: glass.curves,
    poly: glass.poly,
  }
  const base = makeField(
    nx,
    ny,
    -glass.width / 2,
    -glass.height / 2,
    glass.width / 2,
    glass.height / 2,
    (x, y) => evalSurface(spec, x, y) + surfaceDelta(glass.defects, x, y),
  )
  return buildStack(
    base,
    {
      tInner: glass.thickness.inner,
      tPvb: glass.thickness.pvb,
      tOuter: glass.thickness.outer,
      nGlass: settings.nGlass,
      nPvb: settings.nPvb,
    },
    glass.defects,
    glass.width,
    glass.height,
  )
}
