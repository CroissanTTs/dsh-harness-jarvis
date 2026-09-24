import XCTest
@testable import JarvisPanelCore

final class AutoApprovalPlacementTests: XCTestCase {
  // MARK: - 等价类
  func testCardStaysInsideScreenAndClearOfControlsAtEdges() {
    let visible = CGRect(x: 0, y: 0, width: 1440, height: 900)
    for center in [CGPoint(x: 70, y: 70), CGPoint(x: 1370, y: 830), CGPoint(x: 720, y: 450)] {
      let hover = Placement.hover(center: center, visible: visible, buttonCount: 3,
        listSize: CGSize(width: 110, height: 80), capsuleSize: CGSize(width: 220, height: 28))
      let card = Placement.autoApprovals(center: center, visible: visible, hover: hover, count: 5)
      XCTAssertTrue(visible.contains(card))
      for button in hover.buttons {
        XCTAssertFalse(card.intersects(CGRect(x: button.x - 15, y: button.y - 15, width: 30, height: 30)))
      }
      switch hover.readout {
      case .list(let rect), .capsule(let rect): XCTAssertFalse(card.intersects(rect))
      case .none: break
      }
    }
  }
  // MARK: - 边界值
  func testHeightCapsAtFiveEntries() {
    let visible = CGRect(x: 0, y: 0, width: 1440, height: 900)
    let center = CGPoint(x: 720, y: 450)
    let hover = Placement.hover(center: center, visible: visible, buttonCount: 2, listSize: .zero, capsuleSize: .zero)
    XCTAssertEqual(Placement.autoApprovals(center: center, visible: visible, hover: hover, count: 5),
                   Placement.autoApprovals(center: center, visible: visible, hover: hover, count: 6))
  }
  // MARK: - 异常路径
  func testShortScreenClampsHeight() {
    let visible = CGRect(x: 0, y: 0, width: 800, height: 250)
    let center = CGPoint(x: 70, y: 100)
    let hover = Placement.hover(center: center, visible: visible, buttonCount: 2, listSize: .zero, capsuleSize: .zero)
    XCTAssertTrue(visible.contains(Placement.autoApprovals(center: center, visible: visible, hover: hover, count: 5)))
  }
}
