import AppKit
import ImageIO
import UniformTypeIdentifiers
import JarvisPanelCore

/// `JARVIS_SNAPSHOT=<dir>`: walks the demo through the spec's key states and
/// writes one PNG per state (orb rendered offscreen through the same Metal
/// pipeline, overlay via `cacheDisplay`), then exits. Works with the screen locked.
@MainActor
final class Snapshotter {
  private struct Scene {
    var name: String
    var demo: Int
    var origin: CGPoint
    var hover = false
    var quick = false
    var history = false
    var targets = false
    var escape = false
  }

  private let controller: AppController
  private let demo: DemoAPI
  private let dir: URL

  init(controller: AppController, demo: DemoAPI, dir: URL) {
    self.controller = controller
    self.demo = demo
    self.dir = dir
  }

  func run() async {
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    guard let screen = NSScreen.main else { exit(1) }
    let v = screen.visibleFrame
    let upper = CGPoint(x: v.midX + 120, y: v.midY + 60)
    let lower = CGPoint(x: v.midX + 120, y: v.minY + 200)
    let scenes = [
      Scene(name: "01-idle", demo: 0, origin: upper),
      Scene(name: "02-idle-hover", demo: 0, origin: upper, hover: true),
      Scene(name: "03-thinking", demo: 2, origin: upper),
      Scene(name: "04-speaking-hover", demo: 3, origin: upper, hover: true),
      Scene(name: "05-attention", demo: 4, origin: upper),
      Scene(name: "06-attention-quickbar", demo: 4, origin: upper, quick: true),
      Scene(name: "07-history-lower", demo: 1, origin: lower, quick: true, history: true),
      Scene(name: "08-failed-hover", demo: 5, origin: upper, hover: true),
      Scene(name: "09-dock-right", demo: 4, origin: CGPoint(x: v.maxX - 140, y: v.midY - 70)),
      Scene(name: "10-corner-topright-hover", demo: 0, origin: CGPoint(x: v.maxX - 140, y: v.maxY - 140), hover: true),
      Scene(name: "11-corner-topright-strip", demo: 3, origin: CGPoint(x: v.maxX - 140, y: v.maxY - 140)),
      Scene(name: "12-bottomleft-quickbar", demo: 0, origin: CGPoint(x: v.minX + 40, y: v.minY + 40), quick: true),
      Scene(name: "13-corner-topright-speaking-hover", demo: 3, origin: CGPoint(x: v.maxX - 140, y: v.maxY - 140), hover: true),
      Scene(name: "14-narrating-other-session", demo: 6, origin: upper),
      Scene(name: "15-targets-managed", demo: 0, origin: lower, quick: true, targets: true),
      Scene(name: "16-caption-jarvis", demo: 3, origin: upper),
      Scene(name: "17-caption-session", demo: 6, origin: lower, quick: true, history: true),
      Scene(name: "18-targets-task-state", demo: 7, origin: lower, quick: true, targets: true),
      Scene(name: "19-approval-presets", demo: 8, origin: upper, quick: true),
      Scene(name: "20-auto-approvals", demo: 9, origin: upper, hover: true),
      Scene(name: "21-escape-hint", demo: 0, origin: lower, quick: true, escape: true),
    ]
    let (orb, _, model) = controller.snapshotParts
    for scene in scenes {
      model.closeQuickBar()
      controller.snapshotTargets(false)
      controller.snapshotHover(false)
      await demo.setScene(scene.demo)
      await model.refresh()
      controller.snapshotPlace(scene.origin)
      if scene.hover { controller.snapshotHover(true) }
      if scene.quick {
        await model.setHistoryExpanded(scene.history)
        model.openQuickBar()
        if scene.targets {
          try? await Task.sleep(for: .milliseconds(200))
          controller.snapshotTargets(true)
        }
      }
      try? await Task.sleep(for: .milliseconds(800))
      if scene.escape {
        model.draft = "写了一半的话"
        model.escapePressed()
        try? await Task.sleep(for: .milliseconds(250))
      }
      orb.orbView.advance(seconds: 2.5)
      write(scene.name)
    }
    Log.write("snapshots written to \(dir.path)")
    exit(0)
  }

  /// `JARVIS_TOUR=<dir>`: records a ~16s panel tour as a PNG frame sequence at
  /// 20fps — the same offscreen pipeline as the stills, but advancing the orb
  /// simulation frame by frame while scripting the real UI: the quick bar
  /// expands, a message is typed and sent, the orb thinks and speaks with a
  /// caption, then an approval card arrives and is answered. Assemble the
  /// frames with ffmpeg afterwards; the process exits when done.
  func runTour() async {
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    guard let screen = NSScreen.main else { exit(1) }
    let v = screen.visibleFrame
    let origin = CGPoint(x: v.midX + 60, y: v.midY + 20)
    let (orb, _, model) = controller.snapshotParts
    let fps: Double = 20
    var index = 0

    func frame() async {
      let start = DispatchTime.now()
      // Let the runloop apply pending SwiftUI updates before rasterising.
      try? await Task.sleep(for: .milliseconds(2))
      orb.orbView.advance(seconds: 1.0 / fps)
      write(String(format: "f%04d", index), scale: 1)
      index += 1
      let budget: UInt64 = 50_000_000
      let elapsed = DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds
      if elapsed < budget - 3_000_000 { try? await Task.sleep(nanoseconds: budget - elapsed) }
    }
    func hold(_ seconds: Double) async {
      for _ in 0..<Int(seconds * fps) { await frame() }
    }
    func scene(_ i: Int) async {
      await demo.setScene(i)
      await model.refresh()
    }

    controller.snapshotTargets(false)
    controller.snapshotHover(false)
    controller.snapshotPlace(origin)
    model.closeQuickBar()

    // 1) idle breathing
    await scene(0)
    await hold(1.6)

    // 2) the quick bar expands
    model.openQuickBar()
    await hold(1.1)

    // 3) type a message
    for ch in "总结一下今天的改动" {
      model.draft += String(ch)
      await hold(0.18)
    }
    await hold(0.5)

    // 4) send — the bar folds and a toast confirms
    _ = await model.submit()
    await hold(0.9)

    // 5) thinking
    await scene(2)
    await hold(2.4)

    // 6) speaking with a caption
    await scene(3)
    await hold(3.2)

    // 7) attention: an approval card arrives and is allowed
    await scene(4)
    model.openQuickBar()
    await hold(0.7)
    await hold(2.0)
    if let item = (try? await demo.snapshot())?.pending.first {
      await model.decide(item, allow: true)
    }
    await hold(0.8)

    // 8) back to rest
    model.closeQuickBar()
    await scene(0)
    await hold(1.6)

    Log.write("tour frames written to \(dir.path) (\(index) frames)")
    exit(0)
  }

  private func write(_ name: String) {
    write(name, scale: 2)
  }

  private func write(_ name: String, scale: CGFloat) {
    let (orb, overlay, _) = controller.snapshotParts
    let area = orb.frame.union(overlay.frame).insetBy(dx: -24, dy: -24).integral
    guard let ctx = CGContext(data: nil, width: Int(area.width * scale), height: Int(area.height * scale),
                              bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
    ctx.scaleBy(x: scale, y: scale)
    let bg = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [
      CGColor(srgbRed: 0.20, green: 0.24, blue: 0.32, alpha: 1),
      CGColor(srgbRed: 0.09, green: 0.11, blue: 0.16, alpha: 1),
    ] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: area.height), end: CGPoint(x: area.width, y: 0), options: [])

    func local(_ f: CGRect) -> CGRect {
      CGRect(x: f.minX - area.minX, y: f.minY - area.minY, width: f.width, height: f.height)
    }
    if let img = orb.orbView.snapshot(scale: scale) { ctx.draw(img, in: local(orb.frame)) }
    if let img = bitmap(orb.badgeView) { ctx.draw(img, in: local(orb.frame)) }
    if let content = overlay.contentView, let img = bitmap(content) { ctx.draw(img, in: local(overlay.frame)) }

    guard let image = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(dir.appendingPathComponent("\(name).png") as CFURL,
                                                     UTType.png.identifier as CFString, 1, nil) else { return }
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
  }

  private func bitmap(_ view: NSView) -> CGImage? {
    view.layoutSubtreeIfNeeded()
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
    view.cacheDisplay(in: view.bounds, to: rep)
    return rep.cgImage
  }
}
