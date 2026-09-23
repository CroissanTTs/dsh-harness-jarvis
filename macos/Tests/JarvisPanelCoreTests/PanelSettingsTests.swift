import XCTest
@testable import JarvisPanelCore

final class PanelSettingsTests: XCTestCase {
  private var dir: URL!
  private var url: URL { dir.appendingPathComponent("panel.json") }

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func write(_ json: String) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try Data(json.utf8).write(to: url)
  }

  func testMissingFileGivesDefaults() {
    XCTAssertEqual(SettingsStore(url: url).settings, PanelSettings())
  }

  func testDefaultsMatchSpec() {
    let s = PanelSettings()
    XCTAssertEqual(s.dshOpacity, 1.0)
    XCTAssertEqual(s.otherOpacity, 0.35)
    XCTAssertTrue(s.proximityFade)
    XCTAssertTrue(s.keepProminent)
    XCTAssertTrue(s.hideInFullscreen)
    XCTAssertTrue(s.hideInMissionControl)
    XCTAssertTrue(s.hideInAppLauncher)
    XCTAssertEqual(s.hiddenApps, [])
    XCTAssertEqual(s.tier, .standard)
    XCTAssertTrue(s.followReduceMotion)
    XCTAssertTrue(s.dockToStrip)
    XCTAssertNil(s.lastTarget)
    XCTAssertFalse(s.historyExpanded)
  }

  func testPartialFileKeepsOtherDefaults() throws {
    try write(#"{"otherOpacity":0.5,"tier":"lite"}"#)
    let s = SettingsStore(url: url).settings
    XCTAssertEqual(s.otherOpacity, 0.5)
    XCTAssertEqual(s.tier, .lite)
    XCTAssertEqual(s.dshOpacity, 1.0)
    XCTAssertTrue(s.hideInFullscreen)
  }

  func testOpacityClampedLow() throws {
    try write(#"{"otherOpacity":0.01,"dshOpacity":-3}"#)
    let s = SettingsStore(url: url).settings
    XCTAssertEqual(s.otherOpacity, 0.15)
    XCTAssertEqual(s.dshOpacity, 0.15)
  }

  func testOpacityClampedHigh() throws {
    try write(#"{"otherOpacity":2.0}"#)
    XCTAssertEqual(SettingsStore(url: url).settings.otherOpacity, 1.0)
  }

  func testUnknownTierFallsBack() throws {
    try write(#"{"tier":"ultra"}"#)
    XCTAssertEqual(SettingsStore(url: url).settings.tier, .standard)
  }

  func testCorruptFileGivesDefaults() throws {
    try write("{not json")
    XCTAssertEqual(SettingsStore(url: url).settings, PanelSettings())
  }

  func testUpdatePersists() {
    let store = SettingsStore(url: url)
    store.update {
      $0.tier = .minimal
      $0.hiddenApps = ["com.apple.QuickTimePlayerX"]
      $0.positions["1"] = SavedPosition(x: 10, y: 20, dock: .topRight)
      $0.lastTarget = "s1"
    }
    let reloaded = SettingsStore(url: url).settings
    XCTAssertEqual(reloaded.tier, .minimal)
    XCTAssertEqual(reloaded.hiddenApps, ["com.apple.QuickTimePlayerX"])
    XCTAssertEqual(reloaded.positions["1"], SavedPosition(x: 10, y: 20, dock: .topRight))
    XCTAssertEqual(reloaded.lastTarget, "s1")
  }

  func testUpdateClamps() {
    let store = SettingsStore(url: url)
    store.update { $0.otherOpacity = 0 }
    XCTAssertEqual(store.settings.otherOpacity, 0.15)
  }

  func testTierLabelsAndCounts() {
    XCTAssertEqual(ParticleTier.allCases.map(\.label), ["极简", "精简", "默认"])
    XCTAssertEqual(ParticleTier.allCases.map(\.count), [300, 600, 900])
  }
}
