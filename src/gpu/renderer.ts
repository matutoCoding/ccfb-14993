// WebGPU 检测工位渲染器 + CPU 回退
import { Vec3, sub, normalize } from '@/lib/vec'
import { Stack, traceStack } from '@/physics/ray_trace'
import { Board, renderStripeImage } from '@/physics/stripe'
import { sample } from '@/physics/height_field'
import { roadColor } from '@/physics/road'
import { STATION_WGSL } from '@/gpu/wgsl'

export interface ViewParams {
  eye: Vec3
  board: Board
  w: number
  h: number
  mode: 'zebra' | 'road'
}

const UNIFORM_FLOATS = 28

export class GpuView {
  private device: GPUDevice
  private context: GPUCanvasContext
  private pipeline: GPURenderPipeline
  private uniform: GPUBuffer
  private bindGroup: GPUBindGroup | null = null
  private meta = { x0: 0, y0: 0, dx: 1, dy: 1, nx: 0, ny: 0 }

  private constructor(device: GPUDevice, context: GPUCanvasContext, pipeline: GPURenderPipeline, uniform: GPUBuffer) {
    this.device = device
    this.context = context
    this.pipeline = pipeline
    this.uniform = uniform
  }

  static async create(canvas: HTMLCanvasElement): Promise<GpuView | null> {
    if (!navigator.gpu) return null
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) return null
      const device = await adapter.requestDevice()
      const context = canvas.getContext('webgpu')
      if (!context) return null
      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'opaque' })
      const module = device.createShaderModule({ code: STATION_WGSL })
      // 着色器编译错误是异步上报的,主动检查避免静默失败
      const info = await module.getCompilationInfo()
      if (info.messages.some((m) => m.type === 'error')) {
        console.error('WGSL 编译失败', info.messages)
        return null
      }
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      })
      const uniform = device.createBuffer({
        size: UNIFORM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      return new GpuView(device, context, pipeline, uniform)
    } catch {
      return null
    }
  }

  // 打包 4 层高度场到 rgba32float 纹理
  setStack(stack: Stack): void {
    const f0 = stack.fields[0]
    const data = new Float32Array(f0.nx * f0.ny * 4)
    for (let idx = 0; idx < f0.nx * f0.ny; idx++) {
      data[idx * 4] = stack.fields[0].z[idx]
      data[idx * 4 + 1] = stack.fields[1].z[idx]
      data[idx * 4 + 2] = stack.fields[2].z[idx]
      data[idx * 4 + 3] = stack.fields[3].z[idx]
    }
    const tex = this.device.createTexture({
      size: { width: f0.nx, height: f0.ny },
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.device.queue.writeTexture(
      { texture: tex },
      data,
      { bytesPerRow: f0.nx * 16, rowsPerImage: f0.ny },
      { width: f0.nx, height: f0.ny },
    )
    this.meta = { x0: f0.x0, y0: f0.y0, dx: f0.dx, dy: f0.dy, nx: f0.nx, ny: f0.ny }
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: tex.createView() },
      ],
    })
  }

  render(p: ViewParams): void {
    if (!this.bindGroup) return
    const canvas = this.context.canvas as HTMLCanvasElement
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(64, Math.floor(canvas.clientWidth * dpr))
    const h = Math.max(64, Math.floor(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    // 视野:玻璃留 8% 边距,保持纵横比
    const aspect = w / h
    let vy = (p.h / 2) * 1.08
    let vx = vy * aspect
    if (vx < (p.w / 2) * 1.08) {
      vx = (p.w / 2) * 1.08
      vy = vx / aspect
    }
    const u = new Float32Array(UNIFORM_FLOATS)
    u.set([p.eye[0], p.eye[1], p.eye[2], p.mode === 'road' ? 1 : 0], 0)
    u.set([p.board.dist, (p.board.angleDeg * Math.PI) / 180, p.board.period, 0], 4)
    u.set([p.w, p.h, 0, 0], 8)
    u.set([0, 1.52, 1.49, -1.0], 12)
    u.set([this.meta.x0, this.meta.y0, this.meta.dx, this.meta.dy], 16)
    u.set([this.meta.nx, this.meta.ny, w, h], 20)
    u.set([vx, vy, 0, 0], 24)
    this.device.queue.writeBuffer(this.uniform, 0, u)
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.06, g: 0.09, b: 0.16, a: 1 },
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}

// CPU 回退:斑马板用解析抗锯齿渲染,路面逐像素追迹
export const renderCpu = (canvas: HTMLCanvasElement, stack: Stack, p: ViewParams): void => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = 480
  const H = Math.max(60, Math.round((W * p.h) / p.w))
  canvas.width = W
  canvas.height = H
  const out = ctx.createImageData(W, H)
  if (p.mode === 'zebra') {
    const img = renderStripeImage(stack, p.eye, p.board, p.w, p.h, W, H)
    for (let i = 0; i < W * H; i++) {
      const v = Math.round(img[i] * 255)
      out.data[i * 4] = v * 0.96
      out.data[i * 4 + 1] = v * 0.98
      out.data[i * 4 + 2] = v
      out.data[i * 4 + 3] = 255
    }
  } else {
    for (let j = 0; j < H; j++) {
      const gy = -p.h / 2 + (p.h * j) / (H - 1)
      for (let i = 0; i < W; i++) {
        const gx = -p.w / 2 + (p.w * i) / (W - 1)
        const z = sample(stack.base, gx, gy).z
        const target: Vec3 = [gx, gy, z]
        const inc = normalize(sub(target, p.eye))
        const tr = traceStack(stack, p.eye, inc)
        const dir = tr ? tr.dir : inc
        const org = tr ? tr.point : p.eye
        const [r, g, b] = roadColor(org, dir, -1.0)
        const k = (j * W + i) * 4
        out.data[k] = r * 255
        out.data[k + 1] = g * 255
        out.data[k + 2] = b * 255
        out.data[k + 3] = 255
      }
    }
  }
  ctx.putImageData(out, 0, 0)
}
