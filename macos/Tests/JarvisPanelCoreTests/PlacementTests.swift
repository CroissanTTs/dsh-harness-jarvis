import XCTest
import CoreGraphics
@testable import JarvisPanelCore

final class PlacementTests: XCTestCase {
  private let visible = CGRect(x: 0, y: 0, width: 1440, height: 875)
  private let listSize = CGSize(width: 110, height: 60)
  private let capsuleSize = CGSize(width: 150, height: 22)

  private func hover(_ x: CGFloat, _ y: CGFloat) -> HoverLayout {
    Placement.hover(center: CGPoint(x: x, y: y), visible: visible, buttonCount: 2,
                    listSize: listSize, capsuleSize: capsuleSize)
  }

  private func buttonRects(_ l: HoverLayout) -> [CGRect] {
    l.buttons.map { CGRect(x: $0.x - 15, y: $0.y - 15, width: 30, height: 30) }
  }

  private func readoutRect(_ l: HoverLayout) -> CGRect? {
    switch l.readout {
    case .list(let r), .capsule(let r): return r
    case .none: return nil
    }
  }

  private func assertFitsAndSeparate(_ l: HoverLayout, file: StaticString = #filePath, line: UInt = #line) {
    for r in buttonRects(l) {
      XCTAssertTrue(visible.contains(r), "button \(r) outside", file: file, line: line)
    }
    if let rr = readoutRect(l) {
      XCTAssertTrue(visible.contains(rr), "readout \(rr) outside", file: file, line: line)
      for b in buttonRects(l) {
        XCTAssertFalse(b.intersects(rr), "button \(b) overlaps readout \(rr)", file: file, line: line)
      }
    }
  }

  // MARK: Hover layer

  func testCenterOfScreenUsesFullLayout() {
    let l = hover(720, 437)
    XCTAssertEqual(l.side, .left)
    XCTAssertTrue(l.buttons.allSatisfy { $0.x < 720 })
    guard case .list(let r) = l.readout else { return XCTFail("expected list") }
    XCTAssertEqual(r.minX, 720 + 58)
    XCTAssertGreaterThan(l.badge.x, 720)
    assertFitsAndSeparate(l)
  }

  func testButtonsAreSymmetricAroundHorizontal() {
    let l = hover(720, 437)
    XCTAssertEqual(l.buttons.count, 2)
    XCTAssertEqual(l.buttons[0].y - 437, 437 - l.buttons[1].y, accuracy: 0.001)
    XCTAssertGreaterThan(l.buttons[0].y, l.buttons[1].y, "first button (voice) is on top")
    let angle = atan2(l.buttons[0].y - 437, l.buttons[0].x - 720) * 180 / .pi
    XCTAssertEqual(angle, 165, accuracy: 0.001)
  }

  func testRightEdgeLowerHalfUsesCapsuleAbove() {
    let l = hover(1370, 300)
    XCTAssertEqual(l.side, .left)
    guard case .capsule(let r) = l.readout else { return XCTFail("expected capsule") }
    XCTAssertEqual(r.minY, 300 + 60 + 8)
    XCTAssertEqual(r.maxX, 1370 + 56)
    XCTAssertLessThan(l.badge.x, 1370, "badge sits on the inner side")
    assertFitsAndSeparate(l)
  }

  func testTopRightCornerUsesCapsuleBelow() {
    let l = hover(1370, 805)
    guard case .capsule(let r) = l.readout else { return XCTFail("expected capsule") }
    XCTAssertEqual(r.maxY, 805 - 60 - 8)
    assertFitsAndSeparate(l)
  }

  func testBottomLeftCornerMirrors() {
    let l = hover(70, 70)
    XCTAssertEqual(l.side, .right)
    XCTAssertTrue(l.buttons.allSatisfy { $0.x > 70 })
    guard case .capsule(let r) = l.readout else { return XCTFail("expected capsule") }
    XCTAssertEqual(r.minX, 70 - 56)
    XCTAssertEqual(r.minY, 70 + 60 + 8)
    assertFitsAndSeparate(l)
  }

  func testEveryEdgeAndCornerFits() {
    let xs: [CGFloat] = [70, 720, 1370]
    let ys: [CGFloat] = [70, 437, 805]
    for x in xs {
      for y in ys {
        assertFitsAndSeparate(hover(x, y))
      }
    }
  }

  func testNoRoomAnywhereDropsReadout() {
    let tiny = CGRect(x: 0, y: 0, width: 320, height: 150)
    let l = Placement.hover(center: CGPoint(x: 250, y: 75), visible: tiny, buttonCount: 2,
                            listSize: listSize, capsuleSize: capsuleSize)
    XCTAssertEqual(l.readout, .none)
  }

  // MARK: Snap

  private func frame(_ x: CGFloat, _ y: CGFloat) -> CGRect {
    CGRect(x: x, y: y, width: 140, height: 140)
  }

  func testSnapToRightEdge() {
    let r = Placement.snap(frame: frame(1280, 400), visible: visible, notchX: nil)
    XCTAssertEqual(r.dock, .right)
    XCTAssertEqual(r.origin, CGPoint(x: 1300, y: 400))
  }

  func testSnapToTopRightCorner() {
    let r = Placement.snap(frame: frame(1280, 715), visible: visible, notchX: nil)
    XCTAssertEqual(r.dock, .topRight)
    XCTAssertEqual(r.origin, CGPoint(x: 1300, y: 735))
  }

  func testNoSnapInTheMiddle() {
    let r = Placement.snap(frame: frame(600, 400), visible: visible, notchX: nil)
    XCTAssertNil(r.dock)
    XCTAssertEqual(r.origin, CGPoint(x: 600, y: 400))
  }

  func testTopEdgeUnderNotchDoesNotDock() {
    let r = Placement.snap(frame: frame(650, 720), visible: visible, notchX: 620...820)
    XCTAssertNil(r.dock)
    XCTAssertEqual(r.origin, CGPoint(x: 650, y: 720))
  }

  func testTopEdgeAwayFromNotchDocks() {
    let r = Placement.snap(frame: frame(200, 720), visible: visible, notchX: 620...820)
    XCTAssertEqual(r.dock, .top)
    XCTAssertEqual(r.origin.y, 735)
  }

  func testDraggedOffscreenIsClampedAndCornerDocked() {
    let r = Placement.snap(frame: frame(-50, -30), visible: visible, notchX: nil)
    XCTAssertEqual(r.origin, CGPoint(x: 0, y: 0))
    XCTAssertEqual(r.dock, .bottomLeft)
  }

  func testSnapBoundaryIsInclusive() {
    XCTAssertEqual(Placement.snap(frame: frame(1270, 400), visible: visible, notchX: nil).dock, .right)
    XCTAssertNil(Placement.snap(frame: frame(1269, 400), visible: visible, notchX: nil).dock)
  }

  // MARK: Quick bar

  func testQuickBarAtRightEdgeOpensLeftAndGrowsUpInLowerHalf() {
    let l = Placement.quickBar(center: CGPoint(x: 1370, y: 300), visible: visible, barSize: CGSize(width: 330, height: 38))
    XCTAssertEqual(l.side, .left)
    XCTAssertEqual(l.bar.maxX, 1370 - 72)
    XCTAssertEqual(l.bar.midY, 300)
    XCTAssertTrue(l.growsUp)
    XCTAssertEqual(l.stackLimit, 875 - l.bar.maxY - 6)
  }

  func testQuickBarInUpperHalfGrowsDown() {
    let l = Placement.quickBar(center: CGPoint(x: 1370, y: 805), visible: visible, barSize: CGSize(width: 330, height: 38))
    XCTAssertFalse(l.growsUp)
    XCTAssertEqual(l.stackLimit, l.bar.minY - 6)
  }

  func testQuickBarIsClampedVertically() {
    let l = Placement.quickBar(center: CGPoint(x: 200, y: 10), visible: visible, barSize: CGSize(width: 330, height: 38))
    XCTAssertEqual(l.side, .right)
    XCTAssertEqual(l.bar.minX, 200 + 72)
    XCTAssertEqual(l.bar.minY, 4)
  }
}
