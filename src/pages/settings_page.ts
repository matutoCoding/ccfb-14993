// 设置:折射率 / 限值 / 计算分辨率 / 数据管理
import { h, numField, toast } from '@/lib/dom'
import { getAll, put, exportAll, importAll, clear } from '@/db/database'
import { AppSettings, defaultSettings } from '@/db/models'
import { seedIfEmpty } from '@/db/seed'

export const renderSettings = async (root: HTMLElement): Promise<void> => {
  const settings = (await getAll<AppSettings>('settings'))[0] ?? defaultSettings()

  root.append(
    h('div', { class: 'page-head' },
      h('h1', {}, '设置'),
      h('p', {}, '光学参数、判定限值与计算分辨率;数据导入导出'),
    ),
  )

  const card = h('div', { class: 'card' }, h('h2', {}, '光学与判定参数'))
  card.append(
    h('div', { class: 'row' },
      numField('玻璃折射率', settings.nGlass, (v) => (settings.nGlass = v), 0.001),
      numField('PVB 折射率', settings.nPvb, (v) => (settings.nPvb = v), 0.001),
      numField('A区屈光度限值 (dpt)', settings.limitA, (v) => (settings.limitA = v), 0.01),
      numField('B区屈光度限值 (dpt)', settings.limitB, (v) => (settings.limitB = v), 0.01),
    ),
    h('div', { class: 'row', style: 'margin-top:12px' },
      numField('畸变图横向采样', settings.mapNx, (v) => (settings.mapNx = Math.round(v)), 10),
      numField('畸变图纵向采样', settings.mapNy, (v) => (settings.mapNy = Math.round(v)), 10),
      numField('高度场分辨率', settings.fieldN, (v) => (settings.fieldN = Math.round(v)), 50),
    ),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', {
        class: 'primary',
        onclick: async () => {
          await put('settings', JSON.parse(JSON.stringify(settings)) as AppSettings)
          toast('设置已保存')
        },
      }, '保存设置'),
    ),
  )
  root.append(card)

  const dataCard = h('div', { class: 'card' }, h('h2', {}, '数据管理'))
  const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none' }) as HTMLInputElement
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown[]>
      await importAll(data)
      toast('导入完成,刷新后生效')
    } catch {
      toast('导入失败:文件格式错误')
    }
  })
  dataCard.append(
    h('div', { class: 'row' },
      h('button', {
        onclick: async () => {
          const data = await exportAll()
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const a = h('a', { href: URL.createObjectURL(blob), download: 'windshield_optics_backup.json' }) as HTMLAnchorElement
          a.click()
          URL.revokeObjectURL(a.href)
        },
      }, '导出全部数据 (JSON)'),
      h('button', { onclick: () => fileInput.click() }, '导入数据'),
      h('button', {
        class: 'danger',
        onclick: async () => {
          for (const s of ['vehicles', 'glasses', 'stations', 'batches', 'settings'] as const) await clear(s)
          await seedIfEmpty()
          toast('已清空并恢复出厂数据')
        },
      }, '清空并恢复出厂数据'),
      fileInput,
    ),
  )
  root.append(dataCard)

  const about = h('div', { class: 'card' }, h('h2', {}, '精度说明'))
  about.append(
    h('p', { class: 'hint' },
      '屈光度由双层玻璃+PVB 四层界面光线追迹计算,与近轴光学 ABCD 矩阵解析解对照误差 < 0.01 dpt(自动化测试保证)。',
    ),
    h('p', { class: 'hint' },
      '条纹反推采用斑马板跳变沿亚像素定位 + 无玻璃参考模型配对,与直接计算的 RMS 偏差 < 0.01 dpt。',
    ),
  )
  root.append(about)
}
