import XCTest
@testable import JarvisPanelCore

final class OrbStateResolverTests: XCTestCase {
  private func snap(_ activity: Activity = .idle, _ counts: Counts = Counts(), error: String? = nil) -> Snapshot {
    Snapshot(agentId: "jv", activity: activity, error: error, counts: counts)
  }

  private func snap(counts: Counts) -> Snapshot {
    snap(.idle, counts)
  }

  private func resolve(_ s: Snapshot?, connected: Bool = true, standby: Bool = false) -> OrbAppearance {
    OrbStateResolver.resolve(snapshot: s, connected: connected, standby: standby)
  }

  func testOfflineIsRedErrorWithoutBadge() {
    XCTAssertEqual(resolve(snap(counts: Counts(running: 2)), connected: false),
                   OrbAppearance(motion: .error, tint: .red, badge: nil))
  }

  func testNoSnapshotYetIsOffline() {
    XCTAssertEqual(resolve(nil).tint, .red)
  }

  func testHostReportedErrorIsRed() {
    XCTAssertEqual(resolve(snap(error: "llm down")).motion, .error)
  }

  func testOfflineWhileSpeakingKeepsSpeakingMotionInRed() {
    let a = resolve(snap(.speaking), connected: false)
    XCTAssertEqual(a.motion, .speaking)
    XCTAssertEqual(a.tint, .red)
  }

  func testPendingBeatsFailed() {
    XCTAssertEqual(resolve(snap(counts: Counts(pending: 1, failed: 2))),
                   OrbAppearance(motion: .attention, tint: .amber,
                                 badge: Badge(count: 1, tint: .amber, unreadDot: false)))
  }

  func testFailedOnly() {
    XCTAssertEqual(resolve(snap(counts: Counts(failed: 2))),
                   OrbAppearance(motion: .error, tint: .red, badge: Badge(count: 2, tint: .red, unreadDot: false)))
  }

  func testRunningWithUnread() {
    XCTAssertEqual(resolve(snap(counts: Counts(running: 2, unread: 1))),
                   OrbAppearance(motion: .idle, tint: .cyan, badge: Badge(count: 2, tint: .cyan, unreadDot: true)))
  }

  func testUnreadOnlyShowsDotOnlyBadge() {
    XCTAssertEqual(resolve(snap(counts: Counts(unread: 1))).badge, Badge(count: 0, tint: .cyan, unreadDot: true))
  }

  func testAllZeroHasNoBadge() {
    XCTAssertEqual(resolve(snap()), OrbAppearance(motion: .idle, tint: .cyan, badge: nil))
  }

  func testInputOpenMeansAwaiting() {
    XCTAssertEqual(resolve(snap(), standby: true).motion, .awaiting)
  }

  func testHostAwaiting() {
    XCTAssertEqual(resolve(snap(.awaiting)).motion, .awaiting)
  }

  func testThinkingWithPendingIsAmberThinking() {
    let a = resolve(snap(.thinking, Counts(pending: 1)))
    XCTAssertEqual(a.motion, .thinking)
    XCTAssertEqual(a.tint, .amber)
  }

  func testSpeakingBeatsThinkingState() {
    XCTAssertEqual(resolve(snap(.speaking, Counts(pending: 1))).motion, .speaking)
  }

  func testAttentionBeatsAwaiting() {
    XCTAssertEqual(resolve(snap(.awaiting, Counts(pending: 1)), standby: true).motion, .attention)
  }
}
