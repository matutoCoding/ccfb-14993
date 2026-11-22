// 应用外壳:侧边导航 + 哈希路由
import { h, icon } from '@/lib/dom'
import { renderVehicles } from '@/pages/vehicles_page'
import { renderSurface } from '@/pages/surface_page'
import { renderStation } from '@/pages/station_page'
import { renderAnalysis } from '@/pages/analysis_page'
import { renderBatches } from '@/pages/batches_page'
import { renderSettings } from '@/pages/settings_page'

const NAV = [
  { hash: '#/vehicles', label: '车型档案', d: 'M4 12l1.6-4.2A2 2 0 0 1 7.5 6.5h9a2 2 0 0 1 1.9 1.3L20 12m-16 0h16a1 1 0 0 1 1 1v4h-3m-14 0H3v-4a1 1 0 0 1 1-1zm3 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
  { hash: '#/surface', label: '玻璃曲面', d: 'M3 8c3-2 6 2 9 0s6 2 9 0M3 13c3-2 6 2 9 0s6 2 9 0M3 18c3-2 6 2 9 0s6 2 9 0' },
  { hash: '#/station', label: '检测工位', d: 'M4 5h16v11H4zM9 20h6M12 16v4' },
  { hash: '#/analysis', label: '畸变分析', d: 'M4 20V4m0 16h16M7 15l4-5 3 3 4-6' },
  { hash: '#/batches', label: '批次记录', d: 'M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01' },
  { hash: '#/settings', label: '设置', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1m0-14.2-2.1 2.1m-10 10-2.1 2.1' },
]

const PAGES: Record<string, (root: HTMLElement) => void | Promise<void>> = {
  '#/vehicles': renderVehicles,
  '#/surface': renderSurface,
  '#/station': renderStation,
  '#/analysis': renderAnalysis,
  '#/batches': renderBatches,
  '#/settings': renderSettings,
}

export const mountApp = (el: HTMLElement): void => {
  const main = h('div', { class: 'main' })
  const nav = h(
    'div',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, '挡风玻璃光学检测', h('small', {}, '畸变仿真与判定系统')),
    ...NAV.map((n) =>
      h('a', { class: 'nav-item', href: n.hash, 'data-hash': n.hash }, icon(n.d), n.label),
    ),
  )
  el.append(h('div', { class: 'app' }, nav, main))

  const route = async () => {
    const hash = PAGES[location.hash] ? location.hash : '#/vehicles'
    for (const a of nav.querySelectorAll('.nav-item')) {
      a.classList.toggle('active', a.getAttribute('data-hash') === hash)
    }
    main.textContent = ''
    await PAGES[hash](main)
  }
  window.addEventListener('hashchange', route)
  void route()
}
