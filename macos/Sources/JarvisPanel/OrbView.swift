import SwiftUI

enum OrbState: Equatable {
  case idle, speaking, needsAction, error
}

enum EdgeState: Equatable {
  case none, left, right, top, bottom, topLeft, topRight, bottomLeft, bottomRight, inCamera
}

/// Siri-style orb that MELTS into screen edges when snapped there. Collapsed
/// floating = full circle (with highlight). At an edge = 扁圆角条 (capsule tab,
/// flat against the wall, no highlight). At a corner = L 形扁条 (two arms with
/// rounded fillet tips + rounded elbow). At the top camera/notch zone = full
/// circle (no melt — the orb must stay complete there).
struct OrbView: View {
  let state: OrbState
  var edge: EdgeState = .none
  private let d: CGFloat = 44

  var body: some View {
    TimelineView(.animation) { ctx in
      let t = ctx.date.timeIntervalSinceReferenceDate
      let scale = scaleAt(t)
      Canvas { c, size in
        let r = CGRect(x: (size.width - d) / 2, y: (size.height - d) / 2, width: d, height: d)
        c.clip(to: Path(r))  // clip to the orb's visual bounds
        for path in edgePaths(edge, r) {
          c.fill(path, with: .color(color.opacity(0.92)))
        }
        // Highlight ONLY on the full orb (removed when melted into an edge/corner).
        if edge == .none || edge == .inCamera {
          let h = CGRect(x: r.midX - 7, y: r.midY - 7, width: 7, height: 7)
          c.fill(Path(ellipseIn: h), with: .color(.white.opacity(0.85)))
        }
      }
      .scaleEffect(scale)
    }
    .frame(width: 96, height: 96)
  }

  // ── shape paths per edge state ──────────────────────────────────────────

  private func edgePaths(_ e: EdgeState, _ r: CGRect) -> [Path] {
    let cap = d * 0.22   // capsule/L-arm thickness (thin, per sketch tuning)
    let len = d * 0.75   // arm length
    let cham = cap * 0.4 // fillet radius (rounded tip)
    let cr = cap * 0.5   // elbow radius
    switch e {
    case .none, .inCamera:
      return [Path(ellipseIn: r)]  // full circle
    case .left:
      return [RoundedRectangle(cornerRadius: cap / 2).path(in: CGRect(x: r.minX, y: r.midY - d / 2, width: cap, height: d))]
    case .right:
      return [RoundedRectangle(cornerRadius: cap / 2).path(in: CGRect(x: r.maxX - cap, y: r.midY - d / 2, width: cap, height: d))]
    case .top:
      return [RoundedRectangle(cornerRadius: cap / 2).path(in: CGRect(x: r.midX - d / 2, y: r.minY, width: d, height: cap))]
    case .bottom:
      return [RoundedRectangle(cornerRadius: cap / 2).path(in: CGRect(x: r.midX - d / 2, y: r.maxY - cap, width: d, height: cap))]
    case .topLeft:
      let v = CGRect(x: r.minX, y: r.minY, width: cap, height: len)              // arm down
      let h = CGRect(x: r.minX, y: r.minY, width: len, height: cap)              // arm right
      return [unevenRoundedRect(v, tl: cr, tr: cr, bl: cr, br: cr),
              unevenRoundedRect(h, tl: cr, tr: cr, bl: cr, br: cr)]
    case .topRight:
      let v = CGRect(x: r.maxX - cap, y: r.minY, width: cap, height: len)        // arm down
      let h = CGRect(x: r.maxX - len, y: r.minY, width: len, height: cap)        // arm left
      return [unevenRoundedRect(v, tl: cr, tr: cr, bl: cr, br: cr),
              unevenRoundedRect(h, tl: cr, tr: cr, bl: cr, br: cr)]
    case .bottomLeft:
      let v = CGRect(x: r.minX, y: r.maxY - len, width: cap, height: len)       // arm up
      let h = CGRect(x: r.minX, y: r.maxY - cap, width: len, height: cap)        // arm right
      return [unevenRoundedRect(v, tl: cr, tr: cr, bl: cr, br: cr),
              unevenRoundedRect(h, tl: cr, tr: cr, bl: cr, br: cr)]
    case .bottomRight:
      let v = CGRect(x: r.maxX - cap, y: r.maxY - len, width: cap, height: len)  // arm up
      let h = CGRect(x: r.maxX - len, y: r.maxY - cap, width: len, height: cap)   // arm left
      return [unevenRoundedRect(v, tl: cr, tr: cr, bl: cr, br: cr),
              unevenRoundedRect(h, tl: cr, tr: cr, bl: cr, br: cr)]
    }
  }

  /// Manual uneven-rounded-rect: round only the specified corners (tl=top-left,
  /// tr=top-right, bl=bottom-left, br=bottom-right); 0 = flat. Used for the L
  /// arms (all corners rounded = capsule) + edge capsules.
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

  // ── color + pulse ─────────────────────────────────────────────────────────

  private func scaleAt(_ t: Double) -> CGFloat {
    switch state {
    case .idle: return CGFloat(1.0 + 0.05 * sin(t * 1.6))
    case .speaking:
      let carrier = 0.5 + 0.5 * sin(t * 13.0)
      let swell = 0.5 + 0.5 * sin(t * 2.2)
      return CGFloat(1.0 + 0.13 * carrier + 0.10 * swell)
    case .needsAction: return CGFloat(1.0 + 0.06 * sin(t * 6.0))
    case .error: return CGFloat(1.0 + 0.04 * sin(t * 18.0))
    }
  }

  private var color: Color {
    switch state {
    case .idle: return Color(red: 0.42, green: 0.45, blue: 0.95)
    case .speaking: return Color(red: 0.30, green: 0.62, blue: 1.0)
    case .needsAction: return Color(red: 0.98, green: 0.74, blue: 0.18)
    case .error: return Color(red: 0.95, green: 0.32, blue: 0.32)
    }
  }
}
