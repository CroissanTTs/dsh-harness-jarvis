import XCTest
@testable import JarvisPanelCore

final class VisibilityPolicyTests: XCTestCase {
  private func input(front: String? = "com.apple.Safari", fullscreen: Bool = false, launcher: Bool = false,
                     distance: Double? = nil, hovering: Bool = false, interacting: Bool = false,
                     prominent: Bool = false, settings: PanelSettings = PanelSettings()) -> VisibilityInput {
    VisibilityInput(frontBundleID: front, fullscreen: fullscreen, appLauncher: launcher, cursorDistance: distance,
                    hovering: hovering, interacting: interacting, prominent: prominent, settings: settings)
  }

  private func eval(_ i: VisibilityInput) -> VisibilityOutput {
    VisibilityPolicy.evaluate(i)
  }

  func testDSHFrontmostIsOpaque() {
    XCTAssertEqual(eval(input(front: "ai.deepseek.dsh.desktop")), VisibilityOutput(hidden: false, opacity: 1.0))
  }

  func testDSHBetaBundleCounts() {
    XCTAssertEqual(eval(input(front: "ai.deepseek.dsh.desktop.beta")).opacity, 1.0)
  }

  func testOtherAppIsSemiTransparent() {
    XCTAssertEqual(eval(input()).opacity, 0.35, accuracy: 1e-9)
  }

  func testUnknownFrontmostUsesOtherOpacity() {
    XCTAssertEqual(eval(input(front: nil)).opacity, 0.35, accuracy: 1e-9)
  }

  func testCustomOpacities() {
    var s = PanelSettings()
    s.dshOpacity = 0.8
    s.otherOpacity = 0.5
    XCTAssertEqual(eval(input(front: "ai.deepseek.dsh.desktop", settings: s)).opacity, 0.8, accuracy: 1e-9)
    XCTAssertEqual(eval(input(settings: s)).opacity, 0.5, accuracy: 1e-9)
  }

  func testProminentStaysAtLeast85() {
    XCTAssertEqual(eval(input(prominent: true)).opacity, 0.85, accuracy: 1e-9)
  }

  func testProminentDisabled() {
    var s = PanelSettings()
    s.keepProminent = false
    XCTAssertEqual(eval(input(prominent: true, settings: s)).opacity, 0.35, accuracy: 1e-9)
  }

  func testHoverAndInteractionAreOpaque() {
    XCTAssertEqual(eval(input(hovering: true)).opacity, 1.0)
    XCTAssertEqual(eval(input(interacting: true)).opacity, 1.0)
  }

  func testProximityFadeHalfway() {
    XCTAssertEqual(eval(input(distance: 100)).opacity, 0.35 + 0.65 * 0.5, accuracy: 1e-9)
  }

  func testProximityBoundaries() {
    XCTAssertEqual(eval(input(distance: 60)).opacity, 1.0, accuracy: 1e-9)
    XCTAssertEqual(eval(input(distance: 140)).opacity, 0.35, accuracy: 1e-9)
    XCTAssertEqual(eval(input(distance: 200)).opacity, 0.35, accuracy: 1e-9)
  }

  func testProximityFadeDisabled() {
    var s = PanelSettings()
    s.proximityFade = false
    XCTAssertEqual(eval(input(distance: 100, settings: s)).opacity, 0.35, accuracy: 1e-9)
  }

  func testFullscreenHides() {
    XCTAssertTrue(eval(input(fullscreen: true)).hidden)
  }

  func testFullscreenSettingOff() {
    var s = PanelSettings()
    s.hideInFullscreen = false
    XCTAssertFalse(eval(input(fullscreen: true, settings: s)).hidden)
  }

  func testHiddenAppsHide() {
    var s = PanelSettings()
    s.hiddenApps = ["com.apple.Keynote"]
    XCTAssertTrue(eval(input(front: "com.apple.Keynote", settings: s)).hidden)
    XCTAssertFalse(eval(input(front: "com.apple.Safari", settings: s)).hidden)
  }

  func testAppLauncherHides() {
    XCTAssertTrue(eval(input(launcher: true)).hidden)
    var s = PanelSettings()
    s.hideInAppLauncher = false
    XCTAssertFalse(eval(input(launcher: true, settings: s)).hidden)
  }

  func testCollapsedStripStaysLegible() {
    var i = input()
    i.strip = true
    XCTAssertEqual(eval(i).opacity, 0.8, accuracy: 1e-9)
  }

  func testStripFloorDoesNotLowerHigherOpacity() {
    var i = input(front: "ai.deepseek.dsh.desktop")
    i.strip = true
    XCTAssertEqual(eval(i).opacity, 1.0)
  }

  func testStripStillHiddenInFullscreen() {
    var i = input(fullscreen: true)
    i.strip = true
    XCTAssertTrue(eval(i).hidden)
  }

  func testHiddenWinsOverProminentAndHover() {
    XCTAssertTrue(eval(input(fullscreen: true, hovering: true, prominent: true)).hidden)
  }
}
