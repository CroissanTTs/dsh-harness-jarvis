import AppKit
import CoreGraphics

/// Frontmost app, fullscreen, the macOS 26 Apps launcher and Reduce Motion
/// (spec §3). Event-driven where AppKit notifies, plus a 1s window-list poll.
@MainActor
final class SystemObserver {
  private(set) var frontBundleID: String?
  private(set) var fullscreen = false
  private(set) var appLauncher = false
  private(set) var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

  var onChange: (() -> Void)?
  var screen: () -> NSScreen? = { NSScreen.main }

  private var timer: Timer?
  private var tokens: [NSObjectProtocol] = []
  private let ownPID = ProcessInfo.processInfo.processIdentifier
  private static let overlayOwners = ["DSH Desktop", "截屏", "Screenshot", "Capture"]

  func start() {
    frontBundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    let ws = NSWorkspace.shared.notificationCenter
    let names: [Notification.Name] = [NSWorkspace.didActivateApplicationNotification,
                                      NSWorkspace.activeSpaceDidChangeNotification,
                                      NSWorkspace.accessibilityDisplayOptionsDidChangeNotification]
    for name in names {
      tokens.append(ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated { self?.check() }
      })
    }
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.check() }
    }
    check()
  }

  func check() {
    let front = NSWorkspace.shared.frontmostApplication
    let bundle = front?.bundleIdentifier
    let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let (full, launcher) = scanWindows(frontPID: front?.processIdentifier)
    if launcher != appLauncher { Log.write("app launcher \(launcher ? "shown" : "hidden")") }
    if full != fullscreen { Log.write("fullscreen \(full) front=\(bundle ?? "-")") }
    let changed = bundle != frontBundleID || full != fullscreen || launcher != appLauncher || reduce != reduceMotion
    frontBundleID = bundle
    fullscreen = full
    appLauncher = launcher
    reduceMotion = reduce
    if changed { onChange?() }
  }

  /// Fullscreen: an opaque layer-0 window of the frontmost app covering the
  /// whole screen, menu bar included. Launcher: a large visible Spotlight
  /// panel (macOS 26 Apps). Dock overlays are not used: revealing the desktop
  /// also raises a full-screen Dock window.
  private func scanWindows(frontPID: pid_t?) -> (Bool, Bool) {
    guard let screen = screen(),
          let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return (false, false) }
    let primaryHeight = NSScreen.screens.first?.frame.height ?? screen.frame.height
    let sf = screen.frame
    let target = CGRect(x: sf.minX, y: primaryHeight - sf.maxY, width: sf.width, height: sf.height)
    var full = false
    var launcher = false
    for w in list {
      guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid != ownPID,
            let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
      let rect = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
      let alpha = (w[kCGWindowAlpha as String] as? CGFloat) ?? 1
      let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
      let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""

      if !launcher, alpha > 0.5, layer > 0, rect.width >= target.width * 0.5, rect.height >= target.height * 0.5,
         rect.intersects(target),
         NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.apple.Spotlight" {
        launcher = true
        if !appLauncher { Log.write("launcher window: layer=\(layer) alpha=\(alpha) \(rect)") }
      }
      if !full, pid == frontPID, layer == 0, alpha >= 0.9,
         !Self.overlayOwners.contains(where: { owner.localizedCaseInsensitiveContains($0) }),
         rect.minX <= target.minX + 2, rect.minY <= target.minY + 2,
         rect.maxX >= target.maxX - 2, rect.maxY >= target.maxY - 2 {
        full = true
      }
    }
    return (full, launcher)
  }
}
