// 畸变分析:逐点屈光度图 + A/B区限值判定 + 条纹反推对照
import { h, toast } from '@/lib/dom'
import { getAll } from '@/db/database'
import { Vehicle, GlassSpec, AppSettings, defaultSettings, inPolygon, Pt } from '@/db/models'
import { buildGlassStack } from '@/physics/build'
import { diopterAt } from '@/physics/ray_trace'
import { renderStripeImage, invertDiopter, Board } from '@/physics/stripe'
import { Vec3 } from '@/lib/vec'

// 屈光度值到颜色(蓝->绿->红)
const heat = (v: number, vmax: number): [number, number, number] => {
  const t = Math.min(1, v / vmax)
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.5 * t - 0.2)))
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.2 - 1.5 * t)))
  const g = Math.round(200 * (1 - Math.abs(t - 0.5) * 2) + 40)
  return [r, g, b]
}

export const renderAnalysis = async (root: HTMLElement): Promise<void> => {
  const vehicles = await getAll<Vehicle>('vehicles')
  const glasses = await getAll<GlassSpec>('glasses')
  const settings = (await getAll<AppSettings>('settings'))[0] ?? defaultSettings()
  let vehicle = vehicles[0]

  const page = h('div', {})
  root.append(page)

  const rebuild = () => {
    page.textContent = ''
    page.append(
      h('div', { class: 'page-head' },
        h('h1', {}, '畸变分析'),
        h('p', {}, '逐点屈光度分布,A/B 区分别套用限值;相机条纹图反推结果与直接计算对照'),
      ),
    )
    const glass = glasses.find((g) => g.id === vehicle.glassId)
    if (!glass) return
    const vehicleSel = h('select', {}, ...vehicles.map((v) => {
      const o = h('option', { value: v.id }, v.name) as HTMLOptionElement
      o.selected = v.id === vehicle.id
      return o
    })) as HTMLSelectElement
    vehicleSel.addEventListener('change', () => {
      vehicle = vehicles.find((v) => v.id === vehicleSel.value) ?? vehicles[0]
      rebuild()
    })
    const runBtn = h('button', { class: 'primary' }, '计算畸变图') as HTMLButtonElement
    const progress = h('span', { class: 'hint' }, '')
    page.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', { class: 'field' }, '车型', vehicleSel), runBtn, progress)))

    const mapCard = h('div', { class: 'card' }, h('h2', {}, '屈光度分布图 (dpt)'))
    const mapCanvas = h('canvas', { class: 'view', width: 860, height: 520, style: 'background:#fff' }) as HTMLCanvasElement
    const statsBox = h('div', { class: 'stat-grid', style: 'margin-top:12px' })
    mapCard.append(mapCanvas, statsBox)
    page.append(mapCard)

    const invCard = h('div', { class: 'card' }, h('h2', {}, '条纹反推对照'))
    const invRow = h('div', { class: 'row' })
    const imgCanvas = h('canvas', { class: 'view', width: 640, height: 384, style: 'background:#fff;max-width:48%' }) as HTMLCanvasElement
    const profCanvas = h('canvas', { class: 'view', width: 640, height: 384, style: 'background:#fff;max-width:48%' }) as HTMLCanvasElement
    const invStats = h('p', { class: 'hint' }, '')
    invRow.append(imgCanvas, profCanvas)
    invCard.append(invRow, invStats)
    page.append(invCard)

    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true
      const stack = buildGlassStack(glass, settings)
      const eye: Vec3 = [vehicle.eyePoint.x, vehicle.eyePoint.y, vehicle.eyePoint.z]
      const src = { kind: 'eye', eye } as const
      const nx = settings.mapNx
      const ny = settings.mapNy
      // 分片计算,让进度条有机会刷新
      const map = await new Promise<Float32Array>((resolve) => {
        const out = new Float32Array(nx * ny).fill(NaN)
        let j = 0
        const step = () => {
          const y = -glass.height / 2 + (glass.height * j) / (ny - 1)
          for (let i = 0; i < nx; i++) {
            const x = -glass.width / 2 + (glass.width * i) / (nx - 1)
            const d = diopterAt(stack, src, x, y)
            if (d) out[j * nx + i] = d.mag
          }
          progress.textContent = `计算中 ${Math.round(((j + 1) / ny) * 100)}%`
          j++
          if (j < ny) setTimeout(step, 0)
          else resolve(out)
        }
        step()
      })
      progress.textContent = '完成'
      // 统计与绘制
      let maxA = 0
      let maxB = 0
      let sumA = 0
      let nA = 0
      let vmax = 0.001
      for (let j = 0; j < ny; j++) {
        const y = -glass.height / 2 + (glass.height * j) / (ny - 1)
        for (let i = 0; i < nx; i++) {
          const v = map[j * nx + i]
          if (Number.isNaN(v)) continue
          const x = -glass.width / 2 + (glass.width * i) / (nx - 1)
          vmax = Math.max(vmax, v)
          if (inPolygon(x, y, vehicle.zones.a)) {
            maxA = Math.max(maxA, v)
            sumA += v
            nA++
          }
          if (inPolygon(x, y, vehicle.zones.b)) maxB = Math.max(maxB, v)
        }
      }
      const ctx = mapCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height)
        const pad = 36
        const s = Math.min((mapCanvas.width - 2 * pad) / glass.width, (mapCanvas.height - 2 * pad) / glass.height)
        const ox = mapCanvas.width / 2
        const oy = mapCanvas.height / 2
        const cw = (glass.width / nx) * s
        const ch = (glass.height / ny) * s
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const v = map[j * nx + i]
            if (Number.isNaN(v)) continue
            const x = -glass.width / 2 + (glass.width * i) / (nx - 1)
            const y = -glass.height / 2 + (glass.height * j) / (ny - 1)
            const inA = inPolygon(x, y, vehicle.zones.a)
            const limit = inA ? settings.limitA : settings.limitB
            const over = v > limit
            const [r, g, b] = heat(v, vmax)
            ctx.fillStyle = over ? '#dc2626' : `rgb(${r},${g},${b})`
            ctx.fillRect(ox + x * s - cw / 2, oy - y * s - ch / 2, cw + 0.5, ch + 0.5)
          }
        }
        // 区域边界
        const drawPoly = (pts: Pt[] | undefined, color: string) => {
          if (!pts || pts.length < 3) return
          ctx.beginPath()
          pts.forEach((p, i) => {
            const px = ox + p.u * s
            const py = oy - p.v * s
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          ctx.closePath()
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.stroke()
        }
        drawPoly(vehicle.zones.b, '#16a34a')
        drawPoly(vehicle.zones.a, '#2563eb')
        drawPoly(vehicle.zones.hud, '#d97706')
        ctx.fillStyle = '#0f172a'
        ctx.font = '13px sans-serif'
        ctx.fillText(`峰值 ${vmax.toFixed(3)} dpt,红色为超限点(A区限 ${settings.limitA},B区限 ${settings.limitB})`, pad, 20)
      }
      const verdictA = maxA <= settings.limitA
      const verdictB = maxB <= settings.limitB
      statsBox.textContent = ''
      statsBox.append(
        h('div', { class: 'stat' }, h('div', { class: 'v' }, maxA.toFixed(4)), h('div', { class: 'k' }, `A区峰值 (dpt) ${verdictA ? '合格' : '超限'}`)),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, maxB.toFixed(4)), h('div', { class: 'k' }, `B区峰值 (dpt) ${verdictB ? '合格' : '超限'}`)),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, nA > 0 ? (sumA / nA).toFixed(4) : '-'), h('div', { class: 'k' }, 'A区均值 (dpt)')),
        h('div', { class: 'stat' },
          h('div', { class: 'v' }, h('span', { class: `badge ${verdictA && verdictB ? 'ok' : 'fail'}` }, verdictA && verdictB ? '合格' : '不合格')),
          h('div', { class: 'k' }, '综合判定')),
      )

      // 条纹反推对照
      invStats.textContent = '反推计算中...'
      const board: Board = { dist: 1.2, angleDeg: 0, period: 0.02 }
      const inx = 640
      const iny = 384
      const img = renderStripeImage(stack, eye, board, glass.width, glass.height, inx, iny)
      const ictx = imgCanvas.getContext('2d')
      if (ictx) {
        const id = ictx.createImageData(inx, iny)
        for (let i = 0; i < inx * iny; i++) {
          const v = Math.round(img[i] * 255)
          id.data[i * 4] = v
          id.data[i * 4 + 1] = v
          id.data[i * 4 + 2] = v
          id.data[i * 4 + 3] = 255
        }
        ictx.putImageData(id, 0, 0)
      }
      const inv = invertDiopter(img, inx, iny, stack, eye, board, glass.width, glass.height)
      // 直接计算同一剖面
      const direct: (number | null)[] = inv.x.map((x) => {
        const d = diopterAt(stack, src, x, 0)
        return d ? d.du : null
      })
      // 画剖面对照
      const pctx = profCanvas.getContext('2d')
      let rms = 0
      let cnt = 0
      if (pctx && inv.x.length > 2) {
        pctx.clearRect(0, 0, profCanvas.width, profCanvas.height)
        let dmax = 0.01
        inv.diopter.forEach((v) => (dmax = Math.max(dmax, Math.abs(v))))
        direct.forEach((v) => {
          if (v !== null) dmax = Math.max(dmax, Math.abs(v))
        })
        const x0 = inv.x[0]
        const x1 = inv.x[inv.x.length - 1]
        const toPx = (x: number, d: number): [number, number] => [
          30 + ((x - x0) / (x1 - x0)) * (profCanvas.width - 60),
          profCanvas.height / 2 - (d / dmax) * (profCanvas.height / 2 - 30),
        ]
        pctx.strokeStyle = '#cbd5e1'
        pctx.beginPath()
        pctx.moveTo(30, profCanvas.height / 2)
        pctx.lineTo(profCanvas.width - 30, profCanvas.height / 2)
        pctx.stroke()
        const plot = (xs: number[], ys: (number | null)[], color: string) => {
          pctx.beginPath()
          let started = false
          for (let k = 0; k < xs.length; k++) {
            const y = ys[k]
            if (y === null) continue
            const [px, py] = toPx(xs[k], y)
            if (!started) {
              pctx.moveTo(px, py)
              started = true
            } else pctx.lineTo(px, py)
          }
          pctx.strokeStyle = color
          pctx.lineWidth = 1.6
          pctx.stroke()
        }
        plot(inv.x, direct, '#2563eb')
        plot(inv.x, inv.diopter, '#dc2626')
        pctx.fillStyle = '#2563eb'
        pctx.font = '13px sans-serif'
        pctx.fillText('蓝:直接计算', 40, 24)
        pctx.fillStyle = '#dc2626'
        pctx.fillText('红:条纹反推', 140, 24)
        for (let k = 0; k < inv.x.length; k++) {
          const d = direct[k]
          if (d === null) continue
          rms += (inv.diopter[k] - d) ** 2
          cnt++
        }
        invStats.textContent = `反推 vs 直接计算:RMS 偏差 ${Math.sqrt(rms / cnt).toFixed(5)} dpt,共 ${cnt} 个采样点(中心水平剖面)`
      } else {
        invStats.textContent = '反推失败:条纹采样不足'
      }
      runBtn.disabled = false
      toast('畸变分析完成')
    })
  }
  rebuild()
}
