import XCTest
@testable import JarvisPanelCore

final class MessagePreviewTests: XCTestCase {
  private let chars = ChatMessage.previewCharacters
  private let lines = ChatMessage.previewLines

  private func lineBlock(_ n: Int) -> String { (1...n).map { "第\($0)行" }.joined(separator: "\n") }

  // MARK: - 等价类

  func testShortTextIsUnchanged() {
    XCTAssertEqual(ChatMessage.preview("lint 通过，改了 2 个文件。"), "lint 通过，改了 2 个文件。")
  }

  func testLongSingleParagraphIsCutToTheCharacterLimit() {
    let p = ChatMessage.preview(String(repeating: "报", count: 6000))
    XCTAssertEqual(p, String(repeating: "报", count: chars) + "…")
  }

  func testManyShortLinesAreCutToTheLineLimit() {
    let p = ChatMessage.preview(lineBlock(40))
    XCTAssertEqual(p, lineBlock(lines) + "…")
  }

  func testMessagePreviewUsesItsText() {
    let m = ChatMessage(id: "a", role: "assistant", text: String(repeating: "x", count: 1000))
    XCTAssertEqual(m.preview.count, chars + 1)
  }

  // MARK: - 边界值

  func testExactlyAtTheCharacterLimitIsUnchanged() {
    let s = String(repeating: "a", count: chars)
    XCTAssertEqual(ChatMessage.preview(s), s)
    XCTAssertEqual(ChatMessage.preview(s + "b"), s + "…")
  }

  func testExactlyAtTheLineLimitIsUnchanged() {
    XCTAssertEqual(ChatMessage.preview(lineBlock(lines)), lineBlock(lines))
    XCTAssertEqual(ChatMessage.preview(lineBlock(lines + 1)), lineBlock(lines) + "…")
  }

  func testBothLimitsApplyTogether() {
    let long = String(repeating: "长", count: chars)
    let p = ChatMessage.preview(long + "\n" + lineBlock(lines + 5))
    XCTAssertEqual(p, long + "…")
  }

  func testEmptyTextStaysEmpty() {
    XCTAssertEqual(ChatMessage.preview(""), "")
  }

  // MARK: - 异常路径

  func testEmojiAndCombiningCharactersAreNeverSplit() {
    let family = "👨‍👩‍👧‍👦"
    let p = ChatMessage.preview(String(repeating: family, count: chars + 10))
    XCTAssertEqual(p, String(repeating: family, count: chars) + "…")
  }

  func testWindowsLineEndingsCountAsLines() {
    let crlf = (1...20).map { "r\($0)" }.joined(separator: "\r\n")
    let p = ChatMessage.preview(crlf)
    XCTAssertEqual(p, (1...lines).map { "r\($0)" }.joined(separator: "\n") + "…")
  }

  func testTrailingBlankLinesBeforeTheCutAreTrimmed() {
    let s = "开头\n" + String(repeating: "\n", count: 20) + "结尾"
    XCTAssertEqual(ChatMessage.preview(s), "开头…")
  }
}
