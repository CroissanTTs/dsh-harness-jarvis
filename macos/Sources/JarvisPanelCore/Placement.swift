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

/// Pure geometry for snapping and the hover/quick-bar layouts (spec §4, §5.3,
/// §6). All rects are AppKit screen coordinates (y up).
public enum Placement {
  public static let orbWindow: CGFloat = 140
  public static let orbRadius: CGFloat = 60
  public static let snapDistance: CGFloat = 30
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

  /// Clamps into the visible area, then snaps flush to an edge or corner when
  /// within `snapDistance`. The top edge under the notch never docks.
  public static func snap(frame: CGRect, visible: CGRect, notchX: ClosedRange<CGFloat>?) -> (origin: CGPoint, dock: DockEdge?) {
    var o = clampOrigin(frame: frame, visible: visible)
    let f = CGRect(origin: o, size: frame.size)
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
