import XCTest
@testable import JarvisPanelCore

final class HotKeyTests: XCTestCase {
  // MARK: - 等价类
  func testDefaultAndModifierCombinations() throws {
    XCTAssertEqual(HotKeySpec.default.displayString, "⌃⌥J")
    XCTAssertEqual(HotKeySpec.default.keyCode, 38)
    XCTAssertEqual(HotKeySpec.default.modifiers, 0x1800)
    for text in ["⌘A", "⌥J", "⌃J", "⇧A", "⌃⌥⇧⌘J"] {
      let spec = try XCTUnwrap(HotKeySpec(text))
      XCTAssertEqual(spec.displayString, text)
      XCTAssertEqual(HotKeySpec(spec.displayString), spec)
    }
    XCTAssertEqual(HotKeySpec("⌘⌃j")?.displayString, "⌃⌘J")
  }

  func testSuccessfulReplacementRegistersBeforeReleasingOld() throws {
    var events: [String] = []
    let binding = HotKeyBinding { spec in
      events.append("register " + spec.displayString)
      return { events.append("release " + spec.displayString) }
    }
    XCTAssertTrue(binding.replace(with: .default))
    let next = try XCTUnwrap(HotKeySpec("⌃1"))
    XCTAssertTrue(binding.replace(with: next))
    XCTAssertEqual(binding.spec, next)
    XCTAssertEqual(events, ["register ⌃⌥J", "register ⌃1", "release ⌃⌥J"])
    binding.unregister()
    XCTAssertEqual(events.last, "release ⌃1")
  }

  func testInputHotkeyOpensClosesOrFocuses() {
    XCTAssertEqual(InputHotKeyAction.resolve(inputOpen: false, inputFocused: false), .open)
    XCTAssertEqual(InputHotKeyAction.resolve(inputOpen: true, inputFocused: true), .close)
    XCTAssertEqual(InputHotKeyAction.resolve(inputOpen: true, inputFocused: false), .focus)
  }

  // MARK: - 边界值
  func testDigitsAndFunctionKeysRoundTrip() {
    for key in (0...9).map(String.init) + (1...20).map({ "F\($0)" }) {
      let spec = HotKeySpec("⌃" + key)
      XCTAssertNotNil(spec, key)
      XCTAssertEqual(spec?.displayString, "⌃" + key)
    }
    XCTAssertEqual(HotKeySpec("⌥Space")?.keyCode, 49)
    XCTAssertNil(HotKeySpec("⌃F0"))
    XCTAssertNil(HotKeySpec("⌃F21"))
  }

  func testNoModifierAlwaysRejected() {
    for key in ["J", "1", "F1", "Space"] { XCTAssertNil(HotKeySpec(key)) }
    XCTAssertNil(HotKeySpec(keyCode: 38, modifiers: 0))
  }

  func testSameCombinationDoesNotRegisterAgainAndUnregisterIsIdempotent() {
    var registrations = 0, releases = 0
    let binding = HotKeyBinding { _ in registrations += 1; return { releases += 1 } }
    XCTAssertTrue(binding.replace(with: .default))
    XCTAssertTrue(binding.replace(with: .default))
    binding.unregister()
    binding.unregister()
    XCTAssertEqual(registrations, 1)
    XCTAssertEqual(releases, 1)
    XCTAssertNil(binding.spec)
  }

  func testDeinitReleasesRegistration() {
    var releases = 0
    var binding: HotKeyBinding? = HotKeyBinding { _ in { releases += 1 } }
    XCTAssertTrue(binding!.replace(with: .default))
    binding = nil
    XCTAssertEqual(releases, 1)
  }

  // MARK: - 异常路径
  func testMalformedStringsAndUnknownBitsRejected() {
    for text in ["", " ", "⌃", "⌃⌃J", "⌃💫", "Ctrl+J", "⌃JJ"] {
      XCTAssertNil(HotKeySpec(text), text)
    }
    XCTAssertNil(HotKeySpec(keyCode: 999, modifiers: 0x1000))
    XCTAssertNil(HotKeySpec(keyCode: 38, modifiers: 0x1001))
  }

  func testConflictPreservesPreviousSpecAndRegistration() throws {
    var releases = 0, occupied = false
    let binding = HotKeyBinding { _ in
      if occupied { return nil }
      return { releases += 1 }
    }
    XCTAssertTrue(binding.replace(with: .default))
    occupied = true
    XCTAssertFalse(binding.replace(with: try XCTUnwrap(HotKeySpec("⌃2"))))
    XCTAssertEqual(binding.spec, .default)
    XCTAssertEqual(releases, 0)
    binding.unregister()
    XCTAssertEqual(releases, 1)
  }

  func testInitialFailureCanRecover() {
    var occupied = true
    let binding = HotKeyBinding { _ in occupied ? nil : {} }
    XCTAssertFalse(binding.replace(with: .default))
    XCTAssertNil(binding.spec)
    occupied = false
    XCTAssertTrue(binding.replace(with: .default))
  }
}
