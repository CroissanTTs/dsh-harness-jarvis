import XCTest
@testable import JarvisPanelCore

@MainActor
final class ApprovalPresetsTests: XCTestCase {
  private func item(_ kind: PendingKind = .approval, flag: Bool = true) -> PendingItem {
    PendingItem(id: "p", kind: kind, session: "s", title: "run", canAlwaysAllow: flag)
  }
  private func panel(_ api: FakeAPI) -> PanelModel {
    PanelModel(api: api, store: SettingsStore(url: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
  }
  private let rule = ApprovalRule(fingerprint: "fp", tool: "shell", workspace: "/repo", createdAt: 1000)

  // MARK: - 等价类
  func testExplicitServerFlagAllowsPresetForApproval() { XCTAssertTrue(item().canAlwaysAllow) }
  func testAlwaysAnswerReachesAPI() async {
    let api = FakeAPI()
    await panel(api).alwaysAllow(item())
    let answers = await api.answers
    XCTAssertEqual(answers, [.always(id: "p")])
  }
  func testRefreshAndExactTupleRemoval() async {
    let api = FakeAPI()
    let other = ApprovalRule(fingerprint: "fp", tool: "shell", workspace: "/other", createdAt: 1000)
    await api.setApprovalRules([rule, other])
    let model = ApprovalRulesModel(api: api)
    await model.refresh()
    XCTAssertEqual(model.rules, [rule, other])
    await model.remove(rule)
    XCTAssertEqual(model.rules, [other])
    let removed = await api.removedRules
    XCTAssertEqual(removed, [rule.identity])
    XCTAssertNil(model.error)
  }
  func testRefreshReadsLatestRulesEachTime() async {
    let api = FakeAPI()
    let model = ApprovalRulesModel(api: api)
    await model.refresh()
    await api.setApprovalRules([rule])
    await model.refresh()
    XCTAssertEqual(model.rules, [rule])
  }

  // MARK: - 边界值
  func testMissingNullAndFalseFlagDefaultHidden() throws {
    for suffix in ["", #", "canAlwaysAllow":null"#, #", "canAlwaysAllow":false"#] {
      let json = "{\"id\":\"p\",\"kind\":\"approval\"\(suffix)}"
      XCTAssertFalse(try JSONDecoder().decode(PendingItem.self, from: Data(json.utf8)).canAlwaysAllow)
    }
  }
  func testQuestionIgnoresTrueFlagAndCannotSubmitAlways() async {
    let api = FakeAPI()
    let question = item(.question)
    XCTAssertFalse(question.canAlwaysAllow)
    await panel(api).alwaysAllow(question)
    let answers = await api.answers
    XCTAssertTrue(answers.isEmpty)
  }
  func testHighRiskServerFalseCannotSubmitAlways() async {
    let api = FakeAPI()
    await panel(api).alwaysAllow(item(flag: false))
    let answers = await api.answers
    XCTAssertTrue(answers.isEmpty)
  }
  func testRuleIdentityIncludesEveryTupleComponentButNotTimestamps() {
    XCTAssertEqual(rule.identity, ApprovalRule(fingerprint: "fp", tool: "shell", workspace: "/repo", createdAt: 9, expiresAt: 99).identity)
    XCTAssertNotEqual(rule.identity, ApprovalRule(fingerprint: "fp", tool: "read", workspace: "/repo", createdAt: 1000).identity)
    XCTAssertNotEqual(rule.identity, ApprovalRule(fingerprint: "other", tool: "shell", workspace: "/repo", createdAt: 1000).identity)
    XCTAssertNotEqual(rule.identity, ApprovalRule(fingerprint: "fp", tool: "shell", workspace: "/repo/", createdAt: 1000).identity)
  }
  func testLoadingAndRemovingStatesPreventOverlappingMutations() async throws {
    let api = FakeAPI()
    await api.setApprovalRules([rule])
    await api.setApprovalRulesDelay(0.1)
    let model = ApprovalRulesModel(api: api)
    let refresh = Task { await model.refresh() }
    await Task.yield()
    XCTAssertTrue(model.isLoading)
    await refresh.value
    let remove = Task { await model.remove(rule) }
    await Task.yield()
    XCTAssertEqual(model.removing, rule.identity)
    await model.remove(rule)
    await remove.value
    XCTAssertFalse(model.isLoading)
    XCTAssertNil(model.removing)
    let removed = await api.removedRules
    XCTAssertEqual(removed.count, 1)
  }

  // MARK: - 异常路径
  func testMalformedFlagFailsClosed() throws {
    let json = #"{"id":"p","kind":"approval","canAlwaysAllow":"true"}"#
    XCTAssertFalse(try JSONDecoder().decode(PendingItem.self, from: Data(json.utf8)).canAlwaysAllow)
  }
  func testAlwaysFailureKeepsErrorAndRefreshesSnapshot() async {
    let api = FakeAPI()
    await api.setAnswerError(.http(400))
    let model = panel(api)
    await model.alwaysAllow(item())
    XCTAssertEqual(model.sendError, "提交失败：HTTP 400")
    let calls = await api.snapshotCalls
    XCTAssertEqual(calls, 1)
  }
  func testFailedRefreshRetainsRulesAndRetryClearsError() async {
    let api = FakeAPI()
    await api.setApprovalRules([rule])
    let model = ApprovalRulesModel(api: api)
    await model.refresh()
    await api.setApprovalRulesError(.http(500))
    await model.refresh()
    XCTAssertEqual(model.rules, [rule])
    XCTAssertEqual(model.error, "加载审批规则失败：HTTP 500")
    XCTAssertFalse(model.isLoading)
    await api.setApprovalRulesError(nil)
    await model.refresh()
    XCTAssertNil(model.error)
  }
  func testFailedDeleteRetainsRuleAndRetryClearsError() async {
    let api = FakeAPI()
    await api.setApprovalRules([rule])
    let model = ApprovalRulesModel(api: api)
    await model.refresh()
    await api.setRemoveRuleError(.http(500))
    await model.remove(rule)
    XCTAssertEqual(model.rules, [rule])
    XCTAssertEqual(model.error, "删除审批规则失败：HTTP 500")
    XCTAssertNil(model.removing)
    await api.setRemoveRuleError(nil)
    await model.remove(rule)
    XCTAssertTrue(model.rules.isEmpty)
    XCTAssertNil(model.error)
  }
  func testAlreadyDeletedRule404RefreshesList() async {
    let api = FakeAPI()
    await api.setApprovalRules([rule])
    let model = ApprovalRulesModel(api: api)
    await model.refresh()
    await api.setApprovalRules([])
    await api.setRemoveRuleError(.http(404))
    await model.remove(rule)
    XCTAssertTrue(model.rules.isEmpty)
    XCTAssertNil(model.error)
  }
}
