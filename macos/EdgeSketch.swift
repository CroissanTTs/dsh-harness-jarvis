import AppKit
import SwiftUI

// Throwaway sketch: 3 FLAT corner styles for the bottom-left corner (the orb
// against TWO walls). Pick the look; it applies to all 4 corners.

enum CornerStyle: String, CaseIterable {
  case roundedSquare = "扁圆角方块(贴两边)"
  case lShape = "L 形扁条(包住角)"
  case diagonal = "对角扁胶囊(45°)"
}

struct CornerShapeView: View {
  let style: CornerStyle
  let color: Color
  let d: CGFloat = 44
  var body: some View {
    Canvas { ctx, size in
      let box = CGRect(x: (size.width - 90) / 2, y: (size.height - 70) / 2, width: 90, height: 70)
      // walls: left + bottom of the box (the corner)
      ctx.fill(Path(CGRect(x: box.minX - 1, y: box.minY, width: 2, height: box.height)), with: .color(.gray.opacity(0.4)))
      ctx.fill(Path(CGRect(x: box.minX, y: box.maxY - 1, width: box.width, height: 2)), with: .color(.gray.opacity(0.4)))
      for p in paths(style, box) { ctx.fill(p, with: .color(color.opacity(0.92))) }
    }
    .frame(width: 120, height: 88)
  }

  /// Manual uneven-rounded-rect: round only the specified corners (tl=top-left,
  /// tr=top-right, bl=bottom-left, br=bottom-right); 0 = flat. Used for the L
  /// arms (flat tips + rounded elbow) since UnevenRoundedRectangle/CornerRadii
  /// isn't exported in this SDK.
  private func unevenRoundedRect(_ r: CGRect, tl: CGFloat, tr: CGFloat, bl: CGFloat, br: CGFloat) -> Path {
    var p = Path()
    let (x, y, w, h) = (r.minX, r.minY, r.width, r.height)
    p.move(to: .init(x: x + tl, y: y))
    p.addLine(to: .init(x: x + w - tr, y: y))
    if tr > 0 { p.addArc(center: .init(x: x + w - tr, y: y + tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false) }
    p.addLine(to: .init(x: x + w, y: y + h - br))
    if br > 0 { p.addArc(center: .init(x: x + w - br, y: y + h - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false) }
    p.addLine(to: .init(x: x + bl, y: y + h))
    if bl > 0 { p.addArc(center: .init(x: x + bl, y: y + h - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false) }
    p.addLine(to: .init(x: x, y: y + tl))
    if tl > 0 { p.addArc(center: .init(x: x + tl, y: y + tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false) }
    p.closeSubpath()
    return p
  }

  /// An L-arm with ROUNDED trapezoid tips (both tip corners filleted with a
  /// quarter-circle so the tip narrows via CURVES, not straight chamfers —
  /// "圆润") + a ROUNDED elbow. tipTop=true → vertical arm (tip top, elbow
  /// bottom); tipTop=false → horizontal arm (tip right, elbow left).
  private func trapezoidTipArm(_ r: CGRect, tipTop: Bool, cham: CGFloat, cr: CGFloat) -> Path {
    let (x, y, w, h) = (r.minX, r.minY, r.width, r.height)
    var p = Path()
    if tipTop {
      p.move(to: .init(x: x + cham, y: y))                     // tip-left (after TL fillet)
      p.addLine(to: .init(x: x + w - cham, y: y))              // tip edge (narrower)
      p.addArc(center: .init(x: x + w - cham, y: y + cham), radius: cham, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false) // TR fillet (curve)
      p.addLine(to: .init(x: x + w, y: y + h - cr))
      p.addArc(center: .init(x: x + w - cr, y: y + h - cr), radius: cr, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false) // BR elbow round
      p.addLine(to: .init(x: x + cr, y: y + h))
      p.addArc(center: .init(x: x + cr, y: y + h - cr), radius: cr, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false) // BL elbow round
      p.addLine(to: .init(x: x, y: y + cham))
      p.addArc(center: .init(x: x + cham, y: y + cham), radius: cham, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false) // TL fillet (curve)
      p.closeSubpath()
    } else {
      p.move(to: .init(x: x + cr, y: y))
      p.addLine(to: .init(x: x + w - cham, y: y))
      p.addArc(center: .init(x: x + w - cham, y: y + cham), radius: cham, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false) // TR fillet
      p.addLine(to: .init(x: x + w, y: y + h - cham))           // narrow tip edge
      p.addArc(center: .init(x: x + w - cham, y: y + h - cham), radius: cham, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false) // BR fillet
      p.addLine(to: .init(x: x + cr, y: y + h))
      p.addArc(center: .init(x: x + cr, y: y + h - cr), radius: cr, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false) // BL elbow
      p.addLine(to: .init(x: x, y: y + cr))
      p.addArc(center: .init(x: x + cr, y: y + cr), radius: cr, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false) // TL elbow
      p.closeSubpath()
    }
    return p
  }

  private func paths(_ s: CornerStyle, _ b: CGRect) -> [Path] {
    let wallX = b.minX, wallY = b.maxY
    let cap = d * 0.4   // capsule thickness
    switch s {
    case .roundedSquare:
      let sz = d * 0.62
      let r = CGRect(x: wallX, y: wallY - sz, width: sz, height: sz)
      return [RoundedRectangle(cornerRadius: sz * 0.3).path(in: r)]
    case .lShape:
      // L arms with ROUNDED fillet tips + rounded elbow. Thinner + shorter
      // (cap = d*0.3, arm length = d*0.8) per request.
      let lCap = d * 0.22
      let lLen = d * 0.75
      let cham = lCap * 0.4
      let cr = lCap * 0.5
      let v = CGRect(x: wallX, y: wallY - lLen, width: lCap, height: lLen)
      let h = CGRect(x: wallX, y: wallY - lCap, width: lLen, height: lCap)
      return [trapezoidTipArm(v, tipTop: true, cham: cham, cr: cr),
              trapezoidTipArm(h, tipTop: false, cham: cham, cr: cr)]
    case .diagonal:
      // a capsule rotated 45° pointing into the corner (toward top-right)
      let len = d * 0.9
      let r = CGRect(x: -len / 2, y: -cap / 2, width: len, height: cap)
      let capsule = RoundedRectangle(cornerRadius: cap / 2).path(in: r)
      var p = Path()
      var tr = CGAffineTransform(translationX: wallX + d * 0.45, y: wallY - d * 0.45)
      p.addPath(capsule, transform: tr.rotated(by: .pi / 4))
      return [p]
    }
  }
}

struct CornerSketch: View {
  let color = Color(red: 0.42, green: 0.45, blue: 0.95)
  var body: some View {
    VStack(spacing: 14) {
      Text("四角扁平风格（挑一个）").font(.headline)
      VStack(spacing: 10) {
        ForEach(CornerStyle.allCases, id: \.self) { s in
          VStack(spacing: 3) {
            CornerShapeView(style: s, color: color)
            Text(s.rawValue).font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      Text("灰线=屏幕边(左+底);球贴在角的扁平形状。边已定=扁圆角条").font(.caption2).foregroundStyle(.tertiary)
    }
    .padding(24)
    .frame(width: 300, height: 360)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
  }
}

@main
enum CornerSketchMain {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let del = CornerDelegate()
    app.delegate = del
    app.run()
  }
}
@MainActor
final class CornerDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ n: Notification) {
    let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 380),
                       styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    win.contentView = NSHostingView(rootView: CornerSketch())
    win.center()
    win.makeKeyAndOrderFront(nil)
    NSApplication.shared.activate(ignoringOtherApps: true)
  }
}
