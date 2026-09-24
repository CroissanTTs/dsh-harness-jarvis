import AppKit
import Combine
import SwiftUI
import JarvisPanelCore

/// Wires the orb window, the overlay, the model and the system observer.
@MainActor
final class AppController: NSObject {
  private let store: SettingsStore
  private let model: PanelModel
  private let demo: DemoAPI?
  private let snapshotDir: URL?
  private let overlayState = OverlayState()
  private let observer = SystemObserver()
  private let orb: OrbPanel
  private var overlay: OverlayPanel!
  private var settingsWindow: NSWindow?
  private var hotKey: HotKey?
  private var hotKeyError: String?

  /// Edge the orb is snapped to (kept even when strips are turned off).
  private var snapped: DockEdge?
  /// Docked, but slid out into the full orb because of hover or input.
  private var stripOpen = false
  private var hoverActive = false
  private var collapseWork: DispatchWorkItem?
  private var dragStart: CGPoint?
  private var dragging = false
  private var hidden = false
  private var wasQuickOpen = false
  private var toastWork: DispatchWorkItem?
  private var overlayHideWork: DispatchWorkItem?
  private var trackTimer: Timer?
  private var monitors: [Any] = []
  private var cancellables = Set<AnyCancellable>()
  private var pollTask: Task<Void, Never>?

  override init() {
    let env = ProcessInfo.processInfo.environment
    snapshotDir = env["JARVIS_SNAPSHOT"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    store = snapshotDir.map { SettingsStore(url: $0.appendingPathComponent("panel.json")) } ?? SettingsStore()
    demo = env["JARVIS_DEMO"] == "1" || snapshotDir != nil ? DemoAPI() : nil
    let api: JarvisAPI = demo ?? JarvisClient()
    model = PanelModel(api: api, store: store)
    orb = OrbPanel(count: store.settings.tier.count)
    super.init()
    overlay = OverlayPanel(root: OverlayRootView(
      state: overlayState, model: model,
      onHistory: { [weak self] in self?.openHistory() },
      onClose: { [weak self] in self?.model.closeQuickBar() }))
    if demo != nil { Log.write("demo mode") }
  }

  private var stripEdge: DockEdge? {
    store.settings.dockToStrip ? snapped : nil
  }

  // MARK: Lifecycle

  func start() {
    applySettings()
    restorePosition()
    orb.orderFrontRegardless()

    orb.onPress = { [weak self] in self?.beginPress() }
    orb.onDrag = { [weak self] in self?.drag(by: $0) }
    orb.onRelease = { [weak self] in self?.release(moved: $0) }
    orb.onRightClick = { [weak self] in self?.showMenu($0) }
    overlay.onCommandDigit = { [weak self] in self?.model.selectTarget(number: $0) }

    model.objectWillChange
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in self?.modelChanged() }
      .store(in: &cancellables)
    if let snapshotDir, let demo {
      Task { await Snapshotter(controller: self, demo: demo, dir: snapshotDir).run() }
      return
    }

    hotKey = HotKey { [weak self] spec in self?.hotKeyPressed(spec) }
    if hotKey?.replace(with: store.settings.hotKey.flatMap(HotKeySpec.init) ?? .default) != true {
      hotKeyError = "快捷键被占用"
      Log.write("hotkey registration failed")
    }

    installMonitors()
    observer.screen = { [weak self] in self?.currentScreen }
    observer.onChange = { [weak self] in
      guard let self else { return }
      applyReduceMotion()
      updateVisibility()
    }
    observer.start()

    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                           object: nil, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.screensChanged() }
    }

    pollTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.model.refresh()
        await self.model.waitForChange(timeout: self.hidden ? 5 : 1)
      }
    }
    modelChanged()
  }

  // MARK: Model → UI

  private func modelChanged() {
    let look = model.appearance
    orb.orbView.apply(motion: look.motion, tint: look.tint)
    if orb.badgeState.badge != look.badge { orb.badgeState.badge = look.badge }

    if model.quickBarOpen != wasQuickOpen {
      wasQuickOpen = model.quickBarOpen
      model.quickBarOpen ? quickBarOpened() : quickBarClosed()
    }
    if let toast = model.toast, overlayState.toast != toast {
      overlayState.toast = toast
      updateOverlayPresence()
      toastWork?.cancel()
      let work = DispatchWorkItem { [weak self] in
        guard let self else { return }
        model.clearToast()
        overlayState.toast = nil
        updateOverlayPresence()
      }
      toastWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
    }
    if hoverActive || model.caption != nil { layout() }
    updateOverlayPresence()
    updateVisibility()
  }

  // MARK: Geometry

  private var currentScreen: NSScreen? {
    let c = orb.center
    return NSScreen.screens.first { $0.frame.contains(c) } ?? NSScreen.main ?? NSScreen.screens.first
  }

  private static func key(for screen: NSScreen) -> String {
    let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
    return n.map { "\($0.uint32Value)" } ?? "main"
  }

  private static func workspace(_ screen: NSScreen) -> Workspace {
    Workspace.make(screen: screen.frame, visible: screen.visibleFrame, dockLength: estimatedDockLength())
  }

  /// The Dock's resting length along its edge, from its preferences and the
  /// running apps it shows. Padded so the estimate errs on the Dock's side.
  private static func estimatedDockLength() -> CGFloat? {
    guard let prefs = UserDefaults(suiteName: "com.apple.dock") else { return nil }
    let tile = CGFloat(prefs.object(forKey: "tilesize") as? Double ?? 48)
    func bundles(_ key: String) -> [String] {
      (prefs.array(forKey: key) as? [[String: Any]] ?? []).compactMap {
        ($0["tile-data"] as? [String: Any])?["bundle-identifier"] as? String
      }
    }
    let persistent = bundles("persistent-apps")
    let pinned = Set(persistent + ["com.apple.finder"])
    let others = (prefs.array(forKey: "persistent-others") ?? []).count
    let showRecents = prefs.object(forKey: "show-recents") as? Bool ?? true
    let running = NSWorkspace.shared.runningApplications.filter {
      $0.activationPolicy == .regular && !pinned.contains($0.bundleIdentifier ?? "")
    }.count
    let items = persistent.count + 1 + (showRecents ? running : 0) + others + 1
    return CGFloat(items) * tile * 1.12 + 3 * 16 + 40
  }

  private static func notchX(_ screen: NSScreen) -> ClosedRange<CGFloat>? {
    guard let l = screen.auxiliaryTopLeftArea, let r = screen.auxiliaryTopRightArea, l.maxX < r.minX else { return nil }
    return l.maxX...r.minX
  }

  /// Recomputes the hover and quick-bar layouts and sizes the overlay to cover both.
  private func layout() {
    guard let screen = currentScreen else { return }
    let visible = screen.visibleFrame
    let center = orb.center
    let rows = Readout.rows(snapshot: model.snapshot, connection: model.connection)
    let hover = Placement.hover(center: center, visible: visible, buttonCount: model.hoverButtons.count,
                                listSize: Readout.listSize(rows), capsuleSize: Readout.capsuleSize(rows))
    let quick = Placement.quickBar(center: center, visible: visible,
                                   barSize: CGSize(width: QuickBarView.width, height: QuickBarView.baseHeight))

    // Reserve a passive subtitle surface beyond the hover controls, clamped to the screen.
    let captionX = quick.side == .left ? quick.bar.minX - 42 : quick.bar.minX + 42
    let captionFrame = CGRect(x: min(max(captionX, visible.minX + 4), visible.maxX - 324),
                              y: min(max(center.y - 28, visible.minY + 4), visible.maxY - 60),
                              width: 320, height: 56)
    overlayState.captionFrame = captionFrame
    var area = CGRect(x: center.x - 70, y: center.y - 70, width: 140, height: 140)
    for b in hover.buttons { area = area.union(CGRect(x: b.x - 110, y: b.y - 30, width: 220, height: 60)) }
    switch hover.readout {
    case .list(let r), .capsule(let r): area = area.union(r)
    case .none: break
    }
    let stackTop = quick.growsUp ? quick.bar.maxY + quick.stackLimit : quick.bar.maxY
    let stackBottom = quick.growsUp ? quick.bar.minY : quick.bar.minY - quick.stackLimit
    area = area.union(CGRect(x: quick.bar.minX, y: stackBottom, width: quick.bar.width, height: stackTop - stackBottom))
    area = area.union(captionFrame)
    area = area.insetBy(dx: -16, dy: -16).integral

    if overlayState.frame != area {
      overlayState.frame = area
      overlay.setFrame(area, display: false)
    }
    if overlayState.hover != hover { overlayState.hover = hover }
    if overlayState.orbCenter != center { overlayState.orbCenter = center }
    if overlayState.quick != quick { overlayState.quick = quick }
    updateBadgePosition(hover)
  }

  private func updateBadgePosition(_ hover: HoverLayout? = nil) {
    let local: CGPoint
    if let edge = stripEdge, !stripOpen {
      local = Self.badgeOnStrip(edge)
    } else {
      let h = hover ?? overlayState.hover
      guard let b = h?.badge else { return }
      local = CGPoint(x: b.x - orb.frame.minX, y: orb.frame.maxY - b.y)
    }
    if orb.badgeState.position != local { orb.badgeState.position = local }
  }

  /// Badge at the far end of the strip, in orb-window SwiftUI coordinates.
  private static func badgeOnStrip(_ edge: DockEdge) -> CGPoint {
    let s = Placement.orbWindow
    switch edge {
    case .right: return CGPoint(x: s - 12, y: 12)
    case .left: return CGPoint(x: 12, y: 12)
    case .top: return CGPoint(x: s - 12, y: 12)
    case .bottom: return CGPoint(x: s - 12, y: s - 12)
    case .topRight: return CGPoint(x: s - 90, y: 12)
    case .topLeft: return CGPoint(x: 90, y: 12)
    case .bottomRight: return CGPoint(x: s - 90, y: s - 12)
    case .bottomLeft: return CGPoint(x: 90, y: s - 12)
    }
  }

  // MARK: Position memory

  private func restorePosition() {
    let screens = NSScreen.screens
    guard let main = NSScreen.main ?? screens.first else { return }
    let saved = store.settings.positions
    let screen = ([main] + screens).first { saved[Self.key(for: $0)] != nil } ?? main
    let visible = screen.visibleFrame
    let size = CGSize(width: Placement.orbWindow, height: Placement.orbWindow)
    var frame: CGRect
    if let p = saved[Self.key(for: screen)] {
      frame = CGRect(origin: CGPoint(x: p.x, y: p.y), size: size)
    } else {
      frame = CGRect(x: visible.maxX - size.width - 16, y: visible.maxY - size.height - 16,
                     width: size.width, height: size.height)
    }
    let result = Placement.snap(frame: frame, workspace: Self.workspace(screen), notchX: Self.notchX(screen))
    orb.setFrameOrigin(result.origin)
    snapped = result.dock
    stripOpen = false
    orb.orbView.setDock(stripEdge)
    layout()
  }

  private func savePosition() {
    guard let screen = currentScreen else { return }
    let key = Self.key(for: screen)
    let o = orb.frame.origin
    let dock = snapped
    store.update { $0.positions[key] = SavedPosition(x: o.x, y: o.y, dock: dock) }
  }

  func resetPosition() {
    guard let screen = currentScreen else { return }
    let key = Self.key(for: screen)
    store.update { $0.positions.removeValue(forKey: key) }
    restorePosition()
  }

  private func screensChanged() {
    let c = orb.center
    if !NSScreen.screens.contains(where: { Self.workspace($0).bounds.insetBy(dx: -1, dy: -1).contains(c) }) {
      restorePosition()
    } else {
      layout()
    }
  }

  // MARK: Mouse

  private func installMonitors() {
    let moves: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged]
    if let m = NSEvent.addGlobalMonitorForEvents(matching: moves, handler: { [weak self] _ in
      MainActor.assumeIsolated { self?.trackMouse() }
    }) { monitors.append(m) }
    if let m = NSEvent.addLocalMonitorForEvents(matching: moves, handler: { [weak self] e in
      MainActor.assumeIsolated { self?.trackMouse() }
      return e
    }) { monitors.append(m) }
    if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, self.model.quickBarOpen else { return }
        self.model.closeQuickBar()
      }
    }) { monitors.append(m) }
  }

  private func overOrb(_ p: CGPoint) -> Bool {
    Placement.overOrb(p, frame: orb.frame, strip: stripEdge, stripOpen: stripOpen)
  }

  private func trackMouse() {
    guard !hidden, !dragging, snapshotDir == nil else { return }
    let p = NSEvent.mouseLocation
    let onOrb = overOrb(p)
    let onOverlay = overlay.isVisible && overlayState.hits(p)
    if orb.ignoresMouseEvents == onOrb { orb.ignoresMouseEvents = !onOrb }
    if overlay.ignoresMouseEvents == onOverlay { overlay.ignoresMouseEvents = !onOverlay }
    if onOrb || onOverlay {
      enterHover()
    } else if hoverActive {
      scheduleCollapse()
    }
    updateVisibility()
  }

  /// Polls the cursor while the hover layer or bar is up: mouse-moved events
  /// stop arriving once the cursor is over one of our non-key windows.
  private func setTracking(_ on: Bool) {
    if on, trackTimer == nil {
      trackTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.trackMouse() }
      }
    } else if !on {
      trackTimer?.invalidate()
      trackTimer = nil
    }
  }

  private func enterHover() {
    collapseWork?.cancel()
    collapseWork = nil
    guard !hoverActive else { return }
    hoverActive = true
    model.setHovering(true)
    setTracking(true)
    openStrip()
    layout()
    updateOverlayPresence()
    if !model.quickBarOpen { withAnimation { overlayState.showHover = true } }
    orb.badgeState.visible = false
  }

  private func scheduleCollapse() {
    guard collapseWork == nil else { return }
    let work = DispatchWorkItem { [weak self] in self?.collapseHover() }
    collapseWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
  }

  private func collapseHover() {
    collapseWork = nil
    hoverActive = false
    model.setHovering(false)
    withAnimation(.easeOut(duration: 0.15)) { overlayState.showHover = false }
    orb.badgeState.visible = true
    if !model.quickBarOpen {
      closeStrip()
      setTracking(false)
    }
    updateOverlayPresence()
    updateVisibility()
  }

  private func openStrip() {
    guard stripEdge != nil, !stripOpen else { return }
    stripOpen = true
    orb.orbView.setDock(nil)
    updateBadgePosition()
  }

  private func closeStrip() {
    guard let edge = stripEdge, stripOpen else { return }
    stripOpen = false
    orb.orbView.setDock(edge)
    updateBadgePosition()
  }

  // MARK: Press, drag, tap

  private func beginPress() {
    dragStart = orb.frame.origin
  }

  private func drag(by delta: CGPoint) {
    guard let start = dragStart else { return }
    if !dragging {
      dragging = true
      if model.quickBarOpen { model.closeQuickBar() }
      overlayState.showHover = false
      orb.badgeState.visible = false
      snapped = nil
      stripOpen = false
      orb.orbView.setDock(nil)
    }
    let cursor = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { $0.frame.contains(cursor) } ?? currentScreen
    var frame = orb.frame
    frame.origin = CGPoint(x: start.x + delta.x, y: start.y + delta.y)
    if let screen { frame.origin = Placement.clampOrigin(frame: frame, workspace: Self.workspace(screen)) }
    orb.setFrameOrigin(frame.origin)
  }

  private func release(moved: Bool) {
    dragStart = nil
    guard moved, dragging else {
      model.quickBarOpen ? model.closeQuickBar() : model.openQuickBar()
      return
    }
    dragging = false
    guard let screen = currentScreen else { return }
    let result = Placement.snap(frame: orb.frame, workspace: Self.workspace(screen), notchX: Self.notchX(screen))
    snapped = result.dock
    stripOpen = stripEdge != nil
    NSAnimationContext.runAnimationGroup { ctx in
      ctx.duration = 0.18
      ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
      orb.animator().setFrameOrigin(result.origin)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
      guard let self else { return }
      savePosition()
      hoverActive = false
      model.setHovering(false)
      layout()
      trackMouse()
      if !hoverActive { closeStrip() }
      orb.badgeState.visible = !hoverActive
    }
  }

  // MARK: Quick bar

  private func hotKeyPressed(_ spec: HotKeySpec) {
    if let recorder = NSApp.keyWindow?.firstResponder as? HotKeyRecorderButton, recorder.recording {
      recorder.record(spec)
      return
    }
    let focused = overlay.isKeyWindow && overlay.firstResponder is PlaceholderTextView
    switch InputHotKeyAction.resolve(inputOpen: model.quickBarOpen, inputFocused: focused) {
    case .open:
      model.openQuickBar()
      modelChanged()
    case .close:
      model.closeQuickBar()
      modelChanged()
    case .focus:
      focusQuickInput()
    }
  }

  private func focusQuickInput() {
    updateVisibility()
    overlayHideWork?.cancel()
    overlay.makeKeyAndOrderFront(nil)
    overlayState.focusToken += 1
  }

  func stop() {
    hotKey?.invalidate()
    hotKey = nil
  }

  private func quickBarOpened() {
    setTracking(true)
    openStrip()
    layout()
    overlayState.showHover = false
    overlayState.showTargets = false
    focusQuickInput()
  }

  private func quickBarClosed() {
    overlayState.showTargets = false
    if overlay.isKeyWindow { overlay.orderOut(nil) }
    if hoverActive {
      withAnimation { overlayState.showHover = true }
    } else {
      closeStrip()
      setTracking(false)
    }
    updateOverlayPresence()
  }

  private func openHistory() {
    if !model.quickBarOpen { model.openQuickBar() }
    Task { await model.setHistoryExpanded(true) }
  }

  // MARK: Visibility

  private func updateVisibility() {
    let p = NSEvent.mouseLocation
    let c = orb.center
    var input = VisibilityInput(
      frontBundleID: observer.frontBundleID, fullscreen: observer.fullscreen, appLauncher: observer.appLauncher,
      cursorDistance: hypot(p.x - c.x, p.y - c.y), hovering: hoverActive,
      interacting: model.quickBarOpen || dragging, prominent: model.appearance.tint != .cyan,
      settings: store.settings)
    input.strip = stripEdge != nil && !stripOpen
    input.inputOpen = model.quickBarOpen
    let out = VisibilityPolicy.evaluate(input)

    if out.hidden != hidden {
      hidden = out.hidden
      Log.write("orb \(hidden ? "hidden" : "shown") front=\(observer.frontBundleID ?? "-") "
        + "fullscreen=\(observer.fullscreen) launcher=\(observer.appLauncher)")
      orb.orbView.rendering = !hidden
      if hidden {
        if model.quickBarOpen { model.closeQuickBar() }
        orb.orderOut(nil)
        overlay.orderOut(nil)
        setTracking(false)
      } else {
        orb.orderFrontRegardless()
        updateOverlayPresence()
      }
    }
    guard !hidden else { return }
    let target = CGFloat(out.opacity)
    let current = orb.alphaValue
    guard abs(target - current) > 0.005 else { return }
    if target < current - 0.2 {
      NSAnimationContext.runAnimationGroup { ctx in
        ctx.duration = 0.25
        orb.animator().alphaValue = target
      }
    } else {
      orb.alphaValue = target
    }
  }

  /// The overlay spans a large area; ordering it out while empty releases its
  /// backing surfaces. The delay keeps it alive across quick re-hovers, which
  /// would otherwise rebuild those surfaces every time.
  private func updateOverlayPresence() {
    overlayHideWork?.cancel()
    overlayHideWork = nil
    let needed = !hidden && (hoverActive || model.quickBarOpen || overlayState.toast != nil || model.caption != nil)
    if needed {
      if !overlay.isVisible { overlay.orderFrontRegardless() }
    } else if overlay.isVisible {
      let work = DispatchWorkItem { [weak self] in
        guard let self, !overlay.isKeyWindow else { return }
        overlay.orderOut(nil)
        overlayState.hitRects = []
      }
      overlayHideWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }
  }

  // MARK: Settings & menu

  private func applySettings() {
    let s = store.settings
    model.refreshCaptions()
    updateOverlayPresence()
    orb.setMissionControlHidden(s.hideInMissionControl)
    overlay.setMissionControlHidden(s.hideInMissionControl)
    orb.orbView.setCount(s.tier.count)
    applyReduceMotion()
    if !stripOpen { orb.orbView.setDock(stripEdge) }
    updateBadgePosition()
    updateVisibility()
  }

  private func applyReduceMotion() {
    orb.orbView.setReduceMotion(store.settings.followReduceMotion && observer.reduceMotion)
    overlayState.reduceCaptionMotion = observer.reduceMotion
  }

  private func showMenu(_ event: NSEvent) {
    let menu = NSMenu()
    let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")
    settings.target = self
    menu.addItem(settings)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    if let view = orb.contentView { NSMenu.popUpContextMenu(menu, with: event, for: view) }
  }

  @objc private func openSettings() {
    if settingsWindow == nil {
      let settingsModel = SettingsModel(store: store,
                                        onChange: { [weak self] in self?.applySettings() },
                                        onResetPosition: { [weak self] in self?.resetPosition() },
                                        hotKeyError: hotKeyError,
                                        onHotKeyChange: { [weak self] spec in
        guard let self, hotKey?.replace(with: spec) == true else { return false }
        hotKeyError = nil
        return true
      })
      let host = NSHostingController(rootView: SettingsView(model: settingsModel))
      let window = NSWindow(contentViewController: host)
      window.title = "贾维斯设置"
      window.styleMask = [.titled, .closable]
      window.isReleasedWhenClosed = false
      window.center()
      settingsWindow = window
    }
    NSApp.activate(ignoringOtherApps: true)
    settingsWindow?.makeKeyAndOrderFront(nil)
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }
}

// MARK: Snapshot hooks

extension AppController {
  var snapshotParts: (orb: OrbPanel, overlay: OverlayPanel, model: PanelModel) { (orb, overlay, model) }

  func snapshotPlace(_ origin: CGPoint) {
    guard let screen = NSScreen.main else { return }
    var frame = orb.frame
    frame.origin = origin
    let result = Placement.snap(frame: frame, workspace: Self.workspace(screen), notchX: Self.notchX(screen))
    orb.setFrameOrigin(result.origin)
    snapped = result.dock
    stripOpen = false
    orb.orbView.setDock(stripEdge)
    layout()
  }

  func snapshotTargets(_ on: Bool) {
    overlayState.showTargets = on
  }

  func snapshotHover(_ on: Bool) {
    if on {
      enterHover()
    } else if hoverActive {
      collapseHover()
    }
  }
}
