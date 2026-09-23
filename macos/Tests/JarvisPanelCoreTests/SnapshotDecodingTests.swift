import XCTest
@testable import JarvisPanelCore

final class SnapshotDecodingTests: XCTestCase {
  private func decode(_ json: String) throws -> Snapshot {
    try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
  }

  func testFullSnapshot() throws {
    let s = try decode("""
    {
      "agentId": "jv",
      "activity": "thinking",
      "error": null,
      "voice": { "speaking": false, "muted": true },
      "counts": { "running": 2, "pending": 1, "unread": 1, "failed": 0 },
      "sessions": [{ "id": "s1", "title": "贾维斯-hammer", "status": "running", "unread": true }],
      "pending": [{ "id": "p1", "kind": "approval", "session": "s1", "title": "请求执行",
                    "detail": "rm -rf node_modules", "note": "重装依赖", "choices": [] }]
    }
    """)
    XCTAssertEqual(s.agentId, "jv")
    XCTAssertEqual(s.activity, .thinking)
    XCTAssertNil(s.error)
    XCTAssertEqual(s.voice, VoiceState(speaking: false, muted: true))
    XCTAssertEqual(s.counts, Counts(running: 2, pending: 1, unread: 1, failed: 0))
    XCTAssertEqual(s.sessions, [SessionInfo(id: "s1", title: "贾维斯-hammer", status: .running, unread: true)])
    XCTAssertEqual(s.pending.first?.kind, .approval)
    XCTAssertEqual(s.pending.first?.detail, "rm -rf node_modules")
  }

  func testLegacyHostSnapshot() throws {
    let s = try decode(#"{"agentId":"a","managed":["s1"],"speaking":true}"#)
    XCTAssertEqual(s.activity, .speaking)
    XCTAssertTrue(s.voice.speaking)
    XCTAssertEqual(s.sessions.map(\.id), ["s1"])
    XCTAssertEqual(s.sessions.first?.status, .idle)
    XCTAssertEqual(s.counts, Counts())
    XCTAssertTrue(s.pending.isEmpty)
  }

  func testUnknownEnumValuesFallBack() throws {
    let s = try decode("""
    {"agentId":"a","activity":"dreaming",
     "sessions":[{"id":"s1","title":"x","status":"exploding"}],
     "pending":[{"id":"p","kind":"survey","session":"s1","title":"t"}]}
    """)
    XCTAssertEqual(s.activity, .idle)
    XCTAssertEqual(s.sessions.first?.status, .idle)
    XCTAssertEqual(s.pending.first?.kind, .question)
    XCTAssertEqual(s.pending.first?.choices, [])
  }

  func testVoiceQueueFields() throws {
    let s = try decode(#"{"voice":{"speaking":false,"muted":false,"paused":true,"queued":3}}"#)
    XCTAssertEqual(s.voice, VoiceState(paused: true, queued: 3))
    XCTAssertNil(s.voice.source)
    XCTAssertTrue(s.voice.active)
  }

  func testNegativeQueueClampsToZero() throws {
    let s = try decode(#"{"voice":{"queued":-2}}"#)
    XCTAssertEqual(s.voice.queued, 0)
    XCTAssertFalse(s.voice.active)
  }

  func testEmptyObjectDecodes() throws {
    let s = try decode("{}")
    XCTAssertEqual(s.agentId, "")
    XCTAssertEqual(s.activity, .idle)
  }

  func testMessagesFilterToolAndFillIDs() throws {
    let data = Data("""
    {"messages":[
      {"role":"user","text":"hi"},
      {"role":"tool","text":"result"},
      {"id":"m9","role":"assistant","text":"好的","routedTo":"s1"},
      {"role":"assistant","text":""}
    ],"count":4}
    """.utf8)
    let msgs = try ChatMessages.decode(data)
    XCTAssertEqual(msgs.map(\.text), ["hi", "好的"])
    XCTAssertEqual(msgs[0].id, "m0")
    XCTAssertEqual(msgs[1].id, "m9")
    XCTAssertEqual(msgs[1].routedTo, "s1")
  }

  func testShortName() {
    XCTAssertEqual(SessionInfo(id: "s", title: "贾维斯-hammer", status: .idle, unread: false).shortName, "hammer")
    XCTAssertEqual(SessionInfo(id: "s", title: "[贾维斯] anvil", status: .idle, unread: false).shortName, "anvil")
    XCTAssertEqual(SessionInfo(id: "abcdefghijkl", title: "", status: .idle, unread: false).shortName, "efghijkl")
    XCTAssertEqual(SessionInfo(id: "s", title: "docs", status: .idle, unread: false).shortName, "docs")
  }
}
