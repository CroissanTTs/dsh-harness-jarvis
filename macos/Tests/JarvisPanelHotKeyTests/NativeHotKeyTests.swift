import AppKit
import Carbon
import XCTest
import JarvisPanelCore
@testable import JarvisPanel

@MainActor
final class NativeHotKeyTests: XCTestCase {
  // Use rare combinations, never the user's normal/default global key.
  private let first = HotKeySpec("⌃⌥⇧⌘F19")!
  private let second = HotKeySpec("⌃⌥⇧⌘F20")!

  // MARK: - 等价类
  func testCarbonRegistrationConflictAndUnregister() async throws {
    _ = NSApplication.shared
    let owner = HotKey { _ in }
    let contender = HotKey { _ in }
    defer { owner.invalidate(); contender.invalidate() }
    guard owner.replace(with: first) else { throw XCTSkip("Carbon hotkey unavailable in this login session") }
    XCTAssertTrue(owner.replace(with: first))
    XCTAssertFalse(contender.replace(with: first))
    owner.invalidate()
    XCTAssertTrue(contender.replace(with: first))
  }

  func testNativeConflictKeepsOldCombinationRegistered() async throws {
    _ = NSApplication.shared
    let owner = HotKey { _ in }
    let blocker = HotKey { _ in }
    let probe = HotKey { _ in }
    defer { owner.invalidate(); blocker.invalidate(); probe.invalidate() }
    guard owner.replace(with: first), blocker.replace(with: second) else {
      throw XCTSkip("Carbon hotkey unavailable in this login session")
    }
    XCTAssertFalse(owner.replace(with: second))
    XCTAssertFalse(probe.replace(with: first))
    blocker.invalidate()
    XCTAssertTrue(owner.replace(with: second))
    XCTAssertTrue(probe.replace(with: first))
  }

  // MARK: - 边界值
  func testNativeDeinitUnregistersHotkey() async throws {
    _ = NSApplication.shared
    var owner: HotKey? = HotKey { _ in }
    guard owner!.replace(with: first) else { throw XCTSkip("Carbon hotkey unavailable in this login session") }
    owner = nil
    let probe = HotKey { _ in }
    defer { probe.invalidate() }
    XCTAssertTrue(probe.replace(with: first))
  }

  func testInvalidateIsTerminalAndIdempotent() async {
    let owner = HotKey { _ in }
    owner.invalidate()
    owner.invalidate()
    XCTAssertFalse(owner.replace(with: first))
  }

  // MARK: - 异常路径
  func testExclusiveRegistrationRejectsAnotherProcess() async throws {
    let child = Process()
    let input = Pipe(), output = Pipe()
    child.executableURL = URL(fileURLWithPath: "/usr/bin/swift")
    child.arguments = ["-e", """
      import AppKit
      import Carbon
      _ = NSApplication.shared
      var ref: EventHotKeyRef?
      let status = RegisterEventHotKey(\(first.keyCode), \(first.modifiers),
        EventHotKeyID(signature: 0x48544553, id: 1), GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &ref)
      print(status)
      fflush(stdout)
      _ = FileHandle.standardInput.readData(ofLength: 1)
      if let ref { UnregisterEventHotKey(ref) }
      """]
    child.standardInput = input
    child.standardOutput = output
    try child.run()
    defer {
      try? input.fileHandleForWriting.write(contentsOf: Data([10]))
      try? input.fileHandleForWriting.close()
      child.waitUntilExit()
    }
    let status = String(data: output.fileHandleForReading.availableData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard status == "0" else { throw XCTSkip("Child Carbon registration unavailable: \(status ?? "no output")") }
    let owner = HotKey { _ in }
    defer { owner.invalidate() }
    XCTAssertFalse(owner.replace(with: first), "Another process's exclusive registration must reject the change")
  }

  func testSettingsConflictRetainsPersistedValueAndReportsError() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = SettingsStore(url: dir.appendingPathComponent("panel.json"))
    var occupied = false
    let model = SettingsModel(store: store, onChange: {}, onResetPosition: {}, hotKeyError: nil,
      onHotKeyChange: { _ in !occupied })
    model.setHotKey(first)
    XCTAssertEqual(store.settings.hotKey, first.displayString)
    occupied = true
    model.setHotKey(second)
    XCTAssertEqual(model.hotKeyError, "快捷键被占用")
    XCTAssertEqual(model.settings.hotKey, first.displayString)
    XCTAssertEqual(SettingsStore(url: store.url).settings.hotKey, first.displayString)
    occupied = false
    model.setHotKey(.default)
    XCTAssertNil(model.hotKeyError)
    XCTAssertNil(SettingsStore(url: store.url).settings.hotKey)
  }
}
