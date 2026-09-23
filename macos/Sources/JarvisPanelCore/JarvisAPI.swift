import Foundation

public enum PendingAnswer: Sendable, Equatable {
  case decision(id: String, allow: Bool)
  case choice(id: String, choice: String)
  case text(id: String, text: String)
}

public enum VoiceAction: String, Sendable, Equatable {
  case pause, resume, skip, clear, mute, unmute
}

public enum JarvisAPIError: Error, Sendable, Equatable {
  case noRuntime
  case http(Int)
  case transport(String)
  case decoding
}

extension JarvisAPIError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .noRuntime: return "找不到贾维斯插件（runtime.json 不存在）"
    case .http(let code): return "HTTP \(code)"
    case .transport(let message): return message
    case .decoding: return "返回数据无法解析"
    }
  }
}

/// Everything the panel needs from the host plugin. `target == nil` in `send`
/// means "talk to Jarvis directly" (no injection into a worker session).
public protocol JarvisAPI: Sendable {
  func snapshot() async throws -> Snapshot
  func messages() async throws -> [ChatMessage]
  func send(text: String, target: String?) async throws
  func answer(_ answer: PendingAnswer) async throws
  func voice(_ action: VoiceAction) async throws
  func markRead(session: String?) async throws
  func open(session: String) async throws
}
