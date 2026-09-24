import XCTest
@testable import JarvisPanelCore

final class CaptionTests: XCTestCase {
  private func voice(_ json: String) throws -> VoiceState {
    try JSONDecoder().decode(VoiceState.self, from: Data(json.utf8))
  }
  // MARK: - 等价类
  func testDecodesSpokenText() throws {
    XCTAssertEqual(try voice(#"{"speaking":true,"text":"已完成"}"#).text, "已完成")
  }
  func testCaptionReplacesSourceAndText() {
    var state = CaptionState()
    state.update(VoiceState(speaking: true, text: "第一句"), now: 10)
    XCTAssertEqual(state.caption(now: 10)?.source, .jarvis)
    state.update(VoiceState(speaking: true, source: .session, sessionId: "worker", text: "第二句"), now: 11)
    XCTAssertEqual(state.caption(now: 11), Caption(text: "第二句", source: .session, sessionId: "worker"))
  }
  func testSettingPersistsAndDefaultsOn() throws {
    XCTAssertTrue(try JSONDecoder().decode(PanelSettings.self, from: Data("{}".utf8)).showCaptions)
    var settings = PanelSettings(); settings.showCaptions = false
    XCTAssertFalse(try JSONDecoder().decode(PanelSettings.self, from: JSONEncoder().encode(settings)).showCaptions)
  }
  // MARK: - 边界值
  func testHoldExpiresAtExactlyOneAndHalfSecondsWithoutRestartOnPolls() {
    var state = CaptionState()
    state.update(VoiceState(speaking: true, text: "字幕"), now: 10)
    state.update(VoiceState(), now: 20)
    state.update(VoiceState(), now: 21)
    XCTAssertNotNil(state.caption(now: 21.499))
    XCTAssertNil(state.caption(now: 21.5))
    XCTAssertNil(state.caption(now: 22))
  }
  func testOffSuppressesActiveAndHeldCaption() {
    var state = CaptionState()
    state.update(VoiceState(speaking: true, text: "字幕"), now: 0)
    XCTAssertNil(state.caption(now: 0, enabled: false))
    state.update(VoiceState(), now: 1)
    XCTAssertNil(state.caption(now: 1, enabled: false))
  }
  func testNewLineDuringHoldImmediatelyReplacesIt() {
    var state = CaptionState()
    state.update(VoiceState(speaking: true, text: "旧"), now: 0)
    state.update(VoiceState(), now: 1)
    state.update(VoiceState(speaking: true, text: "新"), now: 2)
    XCTAssertEqual(state.caption(now: 20)?.text, "新")
  }
  // MARK: - 异常路径
  func testOldHostMalformedOrInactiveTextIsIgnored() throws {
    for json in [#"{"speaking":true}"#, #"{"speaking":true,"text":5}"#, #"{"speaking":true,"text":null}"#, #"{"speaking":false,"text":"旧"}"#] {
      XCTAssertNil(try voice(json).text)
    }
    XCTAssertTrue(try JSONDecoder().decode(PanelSettings.self, from: Data(#"{"showCaptions":"bad"}"#.utf8)).showCaptions)
  }
  func testSpeechWithoutTextClearsOldCaptionRatherThanMisattributesIt() {
    var state = CaptionState()
    state.update(VoiceState(speaking: true, text: "旧"), now: 0)
    state.update(VoiceState(speaking: true, source: .session, text: " \n"), now: 1)
    XCTAssertNil(state.caption(now: 1))
    state.update(VoiceState(), now: 2)
    XCTAssertNil(state.caption(now: 2))
  }
}

@MainActor
final class CaptionModelTests: XCTestCase {
  // MARK: - 等价类
  func testUsesDisambiguatedSessionNameAndSettingsImmediately() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let store = SettingsStore(url: dir.appendingPathComponent("settings.json"))
    let api = FakeAPI(); let model = PanelModel(api: api, store: store)
    await api.setSnapshot(Snapshot(voice: VoiceState(speaking: true, source: .session, sessionId: "one", text: "完成"), sessions: [
      SessionInfo(id: "one", title: "同名", status: .idle, unread: false, workspace: "项目一"),
      SessionInfo(id: "two", title: "同名", status: .idle, unread: false, workspace: "项目二")]))
    await model.refresh()
    XCTAssertEqual(model.captionText, "同名 · 项目一：完成")
    store.update { $0.showCaptions = false }; model.refreshCaptions()
    XCTAssertNil(model.caption)
  }
  // MARK: - 边界值
  func testTimerHidesHeldCaptionWithoutAnotherHostPoll() async throws {
    let api = FakeAPI(); let model = PanelModel(api: api, store: SettingsStore(url: URL(fileURLWithPath: "/dev/null")))
    await api.setSnapshot(Snapshot(voice: VoiceState(speaking: true, text: "完成"))); await model.refresh()
    await api.setSnapshot(Snapshot()); await model.refresh()
    XCTAssertNotNil(model.caption)
    try await Task.sleep(for: .milliseconds(1600))
    XCTAssertNil(model.caption)
  }
  // MARK: - 异常路径
  func testDisconnectRetiresCaption() async throws {
    let api = FakeAPI(); let model = PanelModel(api: api, store: SettingsStore(url: URL(fileURLWithPath: "/dev/null")))
    await api.setSnapshot(Snapshot(voice: VoiceState(speaking: true, text: "旧"))); await model.refresh()
    await api.setSnapshotError(.http(500)); await model.refresh()
    try await Task.sleep(for: .milliseconds(1600))
    XCTAssertNil(model.caption)
  }
}
