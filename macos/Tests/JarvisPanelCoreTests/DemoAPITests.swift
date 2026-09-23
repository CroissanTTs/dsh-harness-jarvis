import XCTest
@testable import JarvisPanelCore

final class DemoAPITests: XCTestCase {
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
    await api.setScene(9)
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
