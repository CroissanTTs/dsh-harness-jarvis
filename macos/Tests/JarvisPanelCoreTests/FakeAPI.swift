import Foundation
@testable import JarvisPanelCore

/// Scriptable test double: set results/errors, then inspect recorded calls.
actor FakeAPI: JarvisAPI {
  var snapshotResult: Result<Snapshot, JarvisAPIError> = .success(Snapshot(agentId: "jv"))
  var messagesResult: Result<[ChatMessage], JarvisAPIError> = .success([])
  var sendError: JarvisAPIError?
  var answerError: JarvisAPIError?
  var voiceError: JarvisAPIError?
  /// nil → behaves like an old host without /jarvis/wait (404).
  var waitVersion: Int?
  private(set) var waits: [(after: Int, timeout: TimeInterval)] = []

  private(set) var snapshotCalls = 0
  private(set) var sent: [(text: String, target: String?)] = []
  private(set) var answers: [PendingAnswer] = []
  private(set) var voices: [VoiceAction] = []
  private(set) var reads: [String?] = []
  private(set) var opened: [String] = []

  func setSnapshot(_ s: Snapshot) { snapshotResult = .success(s) }
  func setSnapshotError(_ e: JarvisAPIError) { snapshotResult = .failure(e) }
  func setSendError(_ e: JarvisAPIError?) { sendError = e }
  func setAnswerError(_ e: JarvisAPIError?) { answerError = e }
  func setVoiceError(_ e: JarvisAPIError?) { voiceError = e }
  func setWaitVersion(_ v: Int?) { waitVersion = v }

  private var rules: [ApprovalRule] = []
  private var rulesError: JarvisAPIError?
  private var removeRuleError: JarvisAPIError?
  private var rulesDelay: TimeInterval = 0
  private(set) var removedRules: [ApprovalRule.Identity] = []
  func setApprovalRules(_ value: [ApprovalRule]) { rules = value }
  func setApprovalRulesError(_ value: JarvisAPIError?) { rulesError = value }
  func setRemoveRuleError(_ value: JarvisAPIError?) { removeRuleError = value }
  func setApprovalRulesDelay(_ value: TimeInterval) { rulesDelay = value }
  func approvalRules() async throws -> [ApprovalRule] {
    if rulesDelay > 0 { try await Task.sleep(for: .seconds(rulesDelay)) }
    if let rulesError { throw rulesError }
    return rules
  }
  func removeApprovalRule(_ identity: ApprovalRule.Identity) async throws {
    removedRules.append(identity)
    if rulesDelay > 0 { try await Task.sleep(for: .seconds(rulesDelay)) }
    if let removeRuleError { throw removeRuleError }
    rules.removeAll { $0.identity == identity }
  }

  func snapshot() async throws -> Snapshot {
    snapshotCalls += 1
    return try snapshotResult.get()
  }

  func waitForChange(after: Int, timeout: TimeInterval) async throws -> Int {
    waits.append((after, timeout))
    guard let waitVersion else { throw JarvisAPIError.http(404) }
    return waitVersion
  }

  private(set) var messageRequests: [String?] = []
  private(set) var managedCalls: [(session: String, managed: Bool)] = []
  var managedError: JarvisAPIError?
  /// Per-session conversations; falls back to `messagesResult`.
  var sessionMessages: [String: [ChatMessage]] = [:]
  /// Seconds each `messages` call takes, to exercise target switches mid-load.
  var messagesDelay: TimeInterval = 0

  func setManagedError(_ e: JarvisAPIError?) { managedError = e }
  func setSessionMessages(_ id: String, _ list: [ChatMessage]) { sessionMessages[id] = list }
  func setMessagesDelay(_ s: TimeInterval) { messagesDelay = s }

  func messages(session: String?) async throws -> [ChatMessage] {
    messageRequests.append(session)
    if messagesDelay > 0 { try? await Task.sleep(for: .seconds(messagesDelay)) }
    if let session, let list = sessionMessages[session] { return list }
    return try messagesResult.get()
  }

  var managedDelay: TimeInterval = 0
  func setManagedDelay(_ s: TimeInterval) { managedDelay = s }

  func setManaged(session: String, managed: Bool) async throws {
    managedCalls.append((session, managed))
    if managedDelay > 0 { try? await Task.sleep(for: .seconds(managedDelay)) }
    if let managedError { throw managedError }
  }

  private(set) var narrationCalls: [(session: String, narration: Narration?)] = []
  var narrationError: JarvisAPIError?
  func setNarrationError(_ e: JarvisAPIError?) { narrationError = e }

  func setNarration(session: String, narration: Narration?) async throws {
    narrationCalls.append((session, narration))
    if managedDelay > 0 { try? await Task.sleep(for: .seconds(managedDelay)) }
    if let narrationError { throw narrationError }
  }

  func send(text: String, target: String?) async throws {
    if let sendError { throw sendError }
    sent.append((text, target))
  }

  func answer(_ answer: PendingAnswer) async throws {
    if let answerError { throw answerError }
    answers.append(answer)
  }

  func voice(_ action: VoiceAction) async throws {
    voices.append(action)
    if let voiceError { throw voiceError }
  }

  func markRead(session: String?) async throws {
    reads.append(session)
  }

  func open(session: String) async throws {
    opened.append(session)
  }
}
