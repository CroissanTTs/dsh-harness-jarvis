import XCTest
@testable import JarvisPanelCore

/// How close the orb must be before it docks, on a 1470×956 screen with a
/// 33pt menu bar and a 500pt Dock on the right.
final class SnapThresholdTests: XCTestCase {
  private let screen = CGRect(x: 0, y: 0, width: 1470, height: 956)
  private let visible = CGRect(x: 0, y: 0, width: 1391, height: 923)
  private var ws: Workspace { Workspace.make(screen: screen, visible: visible, dockLength: 500) }

  private func frame(_ x: CGFloat, _ y: CGFloat) -> CGRect { CGRect(x: x, y: y, width: 140, height: 140) }
  private func snap(_ x: CGFloat, _ y: CGFloat, notch: ClosedRange<CGFloat>? = nil) -> (origin: CGPoint, dock: DockEdge?) {
    Placement.snap(frame: frame(x, y), workspace: ws, notchX: notch)
  }

  // MARK: - 等价类

  func testPushedFlushAgainstTheEdgeDocksWithoutMoving() {
    let r = snap(0, 400)
    XCTAssertEqual(r.dock, .left)
    XCTAssertEqual(r.origin, CGPoint(x: 0, y: 400))
  }

  func testJustInsideTheThresholdMovesFlushToTheEdge() {
    let r = snap(6, 400)
    XCTAssertEqual(r.dock, .left)
    XCTAssertEqual(r.origin, CGPoint(x: 0, y: 400))
  }

  func testNearButNotAtTheEdgeStaysFree() {
    let r = snap(40, 400)
    XCTAssertNil(r.dock)
    XCTAssertEqual(r.origin, CGPoint(x: 40, y: 400))
  }

  func testMiddleOfTheScreenStaysFree() {
    XCTAssertNil(snap(600, 400).dock)
  }

  // MARK: - 边界值

  func testThresholdIsInclusiveOnEveryEdge() {
    XCTAssertEqual(snap(10, 400).dock, .left)
    XCTAssertNil(snap(11, 400).dock)
    XCTAssertEqual(snap(600, 10).dock, .bottom)
    XCTAssertNil(snap(600, 11).dock)
    // Top: window top at 923 - 10.
    XCTAssertEqual(snap(600, 773).dock, .top)
    XCTAssertNil(snap(600, 772).dock)
    // Right, above the Dock's end (y 728) so the screen edge counts: window right at 1470 - 10.
    XCTAssertEqual(snap(1320, 760).dock, .right)
    XCTAssertNil(snap(1319, 760).dock)
  }

  func testCornerNeedsBothEdgesWithinTheThreshold() {
    let r = snap(8, 11)
    XCTAssertEqual(r.dock, .left)
    XCTAssertEqual(r.origin, CGPoint(x: 0, y: 11))
    XCTAssertEqual(snap(8, 8).dock, .bottomLeft)
  }

  func testBesideTheDockTheThresholdCountsFromTheDock() {
    // Dock inner side at x 1391.
    XCTAssertEqual(snap(1241, 400).dock, .right)
    XCTAssertNil(snap(1240, 400).dock)
  }

  // MARK: - 异常路径

  func testReportedCaseSixteenPointsBelowTheMenuBarDoesNotDock() {
    // The window sat 16pt under the menu bar yet was marked as docked to the top.
    let r = snap(1292, 767)
    XCTAssertNil(r.dock)
    XCTAssertEqual(r.origin, CGPoint(x: 1292, y: 767))
  }

  func testDraggedPastTheEdgeIsClampedAndDocked() {
    let r = snap(-80, 400)
    XCTAssertEqual(r.dock, .left)
    XCTAssertEqual(r.origin, CGPoint(x: 0, y: 400))
  }

  func testFlushUnderTheNotchNeverDocksToTheTop() {
    let r = snap(650, 783, notch: 620...820)
    XCTAssertNil(r.dock)
    XCTAssertEqual(r.origin, CGPoint(x: 650, y: 783))
  }
}
