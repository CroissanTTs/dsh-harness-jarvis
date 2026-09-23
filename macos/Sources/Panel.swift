import AppKit
import SwiftUI

/// Borderless, non-activating, always-on-top panel (codex-pet/dsh-notch style).
/// Collapsed = the orb floating on a transparent background (no rounded rect).
/// Expanded = the SwiftUI content draws its own material background.
final class JarvisPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  // An accessory (non-activating) panel has no app Edit menu to route Command
  // keys, so handle the standard ones for our focused text field ourselves.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard isKeyWindow, let editor = firstResponder as? NSTextView else {
      return super.performKeyEquivalent(with: event)
    }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard flags.contains(.command), !flags.contains(.control), !flags.contains(.option) else {
      return super.performKeyEquivalent(with: event)
    }
    let key = event.charactersIgnoringModifiers?.lowercased()
    switch key {
    case "a": editor.selectAll(nil); return true
    case "c": editor.copy(nil); return true
    case "x" where editor.isEditable: editor.cut(nil); return true
    case "v" where editor.isEditable: editor.paste(nil); return true
    default: return super.performKeyEquivalent(with: event)
    }
  }

  // Drag via the AppDelegate's cursor-timer (NSEvent.mouseLocation tracks the
  // cursor ANYWHERE — not just over the panel — so the drag never loses the
  // cursor like mouseDragged did). A click (press + release without moving past
  // the threshold) → onTap (toggle expand). Buttons consume their own clicks, so
  // mouseDown reaches here only for the orb / panel background.
  var dragging = false
  var collapsed = true
  var onTap: (() -> Void)?
  var onEdgeState: ((EdgeState) -> Void)?
  private var collapsedFrame: NSRect = .zero
  private var dragOffset = NSPoint.zero
  private var dragStartMouse = NSPoint.zero
  private var dragMoved = false
  private let dragThreshold: CGFloat = 4
  private let snapThreshold: CGFloat = 30

  override func mouseDown(with event: NSEvent) {
    if collapsed {
      dragging = true
      dragMoved = false
      let m = NSEvent.mouseLocation
      dragOffset = NSPoint(x: m.x - frame.origin.x, y: m.y - frame.origin.y)
      dragStartMouse = m
    } else {
      onTap?()
    }
  }

  /// Drag tracking via the cursor-timer. Free movement, clamped fully on-screen
  /// (whole orb stays visible). On release: if near an edge, SNAP to it + set
  /// edgeState (melt shape). Camera/notch zone at top → no melt (full orb).
  func tickDrag() {
    guard dragging else { return }
    if (NSEvent.pressedMouseButtons & 1) == 0 {
      dragging = false
      if !dragMoved { onTap?(); return }
      let edge = detectEdgeState()
      snapToEdge(edge)
      onEdgeState?(edge)
      return
    }
    let now = NSEvent.mouseLocation
    if !dragMoved {
      let dx = now.x - dragStartMouse.x, dy = now.y - dragStartMouse.y
      if (dx * dx + dy * dy) > dragThreshold * dragThreshold { dragMoved = true }
    }
    var o = NSPoint(x: now.x - dragOffset.x, y: now.y - dragOffset.y)
    if let sf = (NSScreen.main ?? NSScreen.screens.first)?.frame {
      o.x = max(sf.minX, min(o.x, sf.maxX - frame.width))
      o.y = max(sf.minY, min(o.y, sf.maxY - frame.height))
    }
    setFrameOrigin(o)
  }

  private func detectEdgeState() -> EdgeState {
    guard let sf = (NSScreen.main ?? NSScreen.screens.first)?.frame else { return .none }
    let left = frame.minX <= sf.minX + snapThreshold
    let right = frame.maxX >= sf.maxX - snapThreshold
    let top = frame.maxY >= sf.maxY - snapThreshold
    let bottom = frame.minY <= sf.minY + snapThreshold
    if top && overlapsNotch() { return .inCamera }
    if top && left { return .topLeft }
    if top && right { return .topRight }
    if bottom && left { return .bottomLeft }
    if bottom && right { return .bottomRight }
    if left { return .left }
    if right { return .right }
    if top { return .top }
    if bottom { return .bottom }
    return .none
  }

  private func overlapsNotch() -> Bool {
    guard let screen = NSScreen.main,
          let lt = screen.auxiliaryTopLeftArea,
          let rt = screen.auxiliaryTopRightArea else { return false }
    return frame.midX > lt.maxX && frame.midX < rt.minX
  }

  var preHoverEdge: EdgeState = .none

  /// Snap the orb flush to the detected edge (animated, for melt-back transition).
  func snapToEdge(_ edge: EdgeState) {
    guard let sf = (NSScreen.main ?? NSScreen.screens.first)?.frame else { return }
    var o = frame.origin
    switch edge {
    case .left, .topLeft, .bottomLeft: o.x = sf.minX
    case .right, .topRight, .bottomRight: o.x = sf.maxX - frame.width
    default: break
    }
    switch edge {
    case .top, .topLeft, .topRight: o.y = sf.maxY - frame.height
    case .bottom, .bottomLeft, .bottomRight: o.y = sf.minY
    default: break
    }
    animateOrigin(o)
  }

  /// Shift the orb TOWARD the screen center (away from the edge/corner) so the
  /// full circle is visible (not blocked by the L arms). Animated.
  func shiftTowardCenter(_ edge: EdgeState) {
    let offset: CGFloat = 32
    var o = frame.origin
    switch edge {
    case .left, .topLeft, .bottomLeft: o.x += offset
    case .right, .topRight, .bottomRight: o.x -= offset
    default: break
    }
    switch edge {
    case .top, .topLeft, .topRight: o.y -= offset
    case .bottom, .bottomLeft, .bottomRight: o.y += offset
    default: break
    }
    animateOrigin(o)
  }

  private func animateOrigin(_ o: NSPoint) {
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = 0.25
      ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      animator().setFrameOrigin(o)
    }
  }

  convenience init(contentRect: NSRect) {
    self.init(
      contentRect: contentRect,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    level = .statusBar
    // Always-on-top across all Spaces AND over fullscreen apps (codex-pet/dsh-notch:
    // the pet is always visible, never auto-hidden during fullscreen).
    collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
    isOpaque = false
    backgroundColor = .clear
    appearance = NSAppearance(named: .darkAqua)
    hasShadow = false // orb glow + SwiftUI material bg provide their own; a panel shadow would square the collapsed orb
    isMovable = false
    hidesOnDeactivate = false
    becomesKeyOnlyIfNeeded = false
    isReleasedWhenClosed = false
  }

  /// Expand/collapse with ADAPTIVE anchoring: the expanded panel anchors to the
  /// orb's NEAREST screen corner so it opens AWAY from the nearest edge and
  /// never runs off-screen. (top-right orb → grow down-left; top-left →
  /// down-right; bottom-left → up-right; bottom-right → up-left.) The orb's
  /// pre-expand frame is saved and restored on collapse so it doesn't jump.
  func resizeExpanded(_ expanded: Bool, expandedSize: NSSize, orbSize: NSSize, animated: Bool = true) {
    if expanded {
      // ALWAYS save the orb's current frame on expand (the previous size-guard
      // only saved it once, so after a drag the orb jumped back to the first
      // position on expand). Saving every expand = in-place expand.
      collapsedFrame = frame
      guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
      let sf = screen.frame // full screen (incl Dock side) — matches the drag clamp
      let s = collapsedFrame
      let anchorRight = s.midX >= sf.midX
      let anchorTop = s.midY >= sf.midY
      var endX = anchorRight ? s.maxX - expandedSize.width : s.minX
      var endY = anchorTop ? s.maxY - expandedSize.height : s.minY
      endX = max(sf.minX, min(endX, sf.maxX - expandedSize.width))
      endY = max(sf.minY, min(endY, sf.maxY - expandedSize.height))
      applyFrame(NSRect(x: endX, y: endY, width: expandedSize.width, height: expandedSize.height), animated)
    } else {
      let end = collapsedFrame.size == orbSize ? collapsedFrame : NSRect(origin: frame.origin, size: orbSize)
      applyFrame(end, animated)
    }
  }

  private func applyFrame(_ end: NSRect, _ animated: Bool) {
    guard animated, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
      setFrame(end, display: true)
      return
    }
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = 0.22
      ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      animator().setFrame(end, display: true)
    }
  }

  /// Host the SwiftUI root directly (no NSVisualEffectView). The collapsed orb
  /// floats on a transparent background (no rounded rect); the expanded content
  /// draws its own SwiftUI material background in RootView.
  func embedHost(_ hosting: NSView) {
    hosting.autoresizingMask = [.width, .height]
    hosting.frame = contentView?.bounds ?? NSRect(origin: .zero, size: frame.size)
    hosting.wantsLayer = true
    hosting.layer?.isOpaque = false
    hosting.layer?.backgroundColor = NSColor.clear.cgColor
    contentView = hosting
  }
}

/// Non-opaque hosting view that accepts the first mouse so SwiftUI controls are
/// clickable immediately even while another app is active.
final class JarvisHostingView<Content: View>: NSHostingView<Content> {
  override var isOpaque: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
