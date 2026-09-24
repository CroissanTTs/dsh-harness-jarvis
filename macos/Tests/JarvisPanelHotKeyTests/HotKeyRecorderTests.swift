import AppKit
import XCTest
import JarvisPanelCore
@testable import JarvisPanel

@MainActor
final class HotKeyRecorderTests: XCTestCase {
  private func key(_ code: UInt16, _ modifiers: NSEvent.ModifierFlags = []) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: 0,
      windowNumber: 0, context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: code)!
  }

  private func fixture() -> (NSWindow, HotKeyRecorderButton) {
    _ = NSApplication.shared
    let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 260, height: 80),
      styleMask: [.titled], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    let button = HotKeyRecorderButton(frame: CGRect(x: 10, y: 10, width: 220, height: 30))
    window.contentView?.addSubview(button)
    button.beginRecording()
    return (window, button)
  }

  // MARK: - 等价类
  func testFocusedRecorderCapturesCommandCombination() async {
    let (window, button) = fixture()
    defer { window.close() }
    var captured: HotKeySpec?
    button.onRecord = { captured = $0 }
    XCTAssertTrue(button.recording)
    XCTAssertTrue(button.performKeyEquivalent(with: key(38, [.command, .control])))
    XCTAssertEqual(captured, HotKeySpec("⌃⌘J"))
    XCTAssertFalse(button.recording)
  }

  func testCurrentCarbonCombinationCompletesRecordingWithoutKeyboardEvent() async {
    let (window, button) = fixture()
    defer { window.close() }
    var captured: HotKeySpec?
    button.onRecord = { captured = $0 }
    button.record(.default)
    XCTAssertEqual(captured, .default)
    XCTAssertFalse(button.recording)
  }

  // MARK: - 边界值
  func testEscapeCancelsWithoutSavingAndFocusLossCancels() async {
    let (window, button) = fixture()
    defer { window.close() }
    var saves = 0
    button.onRecord = { _ in saves += 1 }
    button.keyDown(with: key(53))
    XCTAssertFalse(button.recording)
    XCTAssertEqual(saves, 0)
    button.beginRecording()
    XCTAssertTrue(button.recording)
    window.makeFirstResponder(nil)
    XCTAssertFalse(button.recording)
  }

  // MARK: - 异常路径
  func testUnmodifiedKeyDoesNotSaveAndKeepsRecording() async {
    let (window, button) = fixture()
    defer { window.close() }
    var errors = 0, saves = 0
    button.onInvalid = { errors += 1 }
    button.onRecord = { _ in saves += 1 }
    button.keyDown(with: key(38))
    XCTAssertEqual(errors, 1)
    XCTAssertEqual(saves, 0)
    XCTAssertTrue(button.recording)
  }
}
