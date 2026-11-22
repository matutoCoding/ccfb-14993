// 检测工位:按真实布置渲染斑马板/路面,条纹角度宽度板距可调,主驾视角动态
import { h, numField, toast } from '@/lib/dom'
import { getAll, put } from '@/db/database'
import { Vehicle, GlassSpec, Station, AppSettings, defaultSettings } from '@/db/models'
import { buildGlassStack } from '@/physics/build'
import { GpuView, renderCpu, ViewParams } from '@/gpu/renderer'
import { Vec3 } from '@/lib/vec'

export const renderStation = async (root: HTMLElement): Promise<void> => {
  const vehicles = await getAll<Vehicle>('vehicles')
  const glasses = await getAll<GlassSpec>('glasses')
  const stations = await getAll<Station>('stations')
  const settings = (await getAll<AppSettings>('settings'))[0] ?? defaultSettings()

  let vehicle = vehicles[0]
  let station = stations.find((s) => s.vehicleId === vehicle.id) ?? stations[0]
  let mode: 'zebra' | 'road' = 'zebra'
  let animate = false
  let raf = 0

  const page = h('div', {})
  root.append(page)

  const rebuild = () => {
    cancelAnimationFrame(raf)
    page.textContent = ''
    page.append(
      h('div', { class: 'page-head' },
        h('h1', {}, '检测工位'),
        h('p', {}, '按真实布置透过玻璃渲染斑马板;路面模式模拟主驾视角,眼点移动可见车道线跳动'),
      ),
    )

    const glass = glasses.find((g) => g.id === vehicle.glassId)
    if (!glass) {
      page.append(h('div', { class: 'card' }, '车型未关联玻璃'))
      return
    }
    const stack = buildGlassStack(glass, settings)

    const canvas = h('canvas', { class: 'view', style: 'aspect-ratio:16/9' }) as HTMLCanvasElement
    const hint = h('p', { class: 'hint' }, '')

    const eye = (): Vec3 => [
      vehicle.eyePoint.x + station.eyeOffset.x,
      vehicle.eyePoint.y + station.eyeOffset.y,
      vehicle.eyePoint.z + station.eyeOffset.z,
    ]
    const params = (t: number): ViewParams => {
      const e = eye()
      const dyn: Vec3 = animate
        ? [e[0] + 0.04 * Math.sin(t * 0.9), e[1] + 0.025 * Math.sin(t * 1.3), e[2]]
        : e
      return {
        eye: dyn,
        board: { dist: station.boardDist, angleDeg: station.stripeAngleDeg, period: station.stripePeriod },
        w: glass.width,
        h: glass.height,
        mode,
      }
    }

    let gpu: GpuView | null = null
    const renderFrame = (t: number) => {
      const p = params(t / 1000)
      if (gpu) gpu.render(p)
      else renderCpu(canvas, stack, p)
      if (animate) raf = requestAnimationFrame(renderFrame)
    }

    void GpuView.create(canvas).then((g) => {
      gpu = g
      if (gpu) {
        gpu.setStack(stack)
        hint.textContent = 'WebGPU 渲染中'
      } else {
        hint.textContent = '当前浏览器不支持 WebGPU,已回退 CPU 渲染(较慢)'
      }
      renderFrame(performance.now())
    })

    // 控制区
    const vehicleSel = h('select', {}, ...vehicles.map((v) => {
      const o = h('option', { value: v.id }, v.name) as HTMLOptionElement
      o.selected = v.id === vehicle.id
      return o
    })) as HTMLSelectElement
    vehicleSel.addEventListener('change', () => {
      vehicle = vehicles.find((v) => v.id === vehicleSel.value) ?? vehicles[0]
      station = stations.find((s) => s.vehicleId === vehicle.id) ?? station
      rebuild()
    })

    const controls = h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('label', { class: 'field' }, '车型', vehicleSel),
        numField('条纹角度 (°)', station.stripeAngleDeg, (v) => { station.stripeAngleDeg = v; renderFrame(performance.now()) }, 1),
        numField('条纹周期 (mm)', station.stripePeriod * 1000, (v) => { station.stripePeriod = v / 1000; renderFrame(performance.now()) }, 1),
        numField('板到玻璃距离 (m)', station.boardDist, (v) => { station.boardDist = v; renderFrame(performance.now()) }, 0.1),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        numField('眼点偏移 x (m)', station.eyeOffset.x, (v) => { station.eyeOffset.x = v; renderFrame(performance.now()) }, 0.01),
        numField('眼点偏移 y (m)', station.eyeOffset.y, (v) => { station.eyeOffset.y = v; renderFrame(performance.now()) }, 0.01),
        numField('眼点偏移 z (m)', station.eyeOffset.z, (v) => { station.eyeOffset.z = v; renderFrame(performance.now()) }, 0.01),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: mode === 'zebra' ? 'primary' : '', onclick: () => { mode = 'zebra'; rebuild() } }, '斑马板'),
        h('button', { class: mode === 'road' ? 'primary' : '', onclick: () => { mode = 'road'; rebuild() } }, '路面视角'),
        h('button', {
          onclick: () => {
            animate = !animate
            if (animate) raf = requestAnimationFrame(renderFrame)
            renderFrame(performance.now())
          },
        }, animate ? '停止眼点移动' : '眼点动态'),
        h('button', {
          onclick: async () => {
            await put('stations', JSON.parse(JSON.stringify(station)) as Station)
            toast('工位配置已保存')
          },
        }, '保存工位'),
        hint,
      ),
    )
    page.append(controls, canvas)
  }
  rebuild()
}
