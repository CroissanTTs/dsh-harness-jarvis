import AppKit
import MetalKit
import QuartzCore
import JarvisPanelCore

/// Metal renderer for the particle orb (spec §2). Shaders are compiled from
/// source at runtime so SwiftPM needs no `.metal` build step.
final class OrbMetalView: MTKView, MTKViewDelegate {
  private static let shaderSource = """
  #include <metal_stdlib>
  using namespace metal;

  struct Sprite { float2 pos; float size; float alpha; };
  struct Uniforms { float4 color; float scale; float underlay; float2 pad; };
  struct VOut { float4 pos [[position]]; float2 uv; float alpha; };

  constant float2 corners[4] = { float2(-1, -1), float2(1, -1), float2(-1, 1), float2(1, 1) };

  vertex VOut particleVertex(uint vid [[vertex_id]], uint iid [[instance_id]],
                             const device Sprite *sprites [[buffer(0)]],
                             constant Uniforms &u [[buffer(1)]]) {
    Sprite s = sprites[iid];
    float2 c = corners[vid];
    VOut o;
    o.pos = float4((s.pos + c * s.size * 0.5) * u.scale, 0, 1);
    o.uv = c;
    o.alpha = s.alpha;
    return o;
  }

  fragment float4 particleFragment(VOut in [[stage_in]], constant Uniforms &u [[buffer(1)]]) {
    float d = length(in.uv);
    if (d >= 1) discard_fragment();
    float3 rgb;
    float a;
    if (d < 0.16) {
      float f = d / 0.16;
      rgb = mix(float3(1), u.color.rgb, f);
      a = 1;
    } else if (d < 0.34) {
      rgb = u.color.rgb;
      a = mix(1.0, 0.35, (d - 0.16) / 0.18);
    } else {
      rgb = u.color.rgb;
      a = mix(0.35, 0.0, (d - 0.34) / 0.66);
    }
    a *= in.alpha;
    return float4(rgb * a, a);
  }

  vertex VOut underlayVertex(uint vid [[vertex_id]], constant Uniforms &u [[buffer(1)]]) {
    float2 c = corners[vid];
    VOut o;
    o.pos = float4(c * 1.08 * u.scale, 0, 1);
    o.uv = c;
    o.alpha = u.underlay;
    return o;
  }

  fragment float4 underlayFragment(VOut in [[stage_in]]) {
    float d = length(in.uv);
    if (d >= 1) discard_fragment();
    float a = 0.55 * (1 - d) * in.alpha;
    return float4(float3(4, 8, 18) / 255.0 * a, a);
  }
  """

  private struct Uniforms {
    var color: SIMD4<Float>
    var scale: Float
    var underlay: Float
    var pad: SIMD2<Float> = .zero
  }

  private var queue: MTLCommandQueue?
  private var particlePipeline: MTLRenderPipelineState?
  private var underlayPipeline: MTLRenderPipelineState?
  private var instanceBuffer: MTLBuffer?

  private(set) var sim: ParticleSim
  private var sprites: [PointSprite] = []
  private let start = CACurrentMediaTime()
  private var last: Double = 0

  private var fromColor = OrbTint.cyan.simd
  private var toColor = OrbTint.cyan.simd
  private var colorStart: Double = -10
  private var underlay: Float = 1

  var rendering = true {
    didSet { updatePacing() }
  }

  init(frame: CGRect, count: Int) {
    sim = ParticleSim(count: count, seed: UInt64(Date().timeIntervalSince1970))
    let device = MTLCreateSystemDefaultDevice()
    super.init(frame: frame, device: device)
    layer?.isOpaque = false
    clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    colorPixelFormat = .bgra8Unorm
    framebufferOnly = true
    delegate = self
    buildPipelines()
    updatePacing()
  }

  @available(*, unavailable)
  required init(coder: NSCoder) { fatalError() }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// `nextDrawable` blocks the main thread for up to 1s while the window can't
  /// be shown (occluded, mid space switch, display asleep), so drawing stops then.
  private var onScreen = true
  private var occlusionToken: NSObjectProtocol?

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let occlusionToken { NotificationCenter.default.removeObserver(occlusionToken) }
    occlusionToken = nil
    guard let window else { return }
    occlusionToken = NotificationCenter.default.addObserver(
      forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, let window = self.window else { return }
        self.onScreen = window.occlusionState.contains(.visible)
        self.updatePacing()
      }
    }
    onScreen = window.occlusionState.contains(.visible)
    updatePacing()
  }

  /// Simulated time added by `advance(seconds:)` for offscreen snapshots.
  private var virtualOffset: Double = 0
  private var now: Double { CACurrentMediaTime() - start + virtualOffset }

  private func buildPipelines() {
    guard let device else { return }
    queue = device.makeCommandQueue()
    do {
      let library = try device.makeLibrary(source: Self.shaderSource, options: nil)
      func pipeline(_ v: String, _ f: String, additive: Bool) throws -> MTLRenderPipelineState {
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = library.makeFunction(name: v)
        d.fragmentFunction = library.makeFunction(name: f)
        let att = d.colorAttachments[0]!
        att.pixelFormat = colorPixelFormat
        att.isBlendingEnabled = true
        att.rgbBlendOperation = .add
        att.alphaBlendOperation = .add
        att.sourceRGBBlendFactor = .one
        att.sourceAlphaBlendFactor = .one
        att.destinationRGBBlendFactor = additive ? .one : .oneMinusSourceAlpha
        att.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        return try device.makeRenderPipelineState(descriptor: d)
      }
      particlePipeline = try pipeline("particleVertex", "particleFragment", additive: true)
      underlayPipeline = try pipeline("underlayVertex", "underlayFragment", additive: false)
    } catch {
      Log.write("metal pipeline failed: \(error)")
    }
  }

  // MARK: Control

  func apply(motion: OrbMotion, tint: OrbTint) {
    if motion != sim.motion {
      sim.setMotion(motion, t: now)
      beginTransition()
    }
    let target = tint.simd
    if target != toColor {
      fromColor = currentColor()
      toColor = target
      colorStart = now
      beginTransition()
    }
    updatePacing()
  }

  func setDock(_ edge: DockEdge?) {
    guard edge != sim.dock else { return }
    sim.setDock(edge, t: now)
    beginTransition()
  }

  func setCount(_ n: Int) {
    guard n != sim.count else { return }
    sim.setCount(n, t: now)
    beginTransition()
  }

  private var transitionUntil: Double = -1
  private var transitioning = false

  private func beginTransition() {
    transitionUntil = now + FramePacing.transitionSeconds
    updatePacing()
  }

  func setReduceMotion(_ on: Bool) {
    guard sim.reduceMotion != on else { return }
    sim.reduceMotion = on
    sim.setMotion(sim.motion, t: now)
  }

  private func currentColor() -> SIMD4<Float> {
    let f = Float(ColorFade.progress(elapsed: now - colorStart))
    return fromColor + (toColor - fromColor) * f
  }

  private func updatePacing() {
    isPaused = !rendering || !onScreen
    transitioning = now < transitionUntil
    let fps = FramePacing.fps(docked: sim.dock != nil, motion: sim.motion, transitioning: transitioning)
    if preferredFramesPerSecond != fps { preferredFramesPerSecond = fps }
  }

  // MARK: MTKViewDelegate

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    tick()
    guard let queue, let pass = currentRenderPassDescriptor, let drawable = currentDrawable,
          let cmd = queue.makeCommandBuffer() else { return }
    encode(cmd, pass)
    cmd.present(drawable)
    cmd.commit()
  }

  private func tick() {
    let t = now
    let dt = min(max(t - last, 0), 1.0 / 20)
    last = t
    sim.step(t: t, dt: dt)
    sim.sprites(t: t, into: &sprites)
    underlay += ((sim.dock == nil ? 1 : 0) - underlay) * Float(min(1, dt * 8))
    if transitioning && t >= transitionUntil { updatePacing() }
  }

  /// Steps the simulation through `seconds` of virtual time at 60 fps.
  func advance(seconds: Double) {
    for _ in 0..<Int(seconds * 60) {
      virtualOffset += 1.0 / 60
      tick()
    }
  }

  /// Renders the current frame offscreen, for `JARVIS_SNAPSHOT`.
  func snapshot(scale: CGFloat) -> CGImage? {
    guard let device, let queue, let cmd = queue.makeCommandBuffer() else { return nil }
    let px = Int(bounds.width * scale)
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: colorPixelFormat, width: px, height: px,
                                                        mipmapped: false)
    desc.usage = [.renderTarget, .shaderRead]
    desc.storageMode = device.hasUnifiedMemory ? .shared : .managed
    guard let texture = device.makeTexture(descriptor: desc) else { return nil }
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = clearColor
    encode(cmd, pass)
    if desc.storageMode == .managed, let blit = cmd.makeBlitCommandEncoder() {
      blit.synchronize(resource: texture)
      blit.endEncoding()
    }
    cmd.commit()
    cmd.waitUntilCompleted()
    var bytes = [UInt8](repeating: 0, count: px * px * 4)
    texture.getBytes(&bytes, bytesPerRow: px * 4, from: MTLRegionMake2D(0, 0, px, px), mipmapLevel: 0)
    let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
    return CGImage(width: px, height: px, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: px * 4,
                   space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info, provider: provider,
                   decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  }

  private func encode(_ cmd: MTLCommandBuffer, _ pass: MTLRenderPassDescriptor) {
    guard let device, let particlePipeline, let underlayPipeline,
          let enc = cmd.makeRenderCommandEncoder(descriptor: pass) else { return }

    let bytes = max(1, sprites.count) * MemoryLayout<PointSprite>.stride
    if instanceBuffer == nil || instanceBuffer!.length < bytes {
      instanceBuffer = device.makeBuffer(length: bytes * 2, options: .storageModeShared)
    }
    guard let instanceBuffer else {
      enc.endEncoding()
      return
    }
    sprites.withUnsafeBytes { raw in
      if let base = raw.baseAddress { instanceBuffer.contents().copyMemory(from: base, byteCount: raw.count) }
    }

    var u = Uniforms(color: currentColor(), scale: Float(1 / ParticleSim.windowHalf), underlay: underlay)
    enc.setVertexBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
    enc.setFragmentBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 1)
    if underlay > 0.01 {
      enc.setRenderPipelineState(underlayPipeline)
      enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    }
    if !sprites.isEmpty {
      enc.setRenderPipelineState(particlePipeline)
      enc.setVertexBuffer(instanceBuffer, offset: 0, index: 0)
      enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: sprites.count)
    }
    enc.endEncoding()
  }
}

extension OrbTint {
  var simd: SIMD4<Float> {
    let c = rgb
    return SIMD4(Float(c.r), Float(c.g), Float(c.b), 1)
  }

  var color: NSColor {
    let c = rgb
    return NSColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
  }
}
