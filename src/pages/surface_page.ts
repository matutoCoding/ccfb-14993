// 玻璃曲面:控制曲线放样 / 点云拟合 / 夹层厚度 / 制造缺陷
import { h, numField, toast } from '@/lib/dom'
import { getAll, put } from '@/db/database'
import { GlassSpec, uid } from '@/db/models'
import { evalSurface, fitPoly } from '@/physics/surface'
import { Defect, defectLabel } from '@/physics/defects'

export const renderSurface = async (root: HTMLElement): Promise<void> => {
  const glasses = await getAll<GlassSpec>('glasses')
  let current = glasses[0]

  const page = h('div', {})
  root.append(page)

  const rebuild = () => {
    page.textContent = ''
    page.append(
      h('div', { class: 'page-head' },
        h('h1', {}, '玻璃曲面'),
        h('p', {}, '控制曲线放样生成曲面,或导入点云拟合;内外两层玻璃夹 PVB,可叠加制造缺陷'),
      ),
    )
    // 玻璃选择
    const sel = h('select', {}, ...glasses.map((g) => {
      const o = h('option', { value: g.id }, g.name) as HTMLOptionElement
      o.selected = g.id === current.id
      return o
    })) as HTMLSelectElement
    sel.addEventListener('change', () => {
      current = glasses.find((g) => g.id === sel.value) ?? glasses[0]
      rebuild()
    })
    page.append(
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('label', { class: 'field' }, '选择玻璃', sel),
          h('button', {
            onclick: async () => {
              const g: GlassSpec = JSON.parse(JSON.stringify(current))
              g.id = uid()
              g.name = `${current.name} 副本`
              glasses.push(g)
              await put('glasses', g)
              current = g
              rebuild()
            },
          }, '复制新建'),
        ),
      ),
    )

    // 基本参数
    const base = h('div', { class: 'card' }, h('h2', {}, '几何与夹层'))
    base.append(
      h('div', { class: 'row' },
        numField('宽度 (m)', current.width, (v) => { current.width = v; rebuild() }, 0.01),
        numField('高度 (m)', current.height, (v) => { current.height = v; rebuild() }, 0.01),
        numField('内层玻璃厚 (mm)', current.thickness.inner * 1000, (v) => (current.thickness.inner = v / 1000), 0.1),
        numField('PVB 厚 (mm)', current.thickness.pvb * 1000, (v) => (current.thickness.pvb = v / 1000), 0.05),
        numField('外层玻璃厚 (mm)', current.thickness.outer * 1000, (v) => (current.thickness.outer = v / 1000), 0.1),
      ),
    )
    page.append(base)

    // 控制曲线编辑
    const curveCard = h('div', { class: 'card' }, h('h2', {}, '控制曲线(截面矢高,mm)'))
    if (current.poly) {
      curveCard.append(
        h('p', { class: 'hint' }, `当前使用点云拟合曲面(${current.poly.deg} 阶多项式,${current.poly.coef.length} 项),控制曲线已停用`),
        h('button', { onclick: () => { delete current.poly; rebuild() } }, '清除拟合,恢复控制曲线'),
      )
    } else {
      const labels = ['下沿', '中线', '上沿']
      current.curves.forEach((c, ci) => {
        const row = h('div', { class: 'row', style: 'align-items:center' }, h('span', { style: 'width:40px;color:var(--text-2)' }, labels[ci] ?? `v=${c.v}`))
        c.pts.forEach((p, pi) => {
          row.append(numField(`u=${(p.u * 1000).toFixed(0)}mm`, p.z * 1000, (v) => {
            p.z = v / 1000
            drawPreview()
          }, 1))
        })
        curveCard.append(row)
      })
    }
    const preview = h('canvas', { class: 'view', width: 860, height: 260, style: 'background:#fff;margin-top:12px' }) as HTMLCanvasElement
    curveCard.append(preview)
    page.append(curveCard)

    const drawPreview = () => {
      const ctx = preview.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, preview.width, preview.height)
      const spec = { width: current.width, height: current.height, curves: current.curves, poly: current.poly }
      const pad = 30
      const colors = ['#94a3b8', '#2563eb', '#94a3b8']
      const names = ['下沿', '中线', '上沿']
      let zMax = 0.001
      for (let i = 0; i <= 100; i++) {
        const u = -current.width / 2 + (current.width * i) / 100
        for (const c of current.curves) zMax = Math.max(zMax, Math.abs(evalSurface(spec, u, c.v)))
      }
      current.curves.forEach((c, ci) => {
        ctx.beginPath()
        for (let i = 0; i <= 200; i++) {
          const u = -current.width / 2 + (current.width * i) / 200
          const z = evalSurface(spec, u, c.v)
          const x = pad + ((u + current.width / 2) / current.width) * (preview.width - 2 * pad)
          const y = preview.height / 2 - (z / zMax) * (preview.height / 2 - pad)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = colors[ci] ?? '#94a3b8'
        ctx.lineWidth = ci === 1 ? 2 : 1.2
        ctx.stroke()
        ctx.fillStyle = colors[ci] ?? '#94a3b8'
        ctx.font = '13px sans-serif'
        ctx.fillText(names[ci] ?? '', preview.width - pad - 30, 20 + ci * 18)
      })
    }
    drawPreview()

    // 点云导入
    const cloudCard = h('div', { class: 'card' }, h('h2', {}, '点云导入拟合'))
    const ta = h('textarea', { rows: 5, style: 'width:100%', placeholder: '每行一个点:x y z(米),空格分隔' }) as HTMLTextAreaElement
    cloudCard.append(
      ta,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', {
          class: 'primary',
          onclick: () => {
            const pts = ta.value
              .split('\n')
              .map((line) => line.trim().split(/\s+/).map(Number))
              .filter((a) => a.length >= 3 && a.every((v) => Number.isFinite(v)))
              .map(([x, y, z]) => ({ x, y, z }))
            if (pts.length < 10) {
              toast('至少需要 10 个有效点')
              return
            }
            const fit = fitPoly(pts, 3)
            // 拟合残差
            let sse = 0
            const spec = { width: current.width, height: current.height, curves: current.curves, poly: fit }
            for (const p of pts) {
              const dz = evalSurface(spec, p.x, p.y) - p.z
              sse += dz * dz
            }
            current.poly = fit
            toast(`拟合完成,RMS 残差 ${(Math.sqrt(sse / pts.length) * 1000).toFixed(3)} mm`)
            rebuild()
          },
        }, '拟合为三阶多项式曲面'),
      ),
    )
    page.append(cloudCard)

    // 缺陷
    const defCard = h('div', { class: 'card' }, h('h2', {}, '制造缺陷'))
    if (current.defects.length === 0) {
      defCard.append(h('p', { class: 'hint' }, '暂无缺陷,下方添加'))
    } else {
      const dt = h('table', {}, h('tr', {}, h('th', {}, '类型'), h('th', {}, '参数'), h('th', {}, '')))
      current.defects.forEach((d, i) => {
        const desc =
          d.kind === 'thickness'
            ? `中心(${d.u0}, ${d.v0})m σ=${(d.sigma * 1000).toFixed(0)}mm 幅值 ${(d.amp * 1000).toFixed(2)}mm`
            : d.kind === 'waviness'
              ? `方向 ${d.dirDeg}° 波长 ${(d.wavelength * 1000).toFixed(0)}mm 幅值 ${(d.amp * 1000).toFixed(3)}mm`
              : `带宽 ${(d.width * 1000).toFixed(0)}mm 幅值 ${(d.amp * 1000).toFixed(2)}mm`
        const tr = h('tr', {},
          h('td', {}, defectLabel(d)),
          h('td', {}, desc),
          h('td', {}, h('button', { class: 'danger', onclick: () => { current.defects.splice(i, 1); rebuild() } }, '删除')),
        )
        dt.append(tr)
      })
      defCard.append(dt)
    }
    const kindSel = h('select', {},
      h('option', { value: 'thickness' }, '局部厚度不均'),
      h('option', { value: 'waviness' }, '成型波纹'),
      h('option', { value: 'edgeBump' }, '边部应力凸起'),
    ) as HTMLSelectElement
    const paramBox = h('div', { class: 'row', style: 'margin-top:8px' })
    const defectParams: Defect =
      { id: uid(), kind: 'thickness', u0: 0, v0: 0, sigma: 0.03, amp: 0.0003 }
    let active: Defect = defectParams
    const buildParams = () => {
      paramBox.textContent = ''
      const kind = kindSel.value
      if (kind === 'thickness') {
        active = { id: uid(), kind: 'thickness', u0: 0, v0: 0, sigma: 0.03, amp: 0.0003 }
        paramBox.append(
          numField('中心 u (m)', 0, (v) => { if (active.kind === 'thickness') active.u0 = v }, 0.01),
          numField('中心 v (m)', 0, (v) => { if (active.kind === 'thickness') active.v0 = v }, 0.01),
          numField('σ (mm)', 30, (v) => { if (active.kind === 'thickness') active.sigma = v / 1000 }, 1),
          numField('幅值 (mm)', 0.3, (v) => { if (active.kind === 'thickness') active.amp = v / 1000 }, 0.05),
        )
      } else if (kind === 'waviness') {
        active = { id: uid(), kind: 'waviness', dirDeg: 0, wavelength: 0.05, amp: 0.00005, phase: 0 }
        paramBox.append(
          numField('方向 (°)', 0, (v) => { if (active.kind === 'waviness') active.dirDeg = v }, 5),
          numField('波长 (mm)', 50, (v) => { if (active.kind === 'waviness') active.wavelength = v / 1000 }, 5),
          numField('幅值 (mm)', 0.05, (v) => { if (active.kind === 'waviness') active.amp = v / 1000 }, 0.01),
        )
      } else {
        active = { id: uid(), kind: 'edgeBump', width: 0.02, amp: 0.0002 }
        paramBox.append(
          numField('带宽 (mm)', 20, (v) => { if (active.kind === 'edgeBump') active.width = v / 1000 }, 1),
          numField('幅值 (mm)', 0.2, (v) => { if (active.kind === 'edgeBump') active.amp = v / 1000 }, 0.02),
        )
      }
    }
    kindSel.addEventListener('change', buildParams)
    buildParams()
    defCard.append(
      h('div', { class: 'row', style: 'margin-top:12px' }, h('label', { class: 'field' }, '缺陷类型', kindSel)),
      paramBox,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { onclick: () => { current.defects.push({ ...active }); rebuild() } }, '添加缺陷'),
      ),
    )
    page.append(defCard)

    page.append(
      h('div', { class: 'card' },
        h('button', {
          class: 'primary',
          onclick: async () => {
            await put('glasses', JSON.parse(JSON.stringify(current)) as GlassSpec)
            toast('玻璃曲面已保存')
          },
        }, '保存玻璃'),
      ),
    )
  }
  rebuild()
}
