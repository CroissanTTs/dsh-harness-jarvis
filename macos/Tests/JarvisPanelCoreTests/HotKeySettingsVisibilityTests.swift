import XCTest
@testable import JarvisPanelCore

final class HotKeySettingsVisibilityTests: XCTestCase {
  // MARK: - 等价类
  func testSettingsPersistCustomAndDefaultHotkey() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appendingPathComponent("panel.json")
    let store = SettingsStore(url: url)
    XCTAssertNil(store.settings.hotKey)
    store.update { $0.hotKey = "⌘⌃j" }
    XCTAssertEqual(SettingsStore(url: url).settings.hotKey, "⌃⌘J")
    store.update { $0.hotKey = nil }
    XCTAssertNil(SettingsStore(url: url).settings.hotKey)
  }

  func testOpenInputOverridesEveryHiddenCombinationAndClosingRestoresIt() {
    var settings = PanelSettings()
    settings.hiddenApps = ["hidden.app"]
    settings.otherOpacity = 0.15
    for fullscreen in [false, true] {
      for launcher in [false, true] {
        for hiddenApp in [false, true] {
          var input = VisibilityInput(frontBundleID: hiddenApp ? "hidden.app" : "other.app",
            fullscreen: fullscreen, appLauncher: launcher, cursorDistance: nil,
            hovering: false, interacting: false, prominent: false, settings: settings)
          let before = VisibilityPolicy.evaluate(input)
          input.inputOpen = true
          XCTAssertEqual(VisibilityPolicy.evaluate(input), VisibilityOutput(hidden: false, opacity: 1))
          input.inputOpen = false
          XCTAssertEqual(VisibilityPolicy.evaluate(input), before)
          XCTAssertEqual(before.hidden, fullscreen || launcher || hiddenApp)
        }
      }
    }
  }

  // MARK: - 边界值
  func testOlderSettingsWithoutHotkeyKeepDefault() throws {
    let settings = try JSONDecoder().decode(PanelSettings.self, from: Data(#"{"otherOpacity":0.5}"#.utf8))
    XCTAssertNil(settings.hotKey)
    XCTAssertEqual(settings.otherOpacity, 0.5)
  }

  func testDragOrHoverDoesNotOverrideFullscreen() {
    let input = VisibilityInput(frontBundleID: nil, fullscreen: true, appLauncher: false,
      cursorDistance: 0, hovering: true, interacting: true, prominent: true, settings: PanelSettings())
    XCTAssertTrue(VisibilityPolicy.evaluate(input).hidden)
  }

  // MARK: - 异常路径
  func testInvalidHotkeyFallsBackWithoutDiscardingOtherSettings() throws {
    for json in [#"{"hotKey":"J","otherOpacity":0.5}"#, #"{"hotKey":42,"otherOpacity":0.5}"#,
                 #"{"hotKey":"","otherOpacity":0.5}"#] {
      let settings = try JSONDecoder().decode(PanelSettings.self, from: Data(json.utf8)).normalized()
      XCTAssertNil(settings.hotKey)
      XCTAssertEqual(settings.otherOpacity, 0.5)
    }
  }
}
