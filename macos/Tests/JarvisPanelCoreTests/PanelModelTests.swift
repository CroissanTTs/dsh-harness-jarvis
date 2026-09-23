import XCTest
@testable import JarvisPanelCore

@MainActor
final class PanelModelTests: XCTestCase {
  private var api: FakeAPI!
  private var dir: URL!
  private var store: SettingsStore!
  private var model: PanelModel!

  private let hammer = SessionInfo(id: "s-hammer", title: "贾维斯-hammer", status: .running, unread: false)
  private let anvil = SessionInfo(id: "s-anvil", title: "贾维斯-anvil", status: .waiting, unread: false)
  private let approval = PendingItem(id: "p1", kind: .approval, session: "s-hammer", title: "请求执行", detail: "rm -rf x")
  private let question = PendingItem(id: "p2", kind: .question, session: "s-anvil", title: "用哪个？", choices: ["A", "B"])

  override func setUp() async throws {
    api = FakeAPI()
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    store = SettingsStore(url: dir.appendingPathComponent("panel.json"))
    model = PanelModel(api: api, store: store)
  }

  override func tearDown() async throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func load(sessions: [SessionInfo] = [], pending: [PendingItem] = [],
                    voice: VoiceState = VoiceState(), counts: Counts = Counts()) async {
    await api.setSnapshot(Snapshot(agentId: "jv", voice: voice, counts: counts, sessions: sessions, pending: pending))
    await model.refresh()
  }

  // MARK: - 等价类

  func testSendToJarvisPassesNilTarget() async {
    await load(sessions: [hammer])
    model.openQuickBar()
    model.target = .jarvis
    model.draft = "你好"
    let ok = await model.submit()
    XCTAssertTrue(ok)
    let sent = await api.sent
    XCTAssertEqual(sent.count, 1)
    XCTAssertEqual(sent.first?.text, "你好")
    XCTAssertNil(sent.first?.target)
    XCTAssertEqual(model.toast, "已发给 贾维斯")
  }

  func testSendToSessionPassesSessionID() async {
    await load(sessions: [hammer])
    model.openQuickBar()
    model.target = .session("s-hammer")
    model.draft = "跑 lint"
    _ = await model.submit()
    let sent = await api.sent
    XCTAssertEqual(sent.first?.target, "s-hammer")
    XCTAssertEqual(model.toast, "已发给 hammer")
    XCTAssertEqual(store.settings.lastTarget, "s-hammer")
  }

  func testSuccessfulSendClearsDraftAndClosesBar() async {
    await load()
    model.openQuickBar()
    model.draft = "hi"
    _ = await model.submit()
    XCTAssertEqual(model.draft, "")
    XCTAssertFalse(model.quickBarOpen)
    XCTAssertNil(model.sendError)
  }

  func testApproveAndDeny() async {
    await load(pending: [approval])
    await model.decide(approval, allow: true)
    await model.decide(approval, allow: false)
    let answers = await api.answers
    XCTAssertEqual(answers, [.decision(id: "p1", allow: true), .decision(id: "p1", allow: false)])
  }

  func testChoiceAnswer() async {
    await load(pending: [question])
    await model.choose(question, choice: "B")
    let answers = await api.answers
    XCTAssertEqual(answers, [.choice(id: "p2", choice: "B")])
  }

  func testTextAnswerGoesThroughAnswerNotSend() async {
    await load(sessions: [anvil], pending: [question])
    model.openQuickBar()
    model.beginTextAnswer(question)
    XCTAssertEqual(model.target, .session("s-anvil"))
    XCTAssertEqual(model.answeringItem, question)
    model.draft = "都不要"
    _ = await model.submit()
    let answers = await api.answers
    let sent = await api.sent
    XCTAssertEqual(answers, [.text(id: "p2", text: "都不要")])
    XCTAssertTrue(sent.isEmpty)
    XCTAssertNil(model.answeringItem)
  }

  func testSpeakingShowsPlaybackControls() async {
    await load(voice: VoiceState(speaking: true, queued: 2))
    XCTAssertEqual(model.hoverButtons, [.pause, .skip, .clear])
  }

  func testPausedShowsResume() async {
    await load(voice: VoiceState(paused: true, queued: 1))
    XCTAssertEqual(model.hoverButtons, [.resume, .skip, .clear])
  }

  func testQuietShowsMuteToggleAndHistory() async {
    await load(voice: VoiceState(muted: false))
    XCTAssertEqual(model.hoverButtons, [.mute, .history])
    await load(voice: VoiceState(muted: true))
    XCTAssertEqual(model.hoverButtons, [.unmute, .history])
  }

  func testEachButtonSendsItsVoiceAction() async {
    await load(voice: VoiceState(speaking: true))
    for button: HoverButton in [.pause, .resume, .skip, .clear, .mute, .unmute] {
      await model.press(button)
    }
    let voices = await api.voices
    XCTAssertEqual(voices, [.pause, .resume, .skip, .clear, .mute, .unmute])
  }

  func testHistoryButtonSendsNoVoiceAction() async {
    await load()
    await model.press(.history)
    let voices = await api.voices
    XCTAssertTrue(voices.isEmpty)
  }

  func testPressRefreshesSoButtonsFollowHost() async {
    await load(voice: VoiceState(speaking: true, queued: 3))
    await api.setSnapshot(Snapshot(agentId: "jv", voice: VoiceState()))
    await model.press(.clear)
    XCTAssertEqual(model.hoverButtons, [.mute, .history])
  }

  func testExpandingHistoryMarksReadAndPersists() async {
    await load()
    await model.setHistoryExpanded(true)
    let reads = await api.reads
    XCTAssertEqual(reads.count, 1)
    XCTAssertTrue(store.settings.historyExpanded)
  }

  func testOpenInDSHMarksSessionRead() async {
    await load(sessions: [hammer])
    await model.openInDSH(session: "s-hammer")
    let opened = await api.opened
    let reads = await api.reads
    XCTAssertEqual(opened, ["s-hammer"])
    XCTAssertEqual(reads, ["s-hammer"])
  }

  // MARK: - 边界值

  func testLastQueuedItemStillCountsAsActive() async {
    await load(voice: VoiceState(speaking: false, queued: 1))
    XCTAssertEqual(model.hoverButtons, [.pause, .skip, .clear])
  }

  func testPausedWithEmptyQueueStillOffersResume() async {
    await load(voice: VoiceState(paused: true, queued: 0))
    XCTAssertEqual(model.hoverButtons.first, .resume)
  }

  func testSpeakingTheLastLineIsActive() async {
    await load(voice: VoiceState(speaking: true, queued: 0))
    XCTAssertEqual(model.hoverButtons.count, 3)
  }

  func testMutedButPlayingShowsPlaybackControls() async {
    await load(voice: VoiceState(speaking: true, muted: true))
    XCTAssertEqual(model.hoverButtons, [.pause, .skip, .clear])
  }

  func testEmptyAndWhitespaceDraftsAreNotSent() async {
    await load()
    model.openQuickBar()
    for draft in ["", "   ", "\n\t "] {
      model.draft = draft
      let ok = await model.submit()
      XCTAssertFalse(ok)
    }
    let sent = await api.sent
    XCTAssertTrue(sent.isEmpty)
    XCTAssertTrue(model.quickBarOpen)
  }

  func testMultilineTextIsSentVerbatimExceptOuterWhitespace() async {
    await load()
    model.openQuickBar()
    model.draft = "  第一行\n第二行\n第三行  "
    _ = await model.submit()
    let sent = await api.sent
    XCTAssertEqual(sent.first?.text, "第一行\n第二行\n第三行")
  }

  func testNoSessionsLeavesOnlyJarvisTarget() async {
    await load(sessions: [])
    XCTAssertEqual(model.targets.map(\.target), [.jarvis])
    XCTAssertEqual(model.targets.first?.label, "贾维斯")
  }

  func testTargetsListSessionsWithShortNames() async {
    await load(sessions: [hammer, anvil])
    XCTAssertEqual(model.targets.map(\.label), ["贾维斯", "hammer", "anvil"])
    XCTAssertEqual(model.targets[1].status, .running)
  }

  func testStaleLastTargetFallsBackToJarvis() async {
    store.update { $0.lastTarget = "s-gone" }
    await load(sessions: [hammer])
    model.openQuickBar()
    XCTAssertEqual(model.target, .jarvis)
  }

  func testValidLastTargetIsRestored() async {
    store.update { $0.lastTarget = "s-hammer" }
    await load(sessions: [hammer])
    model.openQuickBar()
    XCTAssertEqual(model.target, .session("s-hammer"))
  }

  func testPendingFolding() async {
    await load(pending: [])
    XCTAssertEqual(model.visiblePending.count, 0)
    XCTAssertEqual(model.hiddenPendingCount, 0)

    let three = (1...3).map { PendingItem(id: "p\($0)", kind: .question, session: "s", title: "q") }
    await load(pending: three)
    XCTAssertEqual(model.visiblePending.count, 3)
    XCTAssertEqual(model.hiddenPendingCount, 0)

    let four = (1...4).map { PendingItem(id: "p\($0)", kind: .question, session: "s", title: "q") }
    await load(pending: four)
    XCTAssertEqual(model.visiblePending.map(\.id), ["p1", "p2", "p3"])
    XCTAssertEqual(model.hiddenPendingCount, 1)
  }

  func testSelectTargetNumberOutOfRangeIsIgnored() async {
    await load(sessions: [hammer])
    model.target = .session("s-hammer")
    model.selectTarget(number: 0)
    XCTAssertEqual(model.target, .session("s-hammer"))
    model.selectTarget(number: 3)
    XCTAssertEqual(model.target, .session("s-hammer"))
    model.selectTarget(number: 1)
    XCTAssertEqual(model.target, .jarvis)
    model.selectTarget(number: 2)
    XCTAssertEqual(model.target, .session("s-hammer"))
  }

  func testCycleTargetWrapsAround() async {
    await load(sessions: [hammer, anvil])
    model.target = .jarvis
    model.cycleTarget()
    XCTAssertEqual(model.target, .session("s-hammer"))
    model.cycleTarget()
    XCTAssertEqual(model.target, .session("s-anvil"))
    model.cycleTarget()
    XCTAssertEqual(model.target, .jarvis)
  }

  func testOpeningWithPendingSelectsEarliestPendingSession() async {
    store.update { $0.lastTarget = "jarvis" }
    await load(sessions: [hammer, anvil], pending: [question, approval])
    model.openQuickBar()
    XCTAssertEqual(model.target, .session("s-anvil"))
  }

  func testOpeningRestoresHistoryExpandedSetting() async {
    store.update { $0.historyExpanded = true }
    await load()
    model.openQuickBar()
    XCTAssertTrue(model.historyExpanded)
  }

  // MARK: - 异常路径

  func testVoiceFailureStillRefreshes() async {
    await load(voice: VoiceState(speaking: true))
    await api.setVoiceError(.http(500))
    await api.setSnapshot(Snapshot(agentId: "jv", voice: VoiceState(paused: true)))
    await model.press(.pause)
    XCTAssertEqual(model.hoverButtons.first, .resume)
  }

  func testNoSnapshotYetShowsQuietButtons() {
    XCTAssertNil(model.snapshot)
    XCTAssertEqual(model.hoverButtons, [.mute, .history])
  }

  func testNoRuntimeGoesOfflineAndRed() async {
    await api.setSnapshotError(.noRuntime)
    await model.refresh()
    guard case .offline = model.connection else { return XCTFail("expected offline") }
    XCTAssertEqual(model.appearance.tint, .red)
    XCTAssertNil(model.appearance.badge)
  }

  func testHTTP500GoesOffline() async {
    await api.setSnapshotError(.http(500))
    await model.refresh()
    XCTAssertEqual(model.connection, .offline("HTTP 500"))
  }

  func testRefreshFailureKeepsLastSnapshot() async {
    await load(sessions: [hammer])
    await api.setSnapshotError(.transport("timeout"))
    await model.refresh()
    XCTAssertEqual(model.snapshot?.sessions, [hammer])
    XCTAssertEqual(model.connection, .offline("timeout"))
  }

  func testRecoveryAfterOffline() async {
    await api.setSnapshotError(.http(500))
    await model.refresh()
    await load()
    XCTAssertEqual(model.connection, .online)
  }

  func testSendFailureKeepsDraftAndBarOpen() async {
    await load()
    model.openQuickBar()
    model.draft = "重要消息"
    await api.setSendError(.http(500))
    let ok = await model.submit()
    XCTAssertFalse(ok)
    XCTAssertEqual(model.draft, "重要消息")
    XCTAssertTrue(model.quickBarOpen)
    XCTAssertEqual(model.sendError, "发送失败：HTTP 500")
    XCTAssertNil(model.toast)
  }

  func testNextSuccessfulSendClearsError() async {
    await load()
    model.openQuickBar()
    model.draft = "x"
    await api.setSendError(.http(500))
    _ = await model.submit()
    await api.setSendError(nil)
    _ = await model.submit()
    XCTAssertNil(model.sendError)
  }

  func testAnsweringStaleItemReportsErrorAndRefreshes() async {
    await load(pending: [approval])
    let before = await api.snapshotCalls
    await api.setAnswerError(.http(404))
    await model.decide(approval, allow: true)
    let after = await api.snapshotCalls
    XCTAssertEqual(model.sendError, "提交失败：HTTP 404")
    XCTAssertGreaterThan(after, before)
  }

  func testLegacySnapshotDoesNotCrash() async throws {
    let legacy = try JSONDecoder().decode(Snapshot.self, from: Data(#"{"agentId":"a","managed":["s1"]}"#.utf8))
    await api.setSnapshot(legacy)
    await model.refresh()
    XCTAssertEqual(model.connection, .online)
    XCTAssertEqual(model.snapshot?.counts, Counts())
    XCTAssertEqual(model.targets.count, 2)
  }

  func testClosingQuickBarKeepsUnsentDraft() async {
    await load()
    model.openQuickBar()
    model.draft = "写了一半"
    model.closeQuickBar()
    model.openQuickBar()
    XCTAssertEqual(model.draft, "写了一半")
  }
}
