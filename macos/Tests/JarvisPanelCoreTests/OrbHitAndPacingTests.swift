import XCTest
import CoreGraphics
@testable import JarvisPanelCore

final class OrbHitAndPacingTests: XCTestCase {
  /// Orb window flush against the right edge of a 1440-wide screen.
  private let frame = CGRect(x: 1300, y: 400, width: 140, height: 140)
  private var center: CGPoint { CGPoint(x: frame.midX, y: frame.midY) }

  // MARK: - 等价类

  func testFreeOrbHitsInsideCircleOnly() {
    XCTAssertTrue(Placement.overOrb(center, frame: frame, strip: nil, stripOpen: false))
    XCTAssertFalse(Placement.overOrb(CGPoint(x: frame.maxX - 3, y: frame.maxY - 3), frame: frame, strip: nil, stripOpen: false))
  }

  func testCollapsedStripHitsOnlyTheStrip() {
    let onStrip = CGPoint(x: frame.maxX - 5, y: center.y)
    XCTAssertTrue(Placement.overOrb(onStrip, frame: frame, strip: .right, stripOpen: false))
    XCTAssertFalse(Placement.overOrb(center, frame: frame, strip: .right, stripOpen: false))
  }

  func testOpenedStripKeepsTheStripAreaSoItDoesNotBounce() {
    // On the strip but outside the orb circle: the cause of the open/collapse loop.
    let edgePoint = CGPoint(x: frame.maxX - 5, y: center.y + 40)
    XCTAssertGreaterThan(hypot(edgePoint.x - center.x, edgePoint.y - center.y), Placement.orbRadius)
    XCTAssertTrue(Placement.overOrb(edgePoint, frame: frame, strip: .right, stripOpen: false))
    XCTAssertTrue(Placement.overOrb(edgePoint, frame: frame, strip: .right, stripOpen: true))
  }

  func testOpenedCornerStripKeepsBothArms() {
    let tip = CGPoint(x: frame.maxX - 4, y: frame.maxY - 4)
    let topArm = CGPoint(x: frame.maxX - 80, y: frame.maxY - 4)
    for p in [tip, topArm] {
      XCTAssertTrue(Placement.overOrb(p, frame: frame, strip: .topRight, stripOpen: true), "\(p)")
    }
  }

  func testOpenedStripStillHitsTheWholeOrb() {
    let leftOfCenter = CGPoint(x: center.x - 50, y: center.y)
    XCTAssertTrue(Placement.overOrb(leftOfCenter, frame: frame, strip: .right, stripOpen: true))
  }

  func testPacingEquivalenceClasses() {
    XCTAssertEqual(FramePacing.fps(docked: false, motion: .idle, transitioning: false), 30)
    XCTAssertEqual(FramePacing.fps(docked: false, motion: .speaking, transitioning: false), 60)
    XCTAssertEqual(FramePacing.fps(docked: true, motion: .idle, transitioning: false), 20)
  }

  func testTransitionsAlwaysRunAtFullRate() {
    for docked in [false, true] {
      for motion in [OrbMotion.idle, .thinking, .error] {
        XCTAssertEqual(FramePacing.fps(docked: docked, motion: motion, transitioning: true), 60)
      }
    }
  }

  // MARK: - 边界值

  func testCircleBoundaryIsInclusive() {
    let onRim = CGPoint(x: center.x - Placement.orbRadius, y: center.y)
    let justOutside = CGPoint(x: center.x - Placement.orbRadius - 0.5, y: center.y)
    XCTAssertTrue(Placement.overOrb(onRim, frame: frame, strip: nil, stripOpen: false))
    XCTAssertFalse(Placement.overOrb(justOutside, frame: frame, strip: nil, stripOpen: false))
  }

  func testStripThicknessBoundary() {
    let inner = CGPoint(x: frame.maxX - 22, y: center.y)
    let beyond = CGPoint(x: frame.maxX - 22.5, y: center.y)
    XCTAssertTrue(Placement.overOrb(inner, frame: frame, strip: .right, stripOpen: false))
    XCTAssertFalse(Placement.overOrb(beyond, frame: frame, strip: .right, stripOpen: false))
  }

  func testStripSpanEndsAt120() {
    let top = CGPoint(x: frame.maxX - 5, y: center.y + 59.5)
    let past = CGPoint(x: frame.maxX - 5, y: center.y + 60.5)
    XCTAssertTrue(Placement.overOrb(top, frame: frame, strip: .right, stripOpen: false))
    XCTAssertFalse(Placement.overOrb(past, frame: frame, strip: .right, stripOpen: false))
  }

  func testTransitionOutlastsTheSlowestDeparture() {
    // assign() staggers departures by up to 0.3s + 0.25s.
    XCTAssertGreaterThan(FramePacing.transitionSeconds, 0.55)
  }

  // MARK: - 异常路径

  func testOpenFlagWithoutStripBehavesLikeFreeOrb() {
    let corner = CGPoint(x: frame.maxX - 3, y: frame.maxY - 3)
    XCTAssertFalse(Placement.overOrb(corner, frame: frame, strip: nil, stripOpen: true))
    XCTAssertTrue(Placement.overOrb(center, frame: frame, strip: nil, stripOpen: true))
  }

  func testFarAwayPointNeverHits() {
    let far = CGPoint(x: -10_000, y: 10_000)
    for edge in DockEdge.allCases {
      XCTAssertFalse(Placement.overOrb(far, frame: frame, strip: edge, stripOpen: true))
      XCTAssertFalse(Placement.overOrb(far, frame: frame, strip: edge, stripOpen: false))
    }
  }

  func testEveryEdgeHasAStripAreaInsideTheWindow() {
    for edge in DockEdge.allCases {
      let rects = Placement.stripRects(frame: frame, edge: edge)
      XCTAssertFalse(rects.isEmpty, "\(edge)")
      for r in rects { XCTAssertTrue(frame.contains(r), "\(edge) \(r)") }
    }
  }

  func testZeroSizeFrameDoesNotCrash() {
    let empty = CGRect(x: 10, y: 10, width: 0, height: 0)
    XCTAssertTrue(Placement.overOrb(CGPoint(x: 10, y: 10), frame: empty, strip: nil, stripOpen: false))
    _ = Placement.overOrb(CGPoint(x: 10, y: 10), frame: empty, strip: .topLeft, stripOpen: false)
  }
}
