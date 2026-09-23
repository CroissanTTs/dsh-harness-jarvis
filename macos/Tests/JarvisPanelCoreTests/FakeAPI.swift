import Foundation
@testable import JarvisPanelCore

/// Scriptable test double: set results/errors, then inspect recorded calls.
actor FakeAPI: JarvisAPI {
  var snapshotResult: Result<Snapshot, JarvisAPIError> = .success(Snapshot(agentId: "jv"))
  var messagesResult: Result<[ChatMessage], JarvisAPIError> = .success([])
  var sendError: JarvisAPIError?
  var answerError: JarvisAPIError?

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

  func snapshot() async throws -> Snapshot {
    snapshotCalls += 1
    return try snapshotResult.get()
  }

  func messages() async throws -> [ChatMessage] {
    try messagesResult.get()
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
  }

  func markRead(session: String?) async throws {
    reads.append(session)
  }

  func open(session: String) async throws {
    opened.append(session)
  }
}
