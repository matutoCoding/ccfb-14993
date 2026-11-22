// DOM 构建小工具
type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>

export const h = (
  tag: string,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElement => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick' && typeof v === 'function') el.addEventListener('click', v as EventListener)
    else if (k === 'oninput' && typeof v === 'function') el.addEventListener('input', v as EventListener)
    else if (k === 'onchange' && typeof v === 'function') el.addEventListener('change', v as EventListener)
    else el.setAttribute(k, String(v))
  }
  for (const c of children) {
    if (c === null || c === undefined) continue
    el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return el
}

export const icon = (path: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  svg.append(p)
  return svg
}

export const fmt = (n: number, digits = 4): string => n.toFixed(digits)

export const toast = (msg: string): void => {
  const el = h('div', { class: 'toast' }, msg)
  document.body.append(el)
  setTimeout(() => el.remove(), 2400)
}

// 数字输入框,值变化回调(米制内部,可指定显示缩放)
export const numField = (
  label: string,
  value: number,
  onChange: (v: number) => void,
  step = 0.001,
): HTMLElement => {
  const input = h('input', { type: 'number', value: String(value), step: String(step) }) as HTMLInputElement
  input.addEventListener('change', () => {
    const v = parseFloat(input.value)
    if (!Number.isNaN(v)) onChange(v)
  })
  return h('label', { class: 'field' }, label, input)
}
