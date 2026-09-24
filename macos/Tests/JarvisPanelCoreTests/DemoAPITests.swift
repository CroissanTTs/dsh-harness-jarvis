import XCTest
@testable import JarvisPanelCore

final class DemoAPITests: XCTestCase {
  // MARK: - 等价类
  func testAutoApprovalSceneIncludesAllTiersAndRevocableRule() async throws {
    let api = DemoAPI()
    await api.setScene(9)
    let snapshot = try await api.snapshot()
    XCTAssertEqual(snapshot.autoApprovals.count, 5)
    XCTAssertEqual(snapshot.autoApprovals.map(\.command), ["npm install", "git diff --stat", "npm test", "package.json", "touch build.txt"])
    XCTAssertEqual(snapshot.autoApprovals.map(\.tier), [.medium, .safe, .grey, .safe, .medium])
    let rule = try XCTUnwrap(snapshot.autoApprovals.first(where: { $0.rule != nil })?.rule)
    XCTAssertEqual(rule.fingerprint, "shell:npm-install")
    XCTAssertEqual(rule.tool, "shell")
    try await api.removeApprovalRule(rule)
    let refreshed = try await api.snapshot()
    XCTAssertEqual(refreshed.autoApprovals.count, 5)
    XCTAssertTrue(refreshed.autoApprovals.allSatisfy { $0.rule == nil })
  }

  func testPresetSceneCanSaveAndDeleteRule() async throws {
    let api = DemoAPI()
    await api.setScene(8)
    let snapshot = try await api.snapshot()
    let item = try XCTUnwrap(snapshot.pending.first(where: { $0.canAlwaysAllow }))
    try await api.answer(.always(id: item.id))
    let rules = try await api.approvalRules()
    XCTAssertEqual(rules.count, 1)
    try await api.removeApprovalRule(try XCTUnwrap(rules.first).identity)
    let remaining = try await api.approvalRules()
    XCTAssertTrue(remaining.isEmpty)
  }

  // MARK: - 异常路径
  func testDemoRejectsAlwaysForRiskyApproval() async throws {
    let api = DemoAPI()
    await api.setScene(4)
    do {
      try await api.answer(.always(id: "demo-p1"))
      XCTFail("expected 400")
    } catch { XCTAssertEqual(error as? JarvisAPIError, .http(400)) }
  }

  // MARK: - 边界值
  func testCyclesByTime() async throws {
    let start = Date().addingTimeInterval(-DemoAPI.scenePeriod * 3 - 1)
    let s = try await DemoAPI(start: start).snapshot()
    XCTAssertEqual(s.activity, .speaking)
    XCTAssertTrue(s.voice.speaking)
  }

  func testPinnedSceneOverridesClock() async throws {
    let api = DemoAPI()
    await api.setScene(4)
    let s = try await api.snapshot()
    XCTAssertEqual(s.pending.count, 2)
    XCTAssertEqual(s.counts.pending, 2)
  }

  func testPinnedFailedScene() async throws {
    let api = DemoAPI()
    await api.setScene(5)
    let s = try await api.snapshot()
    XCTAssertEqual(s.counts.failed, 1)
    XCTAssertEqual(s.sessions.first?.status, .failed)
  }

  func testOutOfRangeSceneWraps() async throws {
    let api = DemoAPI()
    await api.setScene(22)
    let s = try await api.snapshot()
    XCTAssertEqual(s.activity, .thinking)
  }

  func testNarratingSceneIsAnotherSessionsVoice() async throws {
    let api = DemoAPI()
    await api.setScene(6)
    let s = try await api.snapshot()
    XCTAssertEqual(s.activity, .speaking)
    XCTAssertEqual(s.voice.source, .session)
    XCTAssertEqual(s.voice.sessionId, "demo-docs")
  }

  func testUnpinReturnsToClock() async throws {
    let api = DemoAPI(start: Date())
    await api.setScene(3)
    await api.setScene(nil)
    let s = try await api.snapshot()
    XCTAssertEqual(s.activity, .idle)
  }

  func testAnsweringTwiceFails() async throws {
    let api = DemoAPI()
    await api.setScene(4)
    try await api.answer(.decision(id: "demo-p1", allow: true))
    do {
      try await api.answer(.decision(id: "demo-p1", allow: true))
      XCTFail("expected 404")
    } catch JarvisAPIError.http(let code) {
      XCTAssertEqual(code, 404)
    }
    let s = try await api.snapshot()
    XCTAssertEqual(s.pending.map(\.id), ["demo-p2"])
  }
}
