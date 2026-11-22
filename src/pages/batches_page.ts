// 批次记录:每块玻璃的缺陷参数与判定结果,按缺陷类型统计超标率
import { h, numField, toast } from '@/lib/dom'
import { getAll, put, del } from '@/db/database'
import { Vehicle, GlassSpec, AppSettings, defaultSettings, BatchRecord, inPolygon, uid } from '@/db/models'
import { buildGlassStack } from '@/physics/build'
import { diopterAt } from '@/physics/ray_trace'
import { Defect, defectLabel } from '@/physics/defects'
import { Vec3 } from '@/lib/vec'

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

// 按类型生成随机缺陷参数
const randomDefect = (kind: string): Defect => {
  if (kind === 'thickness') {
    return { id: uid(), kind: 'thickness', u0: rand(-0.4, 0.4), v0: rand(-0.2, 0.2), sigma: rand(0.02, 0.05), amp: rand(0.0001, 0.0005) }
  }
  if (kind === 'waviness') {
    return { id: uid(), kind: 'waviness', dirDeg: rand(0, 90), wavelength: rand(0.03, 0.08), amp: rand(0.00002, 0.0001), phase: rand(0, 6.28) }
  }
  return { id: uid(), kind: 'edgeBump', width: rand(0.015, 0.03), amp: rand(0.0001, 0.0004) }
}

export const renderBatches = async (root: HTMLElement): Promise<void> => {
  const vehicles = await getAll<Vehicle>('vehicles')
  const glasses = await getAll<GlassSpec>('glasses')
  const settings = (await getAll<AppSettings>('settings'))[0] ?? defaultSettings()
  let records = await getAll<BatchRecord>('batches')
  records.sort((a, b) => b.ts - a.ts)

  const page = h('div', {})
  root.append(page)

  const rebuild = () => {
    page.textContent = ''
    page.append(
      h('div', { class: 'page-head' },
        h('h1', {}, '批次记录'),
        h('p', {}, '每块玻璃的缺陷参数与判定结果,按缺陷类型统计超标率'),
      ),
    )

    // 生成批次
    const vehicleSel = h('select', {}, ...vehicles.map((v) => h('option', { value: v.id }, v.name))) as HTMLSelectElement
    const kindSel = h('select', {},
      h('option', { value: 'thickness' }, '局部厚度不均'),
      h('option', { value: 'waviness' }, '成型波纹'),
      h('option', { value: 'edgeBump' }, '边部应力凸起'),
      h('option', { value: 'mixed' }, '混合(随机)'),
    ) as HTMLSelectElement
    let count = 10
    const genBtn = h('button', { class: 'primary' }, '生成批次') as HTMLButtonElement
    const genProgress = h('span', { class: 'hint' }, '')
    page.append(
      h('div', { class: 'card' },
        h('h2', {}, '生成检测批次'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, '车型', vehicleSel),
          h('label', { class: 'field' }, '缺陷类型', kindSel),
          numField('数量', count, (v) => (count = Math.max(1, Math.round(v))), 1),
          genBtn,
          genProgress,
        ),
      ),
    )

    // 统计
    const statCard = h('div', { class: 'card' }, h('h2', {}, '按缺陷类型统计'))
    const kinds = ['thickness', 'waviness', 'edgeBump']
    const statTable = h('table', {},
      h('tr', {}, h('th', {}, '缺陷类型'), h('th', {}, '样本数'), h('th', {}, '超标数'), h('th', {}, '超标率')),
    )
    for (const k of kinds) {
      const rel = records.filter((r) => r.defects.some((d) => d.kind === k))
      const fail = rel.filter((r) => r.verdict === 'fail').length
      const label = k === 'thickness' ? '局部厚度不均' : k === 'waviness' ? '成型波纹' : '边部应力凸起'
      statTable.append(
        h('tr', {},
          h('td', {}, label),
          h('td', {}, String(rel.length)),
          h('td', {}, String(fail)),
          h('td', {}, rel.length > 0 ? `${((fail / rel.length) * 100).toFixed(1)}%` : '-'),
        ),
      )
    }
    statCard.append(statTable)
    page.append(statCard)

    // 记录表
    const recCard = h('div', { class: 'card' }, h('h2', {}, `检测记录(${records.length})`))
    if (records.length === 0) {
      recCard.append(h('p', { class: 'hint' }, '暂无记录,请先生成批次'))
    } else {
      const table = h('table', {},
        h('tr', {}, h('th', {}, '时间'), h('th', {}, '车型'), h('th', {}, '缺陷'), h('th', {}, 'A区峰值'), h('th', {}, 'B区峰值'), h('th', {}, '判定'), h('th', {}, '')),
      )
      for (const r of records.slice(0, 100)) {
        const time = new Date(r.ts)
        const pad = (n: number) => String(n).padStart(2, '0')
        const ts = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
        const desc = r.defects.map((d) => defectLabel(d)).join('+') || '无'
        table.append(
          h('tr', {},
            h('td', {}, ts),
            h('td', {}, r.vehicleName),
            h('td', {}, desc),
            h('td', {}, r.maxA.toFixed(4)),
            h('td', {}, r.maxB.toFixed(4)),
            h('td', {}, h('span', { class: `badge ${r.verdict === 'pass' ? 'ok' : 'fail'}` }, r.verdict === 'pass' ? '合格' : '超标')),
            h('td', {}, h('button', {
              class: 'danger',
              onclick: async () => {
                await del('batches', r.id)
                records = records.filter((x) => x.id !== r.id)
                rebuild()
              },
            }, '删除')),
          ),
        )
      }
      recCard.append(table)
      recCard.append(
        h('div', { class: 'row', style: 'margin-top:12px' },
          h('button', {
            onclick: () => {
              const header = '时间,车型,缺陷,A区峰值,B区峰值,判定\n'
              const body = records
                .map((r) =>
                  [
                    new Date(r.ts).toISOString(),
                    r.vehicleName,
                    r.defects.map((d) => defectLabel(d)).join('+'),
                    r.maxA.toFixed(4),
                    r.maxB.toFixed(4),
                    r.verdict,
                  ].join(','),
                )
                .join('\n')
              const blob = new Blob(['﻿' + header + body], { type: 'text/csv' })
              const a = h('a', { href: URL.createObjectURL(blob), download: 'batch_records.csv' }) as HTMLAnchorElement
              a.click()
              URL.revokeObjectURL(a.href)
            },
          }, '导出 CSV'),
        ),
      )
    }
    page.append(recCard)

    genBtn.addEventListener('click', async () => {
      const vehicle = vehicles.find((v) => v.id === vehicleSel.value) ?? vehicles[0]
      const glass = glasses.find((g) => g.id === vehicle.glassId)
      if (!glass) return
      genBtn.disabled = true
      const eye: Vec3 = [vehicle.eyePoint.x, vehicle.eyePoint.y, vehicle.eyePoint.z]
      const src = { kind: 'eye', eye } as const
      const nx = 60
      const ny = 40
      for (let b = 0; b < count; b++) {
        const kind = kindSel.value === 'mixed' ? kinds[Math.floor(Math.random() * 3)] : kindSel.value
        const defects: Defect[] = [randomDefect(kind)]
        const g2: GlassSpec = { ...glass, defects }
        const stack = buildGlassStack(g2, settings)
        let maxA = 0
        let maxB = 0
        for (let j = 0; j < ny; j++) {
          const y = -glass.height / 2 + (glass.height * j) / (ny - 1)
          for (let i = 0; i < nx; i++) {
            const x = -glass.width / 2 + (glass.width * i) / (nx - 1)
            const inA = inPolygon(x, y, vehicle.zones.a)
            const inB = inPolygon(x, y, vehicle.zones.b)
            if (!inA && !inB) continue
            const d = diopterAt(stack, src, x, y)
            if (!d) continue
            if (inA) maxA = Math.max(maxA, d.mag)
            if (inB) maxB = Math.max(maxB, d.mag)
          }
        }
        const rec: BatchRecord = {
          id: uid(),
          ts: Date.now() - (count - b) * 60000,
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          defects,
          maxA,
          maxB,
          limitA: settings.limitA,
          limitB: settings.limitB,
          verdict: maxA <= settings.limitA && maxB <= settings.limitB ? 'pass' : 'fail',
        }
        await put('batches', rec)
        records.unshift(rec)
        genProgress.textContent = `生成中 ${b + 1}/${count}`
        await new Promise((r) => setTimeout(r, 0))
      }
      genBtn.disabled = false
      genProgress.textContent = ''
      toast(`已生成 ${count} 条检测记录`)
      rebuild()
    })
  }
  rebuild()
}
