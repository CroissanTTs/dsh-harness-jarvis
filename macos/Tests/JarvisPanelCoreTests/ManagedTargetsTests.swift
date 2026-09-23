import XCTest
@testable import JarvisPanelCore

/// Handing sessions to Jarvis from the target list, and the history following
/// the selected target's own conversation.
@MainActor
final class ManagedTargetsTests: XCTestCase {
  private var api: FakeAPI!
  private var dir: URL!
  private var store: SettingsStore!
  private var model: PanelModel!

  private let hammer = SessionInfo(id: "s-hammer", title: "贾维斯-hammer", status: .running, unread: false, managed: true)
  private let quant = SessionInfo(id: "s-quant", title: "量化回测", status: .idle, unread: false, managed: false)
  private let docs = SessionInfo(id: "s-docs", title: "docs", status: .done, unread: false, managed: false)

  override func setUp() async throws {
    api = FakeAPI()
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    store = SettingsStore(url: dir.appendingPathComponent("panel.json"))
    model = PanelModel(api: api, store: store)
  }

  override func tearDown() async throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func load(_ sessions: [SessionInfo], pending: [PendingItem] = [], agentId: String = "jarvis") async {
    await api.setSnapshot(Snapshot(agentId: agentId, sessions: sessions, pending: pending))
    await model.refresh()
  }

  private func msg(_ id: String, _ text: String) -> ChatMessage {
    ChatMessage(id: id, role: "assistant", text: text)
  }

  /// Opens the bar with history shown, then lets its initial load finish.
  private func openWithHistory() async {
    model.openQuickBar()
    await model.setHistoryExpanded(true)
  }

  private func settle(_ seconds: Double = 0.05) async {
    try? await Task.sleep(for: .seconds(seconds))
  }

  // MARK: - 等价类

  func testOnlyManagedSessionsAreTargetsTheRestAreCandidates() async {
    await load([hammer, quant, docs])
    XCTAssertEqual(model.targets.map(\.target), [.jarvis, .session("s-hammer")])
    XCTAssertEqual(model.candidates.map(\.target), [.session("s-quant"), .session("s-docs")])
  }

  func testHandingOverCallsHostAndRefreshes() async {
    await load([hammer, quant])
    let before = await api.snapshotCalls
    await model.setManaged("s-quant", true)
    let calls = await api.managedCalls
    XCTAssertEqual(calls.map(\.session), ["s-quant"])
    XCTAssertEqual(calls.map(\.managed), [true])
    let after = await api.snapshotCalls
    XCTAssertEqual(after, before + 1)
    XCTAssertNil(model.managingID)
  }

  func testReleasingTheCurrentTargetFallsBackToJarvis() async {
    await load([hammer])
    model.target = .session("s-hammer")
    await model.setManaged("s-hammer", false)
    XCTAssertEqual(model.target, .jarvis)
  }

  func testHistoryShowsTheSelectedSessionsConversation() async {
    await load([hammer])
    await api.setSessionMessages("s-hammer", [msg("h1", "lint 通过")])
    await openWithHistory()
    model.target = .session("s-hammer")
    await settle()
    XCTAssertEqual(model.messages.map(\.id), ["h1"])
    let requests = await api.messageRequests
    XCTAssertEqual(requests.last ?? nil, "s-hammer")
  }

  func testJarvisOwnSessionIdIsLabelledJarvis() async {
    await load([hammer], agentId: "jarvis")
    XCTAssertEqual(model.label(for: .session("jarvis")), "贾维斯")
  }

  // MARK: - 边界值

  func testNoOtherSessionsMeansNoCandidates() async {
    await load([hammer])
    XCTAssertTrue(model.candidates.isEmpty)
    await load([])
    XCTAssertEqual(model.targets.map(\.target), [.jarvis])
  }

  func testReleasingAnotherSessionKeepsTheTarget() async {
    let anvil = SessionInfo(id: "s-anvil", title: "anvil", status: .idle, unread: false)
    await load([hammer, anvil])
    model.target = .session("s-hammer")
    await model.setManaged("s-anvil", false)
    XCTAssertEqual(model.target, .session("s-hammer"))
  }

  func testPendingFromUnmanagedSessionDoesNotBecomeTheTarget() async {
    let item = PendingItem(id: "p", kind: .approval, session: "s-quant", title: "请求执行")
    await load([hammer, quant], pending: [item])
    model.openQuickBar()
    XCTAssertEqual(model.target, .jarvis)
  }

  func testRememberedTargetNoLongerManagedRestoresJarvis() async {
    store.update { $0.lastTarget = "s-quant" }
    await load([hammer, quant])
    model.openQuickBar()
    XCTAssertEqual(model.target, .jarvis)
  }

  func testSwitchingTargetWithHistoryCollapsedLoadsNothing() async {
    await load([hammer])
    model.openQuickBar()
    await model.setHistoryExpanded(false)
    let before = await api.messageRequests.count
    model.target = .session("s-hammer")
    await settle()
    let after = await api.messageRequests.count
    XCTAssertEqual(after, before)
  }

  // MARK: - 异常路径

  func testHostRefusalShowsErrorAndChangesNothing() async {
    await load([hammer])
    model.target = .session("s-hammer")
    await api.setManagedError(.http(404))
    let before = await api.snapshotCalls
    await model.setManaged("s-hammer", false)
    XCTAssertEqual(model.target, .session("s-hammer"))
    XCTAssertTrue(model.sendError?.hasPrefix("移出失败") ?? false)
    let after = await api.snapshotCalls
    XCTAssertEqual(after, before)
  }

  func testSecondRequestWhileOneIsInFlightIsIgnored() async {
    await load([hammer, quant, docs])
    await api.setManagedDelay(0.2)
    async let first: Void = model.setManaged("s-quant", true)
    await settle()
    await model.setManaged("s-docs", true)
    await first
    let calls = await api.managedCalls
    XCTAssertEqual(calls.map(\.session), ["s-quant"])
  }

  func testSlowLoadForPreviousTargetDoesNotOverwriteTheCurrentOne() async {
    let anvil = SessionInfo(id: "s-anvil", title: "anvil", status: .idle, unread: false)
    await load([hammer, anvil])
    await api.setSessionMessages("s-hammer", [msg("h", "hammer")])
    await api.setSessionMessages("s-anvil", [msg("a", "anvil")])
    await openWithHistory()
    await api.setMessagesDelay(0.15)
    model.target = .session("s-hammer")
    await settle(0.03)
    model.target = .session("s-anvil")
    await settle(0.4)
    XCTAssertEqual(model.messages.map(\.id), ["a"])
  }

  func testLegacyHostWithoutManagedFlagKeepsAllSessionsAsTargets() throws {
    let json = #"{"sessions":[{"id":"a","title":"x"},{"id":"b","title":"y","managed":"yes"}]}"#
    let s = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
    XCTAssertEqual(s.sessions.map(\.managed), [true, true])
  }
}
