import XCTest
@testable import JarvisPanelCore

/// Snapping against the Dock's own footprint instead of the whole Dock edge.
final class WorkspaceTests: XCTestCase {
  private let screen = CGRect(x: 0, y: 0, width: 1470, height: 956)
  /// Dock on the right (79pt) and a 33pt menu bar.
  private let rightVisible = CGRect(x: 0, y: 0, width: 1391, height: 923)
  private let bottomVisible = CGRect(x: 0, y: 70, width: 1470, height: 853)

  private func frame(_ x: CGFloat, _ y: CGFloat) -> CGRect { CGRect(x: x, y: y, width: 140, height: 140) }

  private var rightDock: Workspace { Workspace.make(screen: screen, visible: rightVisible, dockLength: 500) }

  // MARK: 等价类

  func testRightDockFootprintIsCenteredOnItsEdge() {
    let ws = rightDock
    XCTAssertEqual(ws.bounds, CGRect(x: 0, y: 0, width: 1470, height: 923))
    XCTAssertEqual(ws.dock, CGRect(x: 1391, y: 228, width: 79, height: 500))
  }

  func testTopRightCornerIsReachableBesideRightDock() {
    let r = Placement.snap(frame: frame(1300, 770), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 1330, y: 783))
    XCTAssertEqual(r.dock, .topRight)
  }

  func testBottomRightCornerIsReachableBesideRightDock() {
    let r = Placement.snap(frame: frame(1300, 15), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 1330, y: 0))
    XCTAssertEqual(r.dock, .bottomRight)
  }

  func testRightEdgeBesideDockStopsAtDock() {
    let r = Placement.snap(frame: frame(1230, 400), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 1251, y: 400))
    XCTAssertEqual(r.dock, .right)
  }

  func testBeyondSnapDistanceFromDockStaysPut() {
    let r = Placement.snap(frame: frame(1200, 400), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 1200, y: 400))
    XCTAssertNil(r.dock)
  }

  func testBottomLeftCornerIsReachableBesideBottomDock() {
    let ws = Workspace.make(screen: screen, visible: bottomVisible, dockLength: 600)
    let r = Placement.snap(frame: frame(20, 20), workspace: ws, notchX: nil)
    XCTAssertEqual(r.origin, .zero)
    XCTAssertEqual(r.dock, .bottomLeft)
  }

  func testBottomEdgeAboveBottomDockStopsAtDock() {
    let ws = Workspace.make(screen: screen, visible: bottomVisible, dockLength: 600)
    let r = Placement.snap(frame: frame(600, 90), workspace: ws, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 600, y: 70))
    XCTAssertEqual(r.dock, .bottom)
  }

  // MARK: 边界值

  func testPartialOverlapWithDockEndStillAvoidsDock() {
    // Orb spans y 700…840 and the Dock ends at 728.
    let r = Placement.snap(frame: frame(1300, 700), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin.x, 1251)
    XCTAssertEqual(r.dock, .right)
  }

  func testTouchingDockEndCountsAsClear() {
    // Orb spans y 728…868, exactly where the Dock ends.
    let r = Placement.snap(frame: frame(1320, 728), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin.x, 1330)
  }

  func testDockLengthIsClampedToTheEdge() {
    let ws = Workspace.make(screen: screen, visible: rightVisible, dockLength: 5000)
    XCTAssertEqual(ws.dock, CGRect(x: 1391, y: 0, width: 79, height: 923))
  }

  func testUnknownDockLengthBlocksTheWholeEdge() {
    let ws = Workspace.make(screen: screen, visible: rightVisible, dockLength: nil)
    let r = Placement.snap(frame: frame(1300, 770), workspace: ws, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 1251, y: 783))
  }

  func testNoDockInsetMeansNoObstacle() {
    let ws = Workspace.make(screen: screen, visible: CGRect(x: 0, y: 0, width: 1470, height: 923), dockLength: 500)
    XCTAssertNil(ws.dock)
  }

  // MARK: 异常路径

  func testReleasedOnTopOfDockIsPushedOut() {
    let r = Placement.snap(frame: frame(1360, 400), workspace: rightDock, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 1251, y: 400))
    XCTAssertEqual(r.dock, .right)
  }

  func testClampDuringDragAllowsCornerButNotDock() {
    XCTAssertEqual(Placement.clampOrigin(frame: frame(1400, 900), workspace: rightDock), CGPoint(x: 1330, y: 783))
    XCTAssertEqual(Placement.clampOrigin(frame: frame(1400, 400), workspace: rightDock), CGPoint(x: 1251, y: 400))
  }

  func testLegacySnapMatchesWorkspaceWithoutDock() {
    let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
    let ws = Workspace(bounds: visible, dock: nil)
    for f in [frame(1280, 400), frame(1280, 715), frame(600, 400), frame(-50, -30)] {
      let a = Placement.snap(frame: f, visible: visible, notchX: nil)
      let b = Placement.snap(frame: f, workspace: ws, notchX: nil)
      XCTAssertEqual(a.origin, b.origin)
      XCTAssertEqual(a.dock, b.dock)
    }
  }
}
