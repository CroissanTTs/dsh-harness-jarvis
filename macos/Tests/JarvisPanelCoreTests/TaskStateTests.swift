import XCTest
@testable import JarvisPanelCore

final class TaskStateTests: XCTestCase {
  private func session(task: String? = nil) throws -> SessionInfo {
    let field = task.map { ",\"task\":\($0)" } ?? ""
    let json = "{\"sessions\":[{\"id\":\"s\",\"title\":\"修复测试\",\"workspace\":\"app\"\(field)}]}"
    return try XCTUnwrap(JSONDecoder().decode(Snapshot.self, from: Data(json.utf8)).sessions.first)
  }

  // MARK: - 等价类

  func testDecodesAllOpenTaskStatesAndLabels() throws {
    for (raw, label) in [("open", "进行中"), ("judging", "判断中"), ("unsatisfied", "未完成")] {
      let s = try session(task: "{\"status\":\"\(raw)\",\"summary\":\"补齐边界测试\"}")
      XCTAssertEqual(s.task?.status.rawValue, raw)
      XCTAssertEqual(s.task?.status.label, label)
      XCTAssertEqual(s.task?.summary, "补齐边界测试")
      XCTAssertEqual(s.title, "修复测试")
      XCTAssertEqual(s.workspace, "app")
    }
  }

  @MainActor
  func testTargetOptionsCarryTaskWithoutChangingTitleOrSelection() async throws {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(sessions: [try session(task: #"{"status":"judging","summary":"验证结果"}"#)]))
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let model = PanelModel(api: api, store: SettingsStore(url: dir.appendingPathComponent("panel.json")))
    await model.refresh()
    XCTAssertNil(model.targets[0].task)
    XCTAssertEqual(model.targets[1].label, "修复测试")
    XCTAssertEqual(model.targets[1].task?.status.label, "判断中")
    model.selectTarget(number: 2)
    XCTAssertEqual(model.target, .session("s"))
  }

  func testTaskStateDemoHasEveryBadgeAndAnUnbadgedLongTitle() async throws {
    let api = DemoAPI()
    await api.setScene(7)
    let sessions = try await api.snapshot().sessions.filter(\.managed)
    XCTAssertEqual(sessions.compactMap { $0.task?.status }, [.open, .judging, .unsatisfied])
    XCTAssertTrue(sessions.contains { $0.task == nil && $0.title.count > 30 })
    XCTAssertTrue(sessions.contains { ($0.task?.summary?.count ?? 0) > 30 })
  }

  func testTaskStateDemoStillAllowsRemovingTheUnbadgedTarget() async throws {
    let api = DemoAPI()
    await api.setScene(7)
    let snapshot = try await api.snapshot()
    let s = try XCTUnwrap(snapshot.sessions.first { $0.managed && $0.task == nil })
    try await api.setManaged(session: s.id, managed: false)
    let updated = try await api.snapshot()
    XCTAssertEqual(updated.sessions.first { $0.id == s.id }?.managed, false)
  }

  // MARK: - 边界值

  func testMissingAndNullTaskHaveNoBadge() throws {
    XCTAssertNil(try session().task)
    XCTAssertNil(try session(task: "null").task)
    XCTAssertNil(SessionInfo(id: "s", title: "", status: .idle, unread: false).task)
  }

  func testMissingNullAndEmptySummaryKeepValidStatus() throws {
    for task in [#"{"status":"open"}"#, #"{"status":"open","summary":null}"#,
                 #"{"status":"open","summary":""}"#] {
      let info = try XCTUnwrap(session(task: task).task)
      XCTAssertEqual(info.status, .open)
      XCTAssertTrue(info.summary?.isEmpty ?? true)
    }
  }

  func testLongSummaryRemainsIntactForHover() throws {
    let summary = String(repeating: "长摘要🙂", count: 200)
    XCTAssertEqual(try session(task: "{\"status\":\"unsatisfied\",\"summary\":\"\(summary)\"}").task?.summary, summary)
  }

  // MARK: - 异常路径

  func testMalformedTaskDoesNotRejectSessionOrSnapshot() throws {
    for task in ["42", "true", #""open""#, "[]", "{}", #"{"status":null}"#,
                 #"{"status":42}"#, #"{"status":[]}"#, #"{"status":{}}"#,
                 #"{"status":"done"}"#, #"{"status":"dropped"}"#, #"{"status":"unknown"}"#,
                 #"{"status":""}"#, #"{"status":" open "}"#] {
      let s = try session(task: task)
      XCTAssertNil(s.task, task)
      XCTAssertEqual(s.id, "s")
    }
  }

  func testMalformedSummaryDropsTaskWithoutRejectingSnapshot() throws {
    for summary in ["42", "false", "[]", "{}"] {
      let s = try session(task: "{\"status\":\"judging\",\"summary\":\(summary)}")
      XCTAssertNil(s.task)
      XCTAssertEqual(s.id, "s")
    }
  }
}
