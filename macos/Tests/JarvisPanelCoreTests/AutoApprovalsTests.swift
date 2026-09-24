import XCTest
@testable import JarvisPanelCore

@MainActor
final class AutoApprovalsTests: XCTestCase {
  private let rule = ApprovalRule(fingerprint: "fp|1", tool: "shell", workspace: "/repo with spaces/", createdAt: 0).identity
  private func entry(_ id: String = "a", at: Double = 1000, rule: ApprovalRule.Identity? = nil) -> AutoApproval {
    AutoApproval(id: id, session: "s", title: "测试", tool: "shell", command: "swift test", tier: .medium, at: at, rule: rule)
  }
  private func panel(_ api: FakeAPI) -> PanelModel {
    PanelModel(api: api, store: SettingsStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
  }
  private func decode(_ field: String) throws -> Snapshot {
    try JSONDecoder().decode(Snapshot.self, from: Data("{\"agentId\":\"jv\"\(field)}".utf8))
  }
  private let valid = #"{"id":"a","session":"s","title":"测试","tool":"shell","command":"swift test","tier":"grey","at":1234,"rule":{"fingerprint":"fp","tool":"shell","workspace":"/repo"}}"#

  // MARK: - 等价类
  func testDecodesHostTupleAndEpochMilliseconds() throws {
    let snapshot = try decode(",\"autoApprovals\":[\(valid)]")
    XCTAssertEqual(snapshot.autoApprovals.first?.tier, .grey)
    XCTAssertEqual(snapshot.autoApprovals.first?.at, 1234)
    XCTAssertEqual(snapshot.autoApprovals.first?.rule?.workspace, "/repo")
  }
  func testRevocationUsesExactTupleAndUpdatesAllMatchingEntries() async {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(autoApprovals: [entry(rule: rule), entry("b", rule: rule)]))
    let model = panel(api)
    await model.refresh()
    await model.revokeAutoApproval(model.visibleAutoApprovals[0])
    let removed = await api.removedRules
    XCTAssertEqual(removed, [rule])
    XCTAssertTrue(model.visibleAutoApprovals.allSatisfy { $0.rule == nil })
    XCTAssertEqual(model.visibleAutoApprovals.count, 2)
    XCTAssertNil(model.autoApprovalError)
    let calls = await api.snapshotCalls
    XCTAssertEqual(calls, 2)
  }

  // MARK: - 边界值
  func testNewestFiveSortedAndDuplicateIDsCollapsed() async {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(autoApprovals: (0..<8).map { entry("\($0)", at: Double($0)) } + [entry("7", at: 1)]))
    let model = panel(api)
    await model.refresh()
    XCTAssertEqual(model.visibleAutoApprovals.map(\.id), ["7", "6", "5", "4", "3"])
  }
  func testMissingNullEmptyAndWrongTypeRemainCompatible() throws {
    for field in ["", #", "autoApprovals":null"#, #", "autoApprovals":[]"#, #", "autoApprovals":{}"#, #", "autoApprovals":"bad""#] {
      XCTAssertTrue(try decode(field).autoApprovals.isEmpty)
    }
  }
  func testNewApprovalCanRevokeResavedRuleWithSameIdentity() async {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(autoApprovals: [entry(rule: rule)]))
    let model = panel(api)
    await model.refresh()
    await model.revokeAutoApproval(entry(rule: rule))
    await api.setSnapshot(Snapshot(autoApprovals: [entry("new", at: 2000, rule: rule)]))
    await model.refresh()
    XCTAssertEqual(model.visibleAutoApprovals.first?.rule, rule)
    await model.revokeAutoApproval(entry("new", at: 2000, rule: rule))
    let removed = await api.removedRules
    XCTAssertEqual(removed, [rule, rule])
  }
  func testNoRuleEntryNeverSendsRevocation() async {
    let api = FakeAPI()
    let model = panel(api)
    await api.setSnapshot(Snapshot(autoApprovals: [entry()]))
    await model.refresh()
    await model.revokeAutoApproval(entry())
    let removed = await api.removedRules
    XCTAssertTrue(removed.isEmpty)
  }
  func testDuplicateClickDoesNotSendConcurrentRemoval() async {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(autoApprovals: [entry(rule: rule)]))
    await api.setApprovalRulesDelay(0.1)
    let model = panel(api)
    await model.refresh()
    let task = Task { await model.revokeAutoApproval(entry(rule: rule)) }
    await Task.yield()
    XCTAssertEqual(model.revokingAutoApproval, rule)
    await model.revokeAutoApproval(entry(rule: rule))
    await task.value
    let removed = await api.removedRules
    XCTAssertEqual(removed.count, 1)
    XCTAssertNil(model.revokingAutoApproval)
  }

  // MARK: - 异常路径
  func testMalformedEntryDoesNotDiscardValidNeighbor() throws {
    let snapshot = try decode(",\"autoApprovals\":[{},null,42,\(valid)]")
    XCTAssertEqual(snapshot.autoApprovals.map(\.id), ["a"])
  }
  func testUnknownTierEmptyIDAndInvalidTimestampAreIgnored() throws {
    for invalid in [valid.replacingOccurrences(of: "grey", with: "future"), valid.replacingOccurrences(of: "\"id\":\"a\"", with: "\"id\":\"\""), valid.replacingOccurrences(of: "1234", with: "-1")] {
      XCTAssertTrue(try decode(",\"autoApprovals\":[\(invalid)]").autoApprovals.isEmpty)
    }
  }
  func testMalformedRuleDisablesRevocationButKeepsAuditEntry() throws {
    for bad in [#"{"fingerprint":"fp"}"#, #"{"fingerprint":"","tool":"shell","workspace":"/repo"}"#, "true"] {
      let json = valid.replacingOccurrences(of: #"{"fingerprint":"fp","tool":"shell","workspace":"/repo"}"#, with: bad)
      let entries = try decode(",\"autoApprovals\":[\(json)]").autoApprovals
      XCTAssertEqual(entries.count, 1)
      XCTAssertNil(entries.first?.rule)
    }
  }
  func testFailedRemovalPreservesActionForRetry() async {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(autoApprovals: [entry(rule: rule)]))
    await api.setRemoveRuleError(.http(500))
    let model = panel(api)
    await model.refresh()
    await model.revokeAutoApproval(entry(rule: rule))
    XCTAssertEqual(model.visibleAutoApprovals.first?.rule, rule)
    XCTAssertEqual(model.autoApprovalError, "撤销规则失败：HTTP 500")
    XCTAssertNil(model.revokingAutoApproval)
    await api.setRemoveRuleError(nil)
    await model.revokeAutoApproval(entry(rule: rule))
    XCTAssertNil(model.visibleAutoApprovals.first?.rule)
    XCTAssertNil(model.autoApprovalError)
  }
  func testStale404TreatedAsRemovedEvenIfRefreshFails() async {
    let api = FakeAPI()
    await api.setSnapshot(Snapshot(autoApprovals: [entry(rule: rule)]))
    let model = panel(api)
    await model.refresh()
    await api.setRemoveRuleError(.http(404))
    await api.setSnapshotError(.http(500))
    await model.revokeAutoApproval(entry(rule: rule))
    XCTAssertNil(model.visibleAutoApprovals.first?.rule)
    XCTAssertNil(model.autoApprovalError)
  }
}
