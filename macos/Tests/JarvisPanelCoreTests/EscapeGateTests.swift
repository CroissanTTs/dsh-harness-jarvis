import XCTest
@testable import JarvisPanelCore

final class EscapeGateTests: XCTestCase {
  private let window = EscapeGate.window

  // MARK: - 等价类

  func testFirstPressOnlyHints() {
    var gate = EscapeGate()
    XCTAssertEqual(gate.press(at: 10), .hint)
  }

  func testSecondPressInsideTheWindowCloses() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    XCTAssertEqual(gate.press(at: 10.3), .close)
  }

  func testSecondPressAfterTheWindowHintsAgain() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    XCTAssertEqual(gate.press(at: 12), .hint)
    XCTAssertEqual(gate.press(at: 12.2), .close)
  }

  // MARK: - 边界值

  func testExactlyAtTheWindowStillCloses() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    XCTAssertEqual(gate.press(at: 10 + window), .close)
  }

  func testJustPastTheWindowHints() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    XCTAssertEqual(gate.press(at: 10 + window + 0.001), .hint)
  }

  func testThirdPressAfterClosingStartsOver() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    _ = gate.press(at: 10.1)
    XCTAssertEqual(gate.press(at: 10.2), .hint)
  }

  func testSamePressTimeCountsAsDouble() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    XCTAssertEqual(gate.press(at: 10), .close)
  }

  // MARK: - 异常路径

  func testResetForgetsTheFirstPress() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    gate.reset()
    XCTAssertEqual(gate.press(at: 10.1), .hint)
  }

  func testClockGoingBackwardsNeverCloses() {
    var gate = EscapeGate()
    _ = gate.press(at: 10)
    XCTAssertEqual(gate.press(at: 9.9), .hint)
  }
}

@MainActor
final class EscapeToCloseTests: XCTestCase {
  private var dir: URL!
  private var model: PanelModel!

  override func setUp() async throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    model = PanelModel(api: FakeAPI(), store: SettingsStore(url: dir.appendingPathComponent("panel.json")))
    await model.refresh()
    model.openQuickBar()
  }

  override func tearDown() async throws {
    try? FileManager.default.removeItem(at: dir)
  }

  // MARK: - 等价类

  func testOneEscKeepsTheBarOpenAndShowsTheHint() {
    model.draft = "写了一半"
    model.escapePressed(at: 1)
    XCTAssertTrue(model.quickBarOpen)
    XCTAssertTrue(model.escapeHint)
    XCTAssertEqual(model.draft, "写了一半")
  }

  func testDoubleEscClosesAndKeepsTheDraft() {
    model.draft = "写了一半"
    model.escapePressed(at: 1)
    model.escapePressed(at: 1.4)
    XCTAssertFalse(model.quickBarOpen)
    XCTAssertFalse(model.escapeHint)
    model.openQuickBar()
    XCTAssertEqual(model.draft, "写了一半")
  }

  // MARK: - 边界值

  func testSlowSecondEscOnlyHintsAgain() {
    model.escapePressed(at: 1)
    model.escapePressed(at: 1 + EscapeGate.window + 0.1)
    XCTAssertTrue(model.quickBarOpen)
    XCTAssertTrue(model.escapeHint)
  }

  func testHintDisappearsAfterTheWindow() async throws {
    model.escapePressed()
    XCTAssertTrue(model.escapeHint)
    try await Task.sleep(for: .seconds(EscapeGate.window + 0.2))
    XCTAssertFalse(model.escapeHint)
    XCTAssertTrue(model.quickBarOpen)
  }

  // MARK: - 异常路径

  func testReopeningNeedsTwoPressesAgain() {
    model.escapePressed(at: 1)
    model.closeQuickBar()
    model.openQuickBar()
    XCTAssertFalse(model.escapeHint)
    model.escapePressed(at: 1.2)
    XCTAssertTrue(model.quickBarOpen)
  }

  func testEscWhileClosedDoesNothing() {
    model.closeQuickBar()
    model.escapePressed(at: 1)
    model.escapePressed(at: 1.1)
    XCTAssertFalse(model.escapeHint)
    model.openQuickBar()
    model.escapePressed(at: 1.2)
    XCTAssertTrue(model.quickBarOpen)
  }
}
