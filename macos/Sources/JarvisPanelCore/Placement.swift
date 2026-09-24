import CoreGraphics
import Foundation

public enum HSide: Equatable, Sendable {
  case left, right
}

public enum ReadoutPlacement: Equatable, Sendable {
  case list(CGRect)
  case capsule(CGRect)
  case none
}

public struct HoverLayout: Equatable, Sendable {
  /// Side of the orb the buttons open toward (the screen interior).
  public var side: HSide
  /// Button centers, top to bottom.
  public var buttons: [CGPoint]
  public var readout: ReadoutPlacement
  public var badge: CGPoint
}

public struct QuickBarLayout: Equatable, Sendable {
  public var side: HSide
  public var bar: CGRect
  /// Pending cards and history stack upward from the bar (else downward).
  public var growsUp: Bool
  /// Space left for the stack in its growth direction.
  public var stackLimit: CGFloat
}

/// Where the orb may sit: the screen below the menu bar, with the Dock's own
/// footprint as an obstacle. `visibleFrame` removes the Dock's whole edge, which
/// keeps the orb out of the corners beside a side Dock.
public struct Workspace: Equatable, Sendable {
  public var bounds: CGRect
  public var dock: CGRect?

  public init(bounds: CGRect, dock: CGRect?) {
    self.bounds = bounds
    self.dock = dock
  }

  /// `dockLength` is the Dock's extent along its edge (centered on the screen);
  /// nil treats the whole edge as occupied.
  public static func make(screen: CGRect, visible: CGRect, dockLength: CGFloat?) -> Workspace {
    let bounds = CGRect(x: screen.minX, y: screen.minY, width: screen.width, height: visible.maxY - screen.minY)
    let right = screen.maxX - visible.maxX
    let left = visible.minX - screen.minX
    let bottom = visible.minY - screen.minY
    func span(center: CGFloat, lower: CGFloat, upper: CGFloat) -> (CGFloat, CGFloat) {
      guard let dockLength else { return (lower, upper) }
      return (max(lower, center - dockLength / 2), min(upper, center + dockLength / 2))
    }
    var dock: CGRect?
    if right > 1 || left > 1 {
      let (y0, y1) = span(center: screen.midY, lower: bounds.minY, upper: bounds.maxY)
      let x = right > 1 ? visible.maxX : screen.minX
      dock = CGRect(x: x, y: y0, width: max(right, left), height: y1 - y0)
    } else if bottom > 1 {
      let (x0, x1) = span(center: screen.midX, lower: bounds.minX, upper: bounds.maxX)
      dock = CGRect(x: x0, y: screen.minY, width: x1 - x0, height: bottom)
    }
    return Workspace(bounds: bounds, dock: dock)
  }

  fileprivate enum Side { case left, right, bottom }

  fileprivate var dockSide: Side? {
    guard let dock else { return nil }
    if dock.height > dock.width { return dock.midX > bounds.midX ? .right : .left }
    return .bottom
  }
}

/// Pure geometry for snapping and the hover/quick-bar layouts (spec §4, §5.3,
/// §6). All rects are AppKit screen coordinates (y up).
public enum Placement {
  public static let orbWindow: CGFloat = 140
  public static let orbRadius: CGFloat = 60
  /// Measured from the window edge, which sits 10pt outside the visible orb.
  /// Dragging clamps the window to the edge, so pushing into it always docks.
  public static let snapDistance: CGFloat = 10
  public static let dragThreshold: CGFloat = 4
  public static let buttonRadius: CGFloat = 88
  public static let buttonSize: CGFloat = 30
  public static let buttonSpacingDegrees: CGFloat = 30
  public static let readoutGap: CGFloat = 58
  public static let capsuleGap: CGFloat = 8
  public static let capsuleInset: CGFloat = 56
  public static let barGap: CGFloat = 12
  public static let screenMargin: CGFloat = 4

  public static func clampOrigin(frame: CGRect, visible: CGRect) -> CGPoint {
    CGPoint(x: min(max(frame.minX, visible.minX), visible.maxX - frame.width),
            y: min(max(frame.minY, visible.minY), visible.maxY - frame.height))
  }

  /// Keeps the frame inside the workspace and off the Dock.
  public static func clampOrigin(frame: CGRect, workspace ws: Workspace) -> CGPoint {
    var o = clampOrigin(frame: frame, visible: ws.bounds)
    guard let dock = ws.dock, let side = ws.dockSide else { return o }
    let f = CGRect(origin: o, size: frame.size)
    guard f.minX < dock.maxX, f.maxX > dock.minX, f.minY < dock.maxY, f.maxY > dock.minY else { return o }
    switch side {
    case .right: o.x = dock.minX - frame.width
    case .left: o.x = dock.maxX
    case .bottom: o.y = dock.maxY
    }
    return o
  }

  public static func snap(frame: CGRect, visible: CGRect, notchX: ClosedRange<CGFloat>?) -> (origin: CGPoint, dock: DockEdge?) {
    snap(frame: frame, workspace: Workspace(bounds: visible, dock: nil), notchX: notchX)
  }

  /// Clamps into the workspace, then snaps flush to an edge or corner when
  /// within `snapDistance`. Beside the Dock the edge is the Dock's inner side;
  /// past its ends the orb reaches the screen edge. The top edge under the
  /// notch never docks.
  public static func snap(frame: CGRect, workspace ws: Workspace, notchX: ClosedRange<CGFloat>?) -> (origin: CGPoint, dock: DockEdge?) {
    var o = clampOrigin(frame: frame, workspace: ws)
    let f = CGRect(origin: o, size: frame.size)
    var limits = ws.bounds
    if let dock = ws.dock, let side = ws.dockSide {
      let alongY = f.minY < dock.maxY && f.maxY > dock.minY
      let alongX = f.minX < dock.maxX && f.maxX > dock.minX
      switch side {
      case .right where alongY: limits = CGRect(x: limits.minX, y: limits.minY, width: dock.minX - limits.minX, height: limits.height)
      case .left where alongY: limits = CGRect(x: dock.maxX, y: limits.minY, width: limits.maxX - dock.maxX, height: limits.height)
      case .bottom where alongX: limits = CGRect(x: limits.minX, y: dock.maxY, width: limits.width, height: limits.maxY - dock.maxY)
      default: break
      }
    }
    let visible = limits
    let left = f.minX - visible.minX <= snapDistance
    let right = visible.maxX - f.maxX <= snapDistance
    let bottom = f.minY - visible.minY <= snapDistance
    var top = visible.maxY - f.maxY <= snapDistance
    if top, let notchX, notchX.contains(f.midX) { top = false }

    let dock: DockEdge?
    switch (left, right, top, bottom) {
    case (true, _, true, _): dock = .topLeft
    case (_, true, true, _): dock = .topRight
    case (true, _, _, true): dock = .bottomLeft
    case (_, true, _, true): dock = .bottomRight
    case (true, _, _, _): dock = .left
    case (_, true, _, _): dock = .right
    case (_, _, true, _): dock = .top
    case (_, _, _, true): dock = .bottom
    default: dock = nil
    }
    guard let dock else { return (o, nil) }
    switch dock {
    case .left, .topLeft, .bottomLeft: o.x = visible.minX
    case .right, .topRight, .bottomRight: o.x = visible.maxX - frame.width
    default: break
    }
    switch dock {
    case .top, .topLeft, .topRight: o.y = visible.maxY - frame.height
    case .bottom, .bottomLeft, .bottomRight: o.y = visible.minY
    default: break
    }
    return (o, dock)
  }

  /// Screen rects where hovering a collapsed strip slides the orb out.
  public static func stripRects(frame f: CGRect, edge: DockEdge) -> [CGRect] {
    let t: CGFloat = 22, span: CGFloat = 120, arm: CGFloat = 100
    switch edge {
    case .right: return [CGRect(x: f.maxX - t, y: f.midY - span / 2, width: t, height: span)]
    case .left: return [CGRect(x: f.minX, y: f.midY - span / 2, width: t, height: span)]
    case .top: return [CGRect(x: f.midX - span / 2, y: f.maxY - t, width: span, height: t)]
    case .bottom: return [CGRect(x: f.midX - span / 2, y: f.minY, width: span, height: t)]
    case .topRight: return [CGRect(x: f.maxX - t, y: f.maxY - arm, width: t, height: arm),
                            CGRect(x: f.maxX - arm, y: f.maxY - t, width: arm, height: t)]
    case .topLeft: return [CGRect(x: f.minX, y: f.maxY - arm, width: t, height: arm),
                           CGRect(x: f.minX, y: f.maxY - t, width: arm, height: t)]
    case .bottomRight: return [CGRect(x: f.maxX - t, y: f.minY, width: t, height: arm),
                               CGRect(x: f.maxX - arm, y: f.minY, width: arm, height: t)]
    case .bottomLeft: return [CGRect(x: f.minX, y: f.minY, width: t, height: arm),
                              CGRect(x: f.minX, y: f.minY, width: arm, height: t)]
    }
  }

  /// Whether the cursor is on the orb window's live area. An opened strip keeps
  /// its collapsed area as well, so a cursor resting on the strip (outside the
  /// orb circle) doesn't make it collapse and reopen over and over.
  public static func overOrb(_ p: CGPoint, frame: CGRect, strip: DockEdge?, stripOpen: Bool) -> Bool {
    let onStrip = strip.map { edge in stripRects(frame: frame, edge: edge).contains { $0.contains(p) } } ?? false
    if strip != nil && !stripOpen { return onStrip }
    return hypot(p.x - frame.midX, p.y - frame.midY) <= orbRadius || onStrip
  }

  /// Interior side: the one with more horizontal room (ties go left).
  public static func interiorSide(center: CGPoint, visible: CGRect) -> HSide {
    (visible.maxX - center.x) > (center.x - visible.minX) ? .right : .left
  }

  public static func hover(center: CGPoint, visible: CGRect, buttonCount: Int,
                           listSize: CGSize, capsuleSize: CGSize) -> HoverLayout {
    let side = interiorSide(center: center, visible: visible)
    let base: CGFloat = side == .left ? 180 : 0
    let sign: CGFloat = side == .left ? -1 : 1
    let mid = CGFloat(buttonCount - 1) / 2
    let buttons = (0..<buttonCount).map { i -> CGPoint in
      let deg = base + sign * (mid - CGFloat(i)) * buttonSpacingDegrees
      let rad = deg * .pi / 180
      return CGPoint(x: center.x + cos(rad) * buttonRadius, y: center.y + sin(rad) * buttonRadius)
    }
    let half = buttonSize / 2
    let buttonRects = buttons.map { CGRect(x: $0.x - half, y: $0.y - half, width: buttonSize, height: buttonSize) }
    let fits = { (r: CGRect) in visible.contains(r) && !buttonRects.contains { $0.intersects(r) } }

    let listX = side == .left ? center.x + readoutGap : center.x - readoutGap - listSize.width
    let list = CGRect(x: listX, y: center.y - listSize.height / 2, width: listSize.width, height: listSize.height)

    let readout: ReadoutPlacement
    let readoutOnRight: Bool
    if fits(list) {
      readout = .list(list)
      readoutOnRight = side == .left
    } else {
      let upperHalf = center.y >= visible.midY
      let y = upperHalf ? center.y - orbRadius - capsuleGap - capsuleSize.height : center.y + orbRadius + capsuleGap
      var x = side == .left ? center.x + capsuleInset - capsuleSize.width : center.x - capsuleInset
      x = min(max(x, visible.minX), visible.maxX - capsuleSize.width)
      let capsule = CGRect(x: x, y: y, width: capsuleSize.width, height: capsuleSize.height)
      readout = fits(capsule) ? .capsule(capsule) : .none
      readoutOnRight = side == .right
    }
    let bx: CGFloat = readoutOnRight ? 1 : -1
    let badge = CGPoint(x: center.x + bx * cos(.pi / 4) * orbRadius, y: center.y + sin(.pi / 4) * orbRadius)
    return HoverLayout(side: side, buttons: buttons, readout: readout, badge: badge)
  }

  /// Audit card opens beyond the hover controls, leaving playback buttons accessible.
  public static func autoApprovals(center: CGPoint, visible: CGRect, hover: HoverLayout, count: Int) -> CGRect {
    var occupied = CGRect(x: center.x - orbRadius, y: center.y - orbRadius, width: orbRadius * 2, height: orbRadius * 2)
    for button in hover.buttons {
      occupied = occupied.union(CGRect(x: button.x - buttonSize / 2, y: button.y - buttonSize / 2,
                                      width: buttonSize, height: buttonSize))
    }
    switch hover.readout {
    case .list(let rect), .capsule(let rect): occupied = occupied.union(rect)
    case .none: break
    }
    let width = min(320, max(0, visible.width - screenMargin * 2))
    let height = min(CGFloat(88 + min(5, max(0, count)) * 60), max(0, visible.height - screenMargin * 2))
    let x = hover.side == .left ? occupied.minX - width - 12 : occupied.maxX + 12
    return CGRect(x: min(max(x, visible.minX + screenMargin), visible.maxX - width - screenMargin),
                  y: min(max(center.y - height / 2, visible.minY + screenMargin), visible.maxY - height - screenMargin),
                  width: width, height: height)
  }

  public static func quickBar(center: CGPoint, visible: CGRect, barSize: CGSize) -> QuickBarLayout {
    let side = interiorSide(center: center, visible: visible)
    let x = side == .left ? center.x - orbRadius - barGap - barSize.width : center.x + orbRadius + barGap
    var y = center.y - barSize.height / 2
    y = min(max(y, visible.minY + screenMargin), visible.maxY - screenMargin - barSize.height)
    let bar = CGRect(x: x, y: y, width: barSize.width, height: barSize.height)
    let growsUp = center.y < visible.midY
    let limit = growsUp ? visible.maxY - bar.maxY - 6 : bar.minY - visible.minY - 6
    return QuickBarLayout(side: side, bar: bar, growsUp: growsUp, stackLimit: max(0, limit))
  }
}
