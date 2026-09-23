import XCTest
@testable import JarvisPanelCore

/// Send-target labels (telling a session titled "贾维斯" or two same-titled
/// sessions apart) and the standby look while the pointer is over the orb.
@MainActor
final class TargetLabelAndStandbyTests: XCTestCase {
  private var api: FakeAPI!
  private var dir: URL!
  private var model: PanelModel!

  override func setUp() async throws {
    api = FakeAPI()
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    model = PanelModel(api: api, store: SettingsStore(url: dir.appendingPathComponent("panel.json")))
  }

  override func tearDown() async throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func load(_ sessions: [SessionInfo], activity: Activity = .idle, counts: Counts = Counts()) async {
    await api.setSnapshot(Snapshot(agentId: "jv", activity: activity, counts: counts, sessions: sessions))
    await model.refresh()
  }

  private func session(_ id: String, _ title: String, _ workspace: String? = nil) -> SessionInfo {
    SessionInfo(id: id, title: title, status: .idle, unread: false, workspace: workspace)
  }

  private var labels: [String] { model.targets.map(\.label) }

  // MARK: - 等价类

  func testDistinctTitlesKeepTheirShortNames() async {
    await load([session("s-1", "贾维斯-hammer", "quant"), session("s-2", "docs", "site")])
    XCTAssertEqual(labels, ["贾维斯", "hammer", "docs"])
  }

  func testSessionTitledJarvisGetsItsWorkspace() async {
    await load([session("session-9e6142d7", "贾维斯", "dsh-plugin-discovery")])
    XCTAssertEqual(labels, ["贾维斯", "贾维斯 · dsh-plugin-discovery"])
    XCTAssertEqual(model.label(for: .session("session-9e6142d7")), "贾维斯 · dsh-plugin-discovery")
  }

  func testSameTitleInDifferentWorkspacesShowsBothFolders() async {
    await load([session("a", "修复测试", "quant"), session("b", "修复测试", "android")])
    XCTAssertEqual(labels, ["贾维斯", "修复测试 · quant", "修复测试 · android"])
  }

  func testHoverShowsStandbyWhenIdle() async {
    await load([])
    XCTAssertEqual(model.appearance.motion, .idle)
    model.setHovering(true)
    XCTAssertEqual(model.appearance.motion, .awaiting)
    model.setHovering(false)
    XCTAssertEqual(model.appearance.motion, .idle)
  }

  func testHoverKeepsSpeakingAndThinking() async {
    for activity in [Activity.speaking, .thinking] {
      await load([], activity: activity)
      model.setHovering(true)
      XCTAssertEqual(model.appearance.motion, activity == .speaking ? .speaking : .thinking)
    }
  }

  // MARK: - 边界值

  func testSameTitleInSameWorkspaceFallsBackToIdTail() async {
    await load([session("session-aaaaaa111111", "你好", "quant"), session("session-bbbbbb222222", "你好", "quant")])
    XCTAssertEqual(labels, ["贾维斯", "你好 · 111111", "你好 · 222222"])
  }

  func testOnlyTheClashingPairIsSuffixed() async {
    await load([session("a", "x", "w1"), session("b", "x", "w2"), session("c", "y", "w3")])
    XCTAssertEqual(labels, ["贾维斯", "x · w1", "x · w2", "y"])
  }

  func testPrefixedTitleThatBecomesJarvisClashesToo() async {
    // "[贾维斯] 贾维斯" strips to "贾维斯" and must still be told apart from the built-in target.
    await load([session("s", "[贾维斯] 贾维斯", "proj")])
    XCTAssertEqual(labels.last, "贾维斯 · proj")
  }

  func testHoverWhileQuickBarOpenStaysStandby() async {
    await load([])
    model.openQuickBar()
    model.setHovering(true)
    model.setHovering(false)
    XCTAssertEqual(model.appearance.motion, .awaiting)
  }

  // MARK: - 异常路径

  func testJarvisTitledSessionWithoutWorkspaceUsesIdTail() async {
    await load([session("session-9e6142d7", "贾维斯")])
    XCTAssertEqual(labels.last, "贾维斯 · 6142d7")
  }

  func testUntitledSessionsAreAlreadyUniqueByIdTail() async {
    await load([session("session-aaaa1111", ""), session("session-bbbb2222", "")])
    XCTAssertEqual(labels, ["贾维斯", "aaaa1111", "bbbb2222"])
  }

  func testHoverDoesNotHideAttentionOrErrors() async {
    await load([], counts: Counts(pending: 1))
    model.setHovering(true)
    XCTAssertEqual(model.appearance.motion, .attention)
    await load([], counts: Counts(failed: 1))
    XCTAssertEqual(model.appearance.motion, .error)
  }

  func testRepeatedHoverSignalsAreIdempotent() async {
    await load([])
    var changes = 0
    let token = model.objectWillChange.sink { changes += 1 }
    model.setHovering(true)
    model.setHovering(true)
    model.setHovering(false)
    model.setHovering(false)
    token.cancel()
    XCTAssertEqual(changes, 2)
  }

  func testBlankWorkspaceDecodesAsMissing() throws {
    let json = #"{"sessions":[{"id":"s","title":"贾维斯","workspace":"  "},{"id":"t","workspace":42}]}"#
    let s = try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
    XCTAssertEqual(s.sessions.map(\.workspace), [nil, nil])
  }
}
