import AppKit
import SwiftUI
import JarvisPanelCore

/// Transparent panel that hosts the hover layer, quick bar, cards and history.
/// It spans every place those can appear around the orb, and only accepts the
/// mouse over the rects its content reports (`OverlayState.hitRects`).
final class OverlayPanel: NSPanel {
  var onCommandDigit: ((Int) -> Void)?

  init<Content: View>(root: Content) {
    super.init(contentRect: NSRect(x: 0, y: 0, width: 10, height: 10),
               styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    level = .statusBar
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    isMovable = false
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    becomesKeyOnlyIfNeeded = false
    acceptsMouseMovedEvents = true
    ignoresMouseEvents = true
    appearance = NSAppearance(named: .darkAqua)
    let host = OverlayHostingView(rootView: root)
    host.sizingOptions = []
    host.wantsLayer = true
    host.layer?.backgroundColor = NSColor.clear.cgColor
    contentView = host
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  func setMissionControlHidden(_ hidden: Bool) {
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, hidden ? .transient : .stationary]
  }

  /// An accessory app has no Edit menu, so route the standard editing keys and
  /// ⌘1…⌘9 target selection ourselves.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard isKeyWindow, flags.contains(.command), !flags.contains(.control), !flags.contains(.option) else {
      return super.performKeyEquivalent(with: event)
    }
    let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
    if let n = Int(key), (1...9).contains(n), !flags.contains(.shift) {
      onCommandDigit?(n)
      return true
    }
    guard let editor = firstResponder as? NSTextView else { return super.performKeyEquivalent(with: event) }
    switch key {
    case "a": editor.selectAll(nil)
    case "c": editor.copy(nil)
    case "x": editor.cut(nil)
    case "v": editor.paste(nil)
    case "z": flags.contains(.shift) ? editor.undoManager?.redo() : editor.undoManager?.undo()
    default: return super.performKeyEquivalent(with: event)
    }
    return true
  }
}

private final class OverlayHostingView<Content: View>: NSHostingView<Content> {
  override var isOpaque: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: Shared state

@MainActor
final class OverlayState: ObservableObject {
  /// Overlay window frame in screen coordinates (y up).
  @Published var frame: CGRect = .zero
  @Published var hover: HoverLayout?
  /// Orb center in screen coordinates; hover buttons grow out of it.
  @Published var orbCenter: CGPoint = .zero
  @Published var showHover = false
  @Published var quick: QuickBarLayout?
  @Published var showTargets = false
  @Published var focusToken = 0
  @Published var toast: String?
  /// Interactive rects in overlay-local SwiftUI coordinates (y down).
  var hitRects: [CGRect] = []

  func local(_ p: CGPoint) -> CGPoint {
    CGPoint(x: p.x - frame.minX, y: frame.maxY - p.y)
  }

  func local(_ r: CGRect) -> CGRect {
    CGRect(x: r.minX - frame.minX, y: frame.maxY - r.maxY, width: r.width, height: r.height)
  }

  func screen(_ r: CGRect) -> CGRect {
    CGRect(x: frame.minX + r.minX, y: frame.maxY - r.maxY, width: r.width, height: r.height)
  }

  func hits(_ screenPoint: CGPoint) -> Bool {
    hitRects.contains { screen($0).insetBy(dx: -3, dy: -3).contains(screenPoint) }
  }
}

struct HitRectsKey: PreferenceKey {
  static let defaultValue: [CGRect] = []
  static func reduce(value: inout [CGRect], nextValue: () -> [CGRect]) {
    value.append(contentsOf: nextValue())
  }
}

extension View {
  /// Marks this view as clickable; everything else in the overlay passes through.
  func hitArea() -> some View {
    background(GeometryReader { g in
      Color.clear.preference(key: HitRectsKey.self, value: [g.frame(in: .named(OverlayRootView.space))])
    })
  }
}
