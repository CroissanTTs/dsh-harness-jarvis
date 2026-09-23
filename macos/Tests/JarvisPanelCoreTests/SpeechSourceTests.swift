import XCTest
@testable import JarvisPanelCore

/// Who is speaking (Jarvis vs another session), its tint, the tint crossfade,
/// and the change feed that makes the orb react as a line starts or ends.
@MainActor
final class SpeechSourceTests: XCTestCase {
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

  private func decodeVoice(_ json: String) throws -> VoiceState {
    try JSONDecoder().decode(Snapshot.self, from: Data(#"{"voice":\#(json)}"#.utf8)).voice
  }

  private func speaking(_ source: SpeechSource, _ counts: Counts = Counts()) -> Snapshot {
    Snapshot(agentId: "jv", activity: .speaking, voice: VoiceState(speaking: true, source: source), counts: counts)
  }

  private func resolve(_ s: Snapshot, connected: Bool = true) -> OrbAppearance {
    OrbStateResolver.resolve(snapshot: s, connected: connected, standby: false)
  }

  // MARK: - 等价类

  func testDecodesJarvisAndSessionSources() throws {
    XCTAssertEqual(try decodeVoice(#"{"speaking":true,"source":"jarvis"}"#).source, .jarvis)
    let other = try decodeVoice(#"{"speaking":true,"source":"session","sessionId":"w1"}"#)
    XCTAssertEqual(other.source, .session)
    XCTAssertEqual(other.sessionId, "w1")
  }

  func testJarvisVoiceIsCyanAndOtherSessionIsViolet() {
    XCTAssertEqual(resolve(speaking(.jarvis)), OrbAppearance(motion: .speaking, tint: .cyan, badge: nil))
    XCTAssertEqual(resolve(speaking(.session)), OrbAppearance(motion: .speaking, tint: .violet, badge: nil))
  }

  func testStatusColoursStillWinOverNarration() {
    XCTAssertEqual(resolve(speaking(.session, Counts(pending: 1))).tint, .amber)
    XCTAssertEqual(resolve(speaking(.session, Counts(failed: 1))).tint, .red)
    XCTAssertEqual(resolve(speaking(.session), connected: false).tint, .red)
  }

  func testBadgeKeepsItsStatusColourWhileViolet() {
    let a = resolve(speaking(.session, Counts(running: 2)))
    XCTAssertEqual(a.tint, .violet)
    XCTAssertEqual(a.badge, Badge(count: 2, tint: .cyan, unreadDot: false))
  }

  func testFadeEasesInAndOut() {
    let early = ColorFade.progress(elapsed: ColorFade.seconds * 0.1)
    let mid = ColorFade.progress(elapsed: ColorFade.seconds * 0.5)
    let late = ColorFade.progress(elapsed: ColorFade.seconds * 0.9)
    XCTAssertLessThan(early, 0.1, "starts slower than linear")
    XCTAssertEqual(mid, 0.5, accuracy: 1e-9)
    XCTAssertGreaterThan(late, 0.9, "lands slower than linear")
  }

  func testWaitStoresHostVersionForTheNextWait() async {
    await api.setWaitVersion(7)
    await model.waitForChange(timeout: 1)
    await model.waitForChange(timeout: 1)
    let waits = await api.waits
    XCTAssertEqual(waits.map(\.after), [-1, 7])
    XCTAssertEqual(waits.first?.timeout, 1)
  }

  // MARK: - 边界值

  func testFadeEndpoints() {
    XCTAssertEqual(ColorFade.progress(elapsed: 0), 0)
    XCTAssertEqual(ColorFade.progress(elapsed: ColorFade.seconds), 1)
    XCTAssertEqual(ColorFade.progress(elapsed: ColorFade.seconds * 5), 1)
  }

  func testFadeFinishesWithinTheFullRateWindow() {
    XCTAssertLessThanOrEqual(ColorFade.seconds, FramePacing.transitionSeconds)
  }

  func testFadeIsMonotonic() {
    var last = 0.0
    for i in 0...100 {
      let p = ColorFade.progress(elapsed: ColorFade.seconds * Double(i) / 100)
      XCTAssertGreaterThanOrEqual(p, last)
      last = p
    }
  }

  func testSilentVoiceCarriesNoSource() throws {
    let v = try decodeVoice(#"{"speaking":false,"source":"session","sessionId":"w1"}"#)
    XCTAssertNil(v.source)
    XCTAssertNil(v.sessionId)
    XCTAssertNil(VoiceState(speaking: false, source: .session, sessionId: "w1").source)
  }

  func testNarrationEndingReturnsToCyan() {
    let after = Snapshot(agentId: "jv", activity: .idle, voice: VoiceState(), counts: Counts())
    XCTAssertEqual(resolve(after).tint, .cyan)
  }

  // MARK: - 异常路径

  func testOlderHostWithoutSourceCountsAsJarvis() throws {
    XCTAssertEqual(try decodeVoice(#"{"speaking":true}"#).source, .jarvis)
    XCTAssertEqual(VoiceState(speaking: true).source, .jarvis)
  }

  func testUnknownOrMistypedSourceFallsBackToJarvis() throws {
    XCTAssertEqual(try decodeVoice(#"{"speaking":true,"source":"robot"}"#).source, .jarvis)
    let v = try decodeVoice(#"{"speaking":true,"source":42,"sessionId":7}"#)
    XCTAssertEqual(v.source, .jarvis)
    XCTAssertNil(v.sessionId)
  }

  func testFadeRejectsNegativeAndNonFiniteTime() {
    XCTAssertEqual(ColorFade.progress(elapsed: -3), 0)
    XCTAssertEqual(ColorFade.progress(elapsed: .infinity), 1)
    XCTAssertEqual(ColorFade.progress(elapsed: -.infinity), 0)
    XCTAssertEqual(ColorFade.progress(elapsed: .nan), 0)
  }

  func testHostWithoutChangeFeedFallsBackToSleeping() async {
    await api.setWaitVersion(nil)
    let started = Date()
    await model.waitForChange(timeout: 0.2)
    XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.18)
    let waits = await api.waits
    XCTAssertEqual(waits.map(\.after), [-1], "a failed wait keeps the old version")
  }

  func testNegativeTimeoutDoesNotHang() async {
    await api.setWaitVersion(nil)
    let started = Date()
    await model.waitForChange(timeout: -1)
    XCTAssertLessThan(Date().timeIntervalSince(started), 0.5)
  }
}
