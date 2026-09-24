import AppKit
import Darwin

@main
enum JarvisPanelMain {
  static func main() {
    // The host re-spawns us on every restart; a panel that survived as a
    // detached child must not be stacked with a second orb.
    // Snapshot runs are offscreen and exit on their own, so they neither need nor take the lock.
    let snapshot = ProcessInfo.processInfo.environment["JARVIS_SNAPSHOT"] != nil
    if !snapshot && !AppDelegate.acquireSingleInstance() { exit(0) }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var controller: AppController?

  /// pidfile at ~/.dsh/jarvis/panel.pid. Returns false if another live panel owns it.
  nonisolated static func acquireSingleInstance() -> Bool {
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh/jarvis/panel.pid")
    if let data = try? Data(contentsOf: url),
       let pid = Int(String(data: data, encoding: .utf8) ?? ""),
       pid > 0, pid != Int(getpid()), kill(pid_t(pid), 0) == 0 {
      return false
    }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? Data(String(getpid()).utf8).write(to: url)
    return true
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    ProcessInfo.processInfo.disableAutomaticTermination("jarvis-panel")
    ProcessInfo.processInfo.disableSuddenTermination()
    let controller = AppController()
    controller.start()
    self.controller = controller
  }

  func applicationWillTerminate(_ notification: Notification) {
    controller?.stop()
  }
}
