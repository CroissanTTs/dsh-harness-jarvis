import XCTest
@testable import JarvisPanelCore

final class SeededRandomTests: XCTestCase {
  func testSameSeedSameSequence() {
    var a = SeededRandom(seed: 42)
    var b = SeededRandom(seed: 42)
    XCTAssertEqual((0..<5).map { _ in a.next() }, (0..<5).map { _ in b.next() })
  }

  func testDifferentSeedsDiffer() {
    var a = SeededRandom(seed: 1)
    var b = SeededRandom(seed: 2)
    XCTAssertNotEqual(a.next(), b.next())
  }

  func testUnitInRange() {
    var r = SeededRandom(seed: 1)
    for _ in 0..<1000 {
      let u = r.unit()
      XCTAssert(u >= 0 && u < 1)
    }
  }

  func testRangeBounds() {
    var r = SeededRandom(seed: 7)
    for _ in 0..<1000 {
      let v = r.range(10, 28)
      XCTAssert(v >= 10 && v < 28)
    }
  }
}
