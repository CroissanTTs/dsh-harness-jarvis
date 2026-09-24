import XCTest
@testable import JarvisPanelCore

final class LogRotationTests: XCTestCase {
  // MARK: - 等价类
  func testRotatesOnlyOversizedLogs() {
    XCTAssertTrue(LogRotation.shouldRotate(size: 2_000_000))
    XCTAssertFalse(LogRotation.shouldRotate(size: 500_000))
  }

  func testChecksEveryHundredSuccessfulWrites() {
    var rotation = LogRotation()
    for index in 1...300 {
      XCTAssertEqual(rotation.recordWrite(), index % 100 == 0)
    }
  }

  // MARK: - 边界值
  func testExactLimitAndOneByteOver() {
    XCTAssertFalse(LogRotation.shouldRotate(size: 1_048_576))
    XCTAssertTrue(LogRotation.shouldRotate(size: 1_048_577))
    XCTAssertFalse(LogRotation.shouldRotate(size: 0))
  }

  func testCustomLimitAndZeroLimit() {
    XCTAssertFalse(LogRotation.shouldRotate(size: 10, limit: 10))
    XCTAssertTrue(LogRotation.shouldRotate(size: 11, limit: 10))
    XCTAssertTrue(LogRotation.shouldRotate(size: 1, limit: 0))
  }

  // MARK: - 异常路径
  func testInvalidSizesAndLimitsNeverRotate() {
    XCTAssertFalse(LogRotation.shouldRotate(size: -1))
    XCTAssertFalse(LogRotation.shouldRotate(size: 100, limit: -1))
  }
}
