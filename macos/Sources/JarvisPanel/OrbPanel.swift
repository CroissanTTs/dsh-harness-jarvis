import AppKit
import SwiftUI
import JarvisPanelCore

/// 140×140 borderless panel holding the Metal orb and the badge (spec §1, §4).
/// Mouse events are only accepted while the cursor is over the orb or strip;
/// the controller toggles `ignoresMouseEvents` from its mouse monitors.
final class OrbPanel: NSPanel {
  let orbView: OrbMetalView
  let badgeState: BadgeState
  let badgeView: NSView
  private let container: OrbContainerView

  var onPress: (() -> Void)?
  var onDrag: ((CGPoint) -> Void)?
  var onRelease: ((Bool) -> Void)?
  var onRightClick: ((NSEvent) -> Void)?

  init(count: Int) {
    let size = Placement.orbWindow
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    orbView = OrbMetalView(frame: rect, count: count)
    container = OrbContainerView(frame: rect)
    let state = BadgeState()
    badgeState = state
    let badge = PassthroughHostingView(rootView: BadgeView(state: state))
    badgeView = badge
    super.init(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    level = .statusBar
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    isMovable = false
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    acceptsMouseMovedEvents = true
    ignoresMouseEvents = true
    appearance = NSAppearance(named: .darkAqua)

    orbView.autoresizingMask = [.width, .height]
    container.addSubview(orbView)
    badge.frame = rect
    badge.autoresizingMask = [.width, .height]
    container.addSubview(badge)
    container.panel = self
    contentView = container
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  func setMissionControlHidden(_ hidden: Bool) {
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, hidden ? .transient : .stationary]
  }

  var center: CGPoint { CGPoint(x: frame.midX, y: frame.midY) }
}

private final class OrbContainerView: NSView {
  weak var panel: OrbPanel?
  private var downAt: CGPoint?
  private var moved = false

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    downAt = NSEvent.mouseLocation
    moved = false
    panel?.onPress?()
  }

  override func mouseDragged(with event: NSEvent) {
    guard let downAt else { return }
    let p = NSEvent.mouseLocation
    let delta = CGPoint(x: p.x - downAt.x, y: p.y - downAt.y)
    if !moved && hypot(delta.x, delta.y) < Placement.dragThreshold { return }
    moved = true
    panel?.onDrag?(delta)
  }

  override func mouseUp(with event: NSEvent) {
    guard downAt != nil else { return }
    downAt = nil
    panel?.onRelease?(moved)
  }

  override func rightMouseDown(with event: NSEvent) {
    panel?.onRightClick?(event)
  }
}

/// SwiftUI host that never takes clicks, so the orb container handles them.
final class PassthroughHostingView<Content: View>: NSHostingView<Content> {
  override var isOpaque: Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  required init(rootView: Content) {
    super.init(rootView: rootView)
    sizingOptions = []
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }
}

// MARK: Badge

final class BadgeState: ObservableObject {
  @Published var badge: Badge?
  /// Center in window-local SwiftUI coordinates (y down).
  @Published var position = CGPoint(x: 112, y: 28)
  @Published var visible = true
}

struct BadgeView: View {
  @ObservedObject var state: BadgeState

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.clear
      if let badge = state.badge {
        BadgeShape(badge: badge)
          .position(state.position)
          .opacity(state.visible ? 1 : 0)
          .animation(.easeOut(duration: 0.18), value: state.visible)
          .animation(.easeOut(duration: 0.25), value: state.position)
      }
    }
    .frame(width: Placement.orbWindow, height: Placement.orbWindow)
    .allowsHitTesting(false)
  }
}

private struct BadgeShape: View {
  let badge: Badge

  var body: some View {
    let color = Theme.tint(badge.tint)
    ZStack(alignment: .topTrailing) {
      if badge.count > 0 {
        Text(badge.count > 99 ? "99+" : "\(badge.count)")
          .font(.system(size: 10, weight: .bold, design: .rounded))
          .foregroundStyle(Color.black.opacity(0.85))
          .padding(.horizontal, 5)
          .frame(minWidth: 17, minHeight: 17)
          .background(Capsule().fill(color))
          .shadow(color: color.opacity(0.6), radius: 4)
      } else {
        Circle().fill(Color.white).frame(width: 8, height: 8).shadow(color: color.opacity(0.8), radius: 3)
      }
      if badge.unreadDot && badge.count > 0 {
        Circle().fill(Color.white).frame(width: 6, height: 6)
          .overlay(Circle().stroke(Color.black.opacity(0.4), lineWidth: 0.5))
          .offset(x: 2, y: -2)
      }
    }
  }
}
