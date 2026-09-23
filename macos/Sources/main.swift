import AppKit
import SwiftUI
import Combine
import CoreGraphics
import Darwin

@main
enum JarvisPanelMain {
  static func main() {
    // Single-instance guard: the host re-spawns us on every restart; if a panel
    // is already running (survived the host restart as a detached child), exit
    // silently so we never stack duplicate orbs.
    if !AppDelegate.acquireSingleInstance() { exit(0) }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // no Dock icon; lives in the menu bar / overlay layer
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let orbSize = NSSize(width: 96, height: 96)
  private let expandedSize = NSSize(width: 340, height: 240)
  private let edgeInset: CGFloat = 16
  /// DSH Desktop bundle id prefix (Beta = ai.deepseek.dsh.desktop.beta). The orb
  /// is full-opacity when DSH is frontmost; semi-transparent otherwise.
  private let dshBundlePrefix = "ai.deepseek.dsh.desktop"
  private let model = PanelModel()
  private var panel: JarvisPanel?
  private var hosting: JarvisHostingView<RootView>?
  private var cancellables = Set<AnyCancellable>()
  private var hiddenForFullscreen = false
  private var visTimer: Timer?
  private var diagTick = 0
  // Cursor-driven hover-expand (replaces SwiftUI .onHover, which jittered).
  private var cursorTimer: Timer?
  private var overPanel = false
  private var foldWork: DispatchWorkItem?

  /// pidfile at ~/.dsh/jarvis/panel.pid. Returns false (caller exits) if another
  /// live panel owns it; otherwise writes our pid and returns true.
  static func acquireSingleInstance() -> Bool {
    let url = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".dsh/jarvis/panel.pid")
    if let data = try? Data(contentsOf: url),
       let pid = Int(String(data: data, encoding: .utf8) ?? "") {
      // kill(pid, 0) == 0 ⇒ a process with that pid exists.
      if pid > 0 && kill(pid_t(pid), 0) == 0 { return false }
    }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                             withIntermediateDirectories: true)
    try? Data(String(ProcessInfo.processInfo.processIdentifier).utf8).write(to: url)
    return true
  }


  func applicationDidFinishLaunching(_ notification: Notification) {
    ProcessInfo.processInfo.disableAutomaticTermination("jarvis-panel")
    ProcessInfo.processInfo.disableSuddenTermination()

    let root = RootView(model: model)
    let hosting = JarvisHostingView(rootView: root)
    hosting.sizingOptions = []
    hosting.wantsLayer = true
    hosting.layer?.isOpaque = false
    hosting.layer?.backgroundColor = NSColor.clear.cgColor
    self.hosting = hosting

    let panel = JarvisPanel(contentRect: NSRect(origin: .zero, size: orbSize))
    panel.embedHost(hosting)
    self.panel = panel
    pinToScreen()
    panel.orderFrontRegardless()
    model.start()

    // Auto-hide the orb while a fullscreen window (fullscreen video app, or the
    // Mission Control full-screen overlay) covers the screen — polled so we
    // never intrude on fullscreen content.
    visTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.updateVisibility() }
    }
    // Cursor-driven hover/alpha + drag tracking (60fps for smooth drag). Frame-
    // based + fold delay — no SwiftUI .onHover jitter. Tracks the cursor anywhere
    // (NSEvent.mouseLocation) so the drag never loses the cursor.
    cursorTimer = Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.tickPointer() }
    }

    // Drive panel size + collapsed flag from the expanded state. Expand =
    // adaptive-anchored resize (opens away from the nearest screen edge); collapse
    // restores the orb's saved frame. Click (onTap) toggles expanded.
    model.$expanded
      .receive(on: DispatchQueue.main)
      .sink { [weak self] expanded in
        guard let self else { return }
        panel.collapsed = !expanded
        panel.resizeExpanded(expanded, expandedSize: expandedSize, orbSize: orbSize, animated: true)
      }
      .store(in: &cancellables)
    panel.onTap = { [weak self] in self?.model.expanded.toggle() }
    panel.onEdgeState = { [weak self] edge in self?.model.edgeState = edge }

    NotificationCenter.default.addObserver(
      self, selector: #selector(pinToScreen),
      name: NSApplication.didChangeScreenParametersNotification, object: nil
    )
  }

  /// Anchor to the top-right corner of the main screen's visible frame, using
  /// the current (orb or expanded) size.
  @objc private func pinToScreen() {
    guard let panel else { return }
    guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let visible = screen.visibleFrame
    let size = model.expanded ? expandedSize : orbSize
    let frame = NSRect(
      x: visible.maxX - size.width - edgeInset,
      y: visible.maxY - size.height - edgeInset,
      width: size.width,
      height: size.height
    )
    panel.setFrame(frame, display: true)
  }

  /// Cursor-driven hover + auto-collapse (replaces SwiftUI .onHover, which
  /// jittered). Per spec: hovering just makes the orb OPAQUE (does NOT auto-
  /// expand); expand is a CLICK (onTap). After a click-expand, when the cursor
  /// leaves the panel it auto-collapses (0.4s fold). Uses the panel's actual
  /// frame (stable during resize) + a fold delay.
  @MainActor
  private func tickPointer() {
    guard let panel else { return }
    // Drag tracking takes priority (tracks the cursor anywhere via the timer,
    // so the drag doesn't lose the cursor like mouseDragged did).
    if panel.dragging {
      panel.tickDrag()
      updateAlpha()
      return
    }
    let hit = panel.frame.contains(NSEvent.mouseLocation)
    if hit {
      foldWork?.cancel()
      foldWork = nil
      overPanel = true
      // Hover over a MELTED shape (edge/corner) → show the full circle + shift
      // toward center so the circle isn't blocked. Animated transition.
      if model.edgeState != .none {
        panel.preHoverEdge = model.edgeState
        model.edgeState = .none
        panel.shiftTowardCenter(panel.preHoverEdge)
      }
    } else {
      overPanel = false
      // Leaving the circle shown on hover → melt back to the edge + snap back.
      if model.edgeState == .none && panel.preHoverEdge != .none {
        let edge = panel.preHoverEdge
        panel.preHoverEdge = .none
        model.edgeState = edge
        panel.snapToEdge(edge)
      }
      guard model.expanded, foldWork == nil else {
        updateAlpha()
        return
      }
      let work = DispatchWorkItem { [weak self] in
        Task { @MainActor in
          guard let self, !self.overPanel else { return }
          self.model.expanded = false
        }
      }
      foldWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }
    updateAlpha()
  }

  /// Full opacity (1.0) when DSH is frontmost, OR the cursor is over the orb
  /// (hover), OR the orb is expanded — set INSTANTLY. Semi-transparent (0.38)
  /// otherwise, with a short fade on leave. Runs on the fast cursor-timer so
  /// hover→opaque is immediate.
  @MainActor
  private func updateAlpha() {
    guard let panel else { return }
    let frontBundle = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
    let isDSH = frontBundle.hasPrefix(dshBundlePrefix)
    let targetAlpha: CGFloat = (isDSH || overPanel || model.expanded) ? 1.0 : 0.38
    if panel.alphaValue == targetAlpha { return }
    if targetAlpha >= 1.0 {
      panel.alphaValue = 1.0 // instant on hover / DSH / expanded
    } else {
      NSAnimationContext.runAnimationGroup { ctx in
        ctx.duration = 0.22
        panel.animator().alphaValue = targetAlpha
      }
    }
  }

  /// Hide the orb when a NON-DSH onscreen window covers the whole main screen
  /// incl. the menu-bar area — i.e. TRUE macOS fullscreen (an external fullscreen
  /// video app, or the Mission Control full-screen overlay). We EXCLUDE windows
  /// owned by "DSH Desktop" so that DSH's own fullscreen/maximized window — which
  /// stays covering the screen in the background when you tab away — doesn't
  /// false-trigger a hide whenever you switch to a normal app. A maximized
  /// (non-fullscreen) window is shorter than the screen (title bar + dock), so it
  /// won't trigger either.
  private func shouldHideForFullscreen() -> Bool {
    guard let screen = NSScreen.main else { return false }
    let sw = screen.frame.width
    let sh = screen.frame.height
    guard let list = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] else { return false }
    let me = Int(ProcessInfo.processInfo.processIdentifier)
    for w in list {
      // Skip our own panel.
      if (w[kCGWindowOwnerPID as String] as? Int) == me { continue }
      // Skip DSH Desktop's own windows + screenshot/screen-capture overlays. DSH
      // keeps a full-screen capture overlay up (so the AI can see the screen); it
      // covers the screen but is NOT fullscreen video, so it must not trigger a
      // hide. Match by owner name; also skip transparent overlays (alpha < 0.9),
      // since real fullscreen video windows are opaque.
      if let owner = w[kCGWindowOwnerName as String] as? String {
        let o = owner as NSString
        if o.localizedCaseInsensitiveContains("DSH Desktop")
           || o.localizedCaseInsensitiveContains("截屏")
           || o.localizedCaseInsensitiveContains("Screenshot")
           || o.localizedCaseInsensitiveContains("Screen Capture")
           || o.localizedCaseInsensitiveContains("Capture") { continue }
      }
      let alpha = (w[kCGWindowAlpha as String] as? CGFloat) ?? 1
      if alpha < 0.9 { continue }
      guard let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
      let width = b["Width"] ?? 0
      let height = b["Height"] ?? 0
      if width >= sw - 2 && height >= sh - 2 {
        let owner = (w[kCGWindowOwnerName as String] as? String) ?? "?"
        logPanel("HIDE trigger: owner=\"\(owner)\" alpha=\(alpha) \(Int(width))x\(Int(height))")
        return true
      }
    }
    return false
  }

  /// Append a line to ~/.dsh/jarvis/panel-debug.log for diagnosing visibility.
  private func logPanel(_ msg: String) {
    let url = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".dsh/jarvis/panel-debug.log")
    let line = "\(Date().ISO8601Format()) \(msg)\n"
    if !FileManager.default.fileExists(atPath: url.path) {
      try? line.write(to: url, atomically: true, encoding: .utf8)
    } else if let h = FileHandle(forWritingAtPath: url.path) {
      h.seekToEndOfFile(); h.write(Data(line.utf8)); h.closeFile()
    }
  }

  @MainActor
  private func updateVisibility() {
    // The orb is ALWAYS visible (per codex-pet/dsh-notch — no fragile fullscreen
    // auto-hide). Alpha (semi-transparent when not DSH / not hovered) is handled
    // on the fast cursor-timer in updateAlpha() so hover→full is instant. This
    // 0.8s timer only re-asserts the panel stays on top.
    let shouldHide = false
    if shouldHide != hiddenForFullscreen {
      hiddenForFullscreen = shouldHide
      let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "?"
      logPanel("state→\(shouldHide ? "HIDE" : "SHOW") frontmost=\(front)")
    }
    // Re-assert visibility every tick (statusBar nonactivating panel — no focus
    // steal) so the orb survives if anything orders it out.
    if shouldHide {
      panel?.orderOut(nil)
    } else {
      panel?.orderFrontRegardless()
    }
  }
}
