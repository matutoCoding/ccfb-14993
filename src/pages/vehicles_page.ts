// 车型档案:装车倾角 / 眼点 / A区B区HUD区划分
import { h, numField, toast } from '@/lib/dom'
import { getAll, put } from '@/db/database'
import { Vehicle, GlassSpec, Pt } from '@/db/models'

const ZONE_COLORS = { a: '#2563eb', b: '#16a34a', hud: '#d97706' }
const ZONE_NAMES = { a: 'A区', b: 'B区', hud: 'HUD区' }

export const renderVehicles = async (root: HTMLElement): Promise<void> => {
  const vehicles = await getAll<Vehicle>('vehicles')
  const glasses = await getAll<GlassSpec>('glasses')
  let current: Vehicle = vehicles[0]
  let drawMode: 'a' | 'b' | 'hud' | null = null
  let draft: Pt[] = []

  const page = h('div', {})
  root.append(page)

  const rebuild = () => {
    page.textContent = ''
    page.append(
      h('div', { class: 'page-head' },
        h('h1', {}, '车型档案'),
        h('p', {}, '装车倾角、驾驶员眼点与 A/B/HUD 区域划分,区域边界直接在玻璃轮廓上绘制'),
      ),
    )
    const listCard = h('div', { class: 'card' }, h('h2', {}, '车型列表'))
    const table = h('table', {},
      h('tr', {}, h('th', {}, '名称'), h('th', {}, '类型'), h('th', {}, '装车倾角'), h('th', {}, '眼点 (x, y, z)')),
    )
    for (const v of vehicles) {
      const tr = h('tr', {},
        h('td', {}, v.name),
        h('td', {}, v.kind),
        h('td', {}, `${v.installAngleDeg}°`),
        h('td', {}, `(${v.eyePoint.x}, ${v.eyePoint.y}, ${v.eyePoint.z}) m`),
      )
      if (v.id === current.id) tr.style.background = 'var(--accent-soft)'
      tr.style.cursor = 'pointer'
      tr.addEventListener('click', () => {
        current = v
        drawMode = null
        draft = []
        rebuild()
      })
      table.append(tr)
    }
    listCard.append(table)
    page.append(listCard)

    // 编辑器
    const edit = h('div', { class: 'card' }, h('h2', {}, `编辑:${current.name}`))
    const glass = glasses.find((g) => g.id === current.glassId)
    const row1 = h('div', { class: 'row' },
      numField('装车倾角(°,与竖直夹角)', current.installAngleDeg, (v) => (current.installAngleDeg = v), 0.5),
      numField('眼点 x (m)', current.eyePoint.x, (v) => (current.eyePoint.x = v), 0.01),
      numField('眼点 y (m)', current.eyePoint.y, (v) => (current.eyePoint.y = v), 0.01),
      numField('眼点 z (m)', current.eyePoint.z, (v) => (current.eyePoint.z = v), 0.01),
    )
    const glassSel = h('select', {}, ...glasses.map((g) => {
      const o = h('option', { value: g.id }, `${g.name} (${g.width}x${g.height}m)`) as HTMLOptionElement
      o.selected = g.id === current.glassId
      return o
    })) as HTMLSelectElement
    glassSel.addEventListener('change', () => {
      current.glassId = glassSel.value
      rebuild()
    })
    edit.append(row1, h('div', { class: 'row', style: 'margin-top:12px' },
      h('label', { class: 'field' }, '关联玻璃曲面', glassSel),
    ))

    // 区域绘制画布
    const canvas = h('canvas', { class: 'view', width: 860, height: 520, style: 'background:#fff;margin-top:16px' }) as HTMLCanvasElement
    const drawZones = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx || !glass) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const pad = 40
      const sx = (canvas.width - 2 * pad) / glass.width
      const sy = (canvas.height - 2 * pad) / glass.height
      const s = Math.min(sx, sy)
      const ox = canvas.width / 2
      const oy = canvas.height / 2
      const toPx = (u: number, v: number): [number, number] => [ox + u * s, oy - v * s]
      // 玻璃轮廓
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 1.5
      ctx.strokeRect(...toPx(-glass.width / 2, glass.height / 2), glass.width * s, glass.height * s)
      // 眼点投影
      const [ex, ey] = toPx(current.eyePoint.x, current.eyePoint.y)
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(ex, ey, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillText('眼点投影', ex + 8, ey + 4)
      // 区域多边形
      const drawPoly = (pts: Pt[] | undefined, color: string, label: string) => {
        if (!pts || pts.length < 3) return
        ctx.beginPath()
        pts.forEach((p, i) => {
          const [x, y] = toPx(p.u, p.v)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
        ctx.fillStyle = `${color}22`
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
        const cx = pts.reduce((a, p) => a + p.u, 0) / pts.length
        const cy = pts.reduce((a, p) => a + p.v, 0) / pts.length
        const [lx, ly] = toPx(cx, cy)
        ctx.fillStyle = color
        ctx.font = '14px sans-serif'
        ctx.fillText(label, lx - 12, ly + 4)
      }
      drawPoly(current.zones.b, ZONE_COLORS.b, 'B区')
      drawPoly(current.zones.a, ZONE_COLORS.a, 'A区')
      drawPoly(current.zones.hud, ZONE_COLORS.hud, 'HUD')
      // 草稿
      if (draft.length > 0) {
        ctx.beginPath()
        draft.forEach((p, i) => {
          const [x, y] = toPx(p.u, p.v)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = '#dc2626'
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
        for (const p of draft) {
          const [x, y] = toPx(p.u, p.v)
          ctx.fillStyle = '#dc2626'
          ctx.fillRect(x - 2, y - 2, 4, 4)
        }
      }
    }
    canvas.addEventListener('click', (e) => {
      if (!drawMode || !glass) return
      const rect = canvas.getBoundingClientRect()
      const pad = 40
      const s = Math.min((canvas.width - 2 * pad) / glass.width, (canvas.height - 2 * pad) / glass.height)
      const u = (e.clientX - rect.left - canvas.width / 2) / s
      const v = -(e.clientY - rect.top - canvas.height / 2) / s
      draft.push({ u, v })
      drawZones()
    })
    const closeDraft = () => {
      if (!drawMode || draft.length < 3) {
        toast('至少需要 3 个顶点')
        return
      }
      if (drawMode === 'a') current.zones.a = [...draft]
      else if (drawMode === 'b') current.zones.b = [...draft]
      else current.zones.hud = [...draft]
      draft = []
      drawMode = null
      rebuild()
    }
    const zoneBar = h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { onclick: () => { drawMode = 'a'; draft = []; drawZones() } }, '绘制A区'),
      h('button', { onclick: () => { drawMode = 'b'; draft = []; drawZones() } }, '绘制B区'),
      h('button', { onclick: () => { drawMode = 'hud'; draft = []; drawZones() } }, '绘制HUD区'),
      h('button', { class: 'primary', onclick: closeDraft }, '闭合区域'),
      h('button', { onclick: () => { draft = []; drawMode = null; drawZones() } }, '取消绘制'),
      h('span', { class: 'hint' }, drawMode ? `正在绘制:${ZONE_NAMES[drawMode]},点击画布添加顶点后闭合` : '选择区域类型后在玻璃轮廓上点击绘制'),
    )
    edit.append(canvas, zoneBar)
    edit.append(
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', {
          class: 'primary',
          onclick: async () => {
            await put('vehicles', JSON.parse(JSON.stringify(current)) as Vehicle)
            toast('车型已保存')
          },
        }, '保存车型'),
      ),
    )
    page.append(edit)
    drawZones()
  }
  rebuild()
}
