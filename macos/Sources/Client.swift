import Foundation

// Runtime discovery file written by the host plugin (dsh-harness-jarvis).
// Mirrors dsh-notch/voice-mini: origin + bearer token + the Desktop shell's
// renderer capability header. The shell's webServer 403s routes lacking the
// rendererHeader (even on loopback), so we MUST send it on every request.
struct RendererHeader: Decodable {
  var name: String
  var value: String
}

struct RuntimeFile: Decodable {
  var origin: String
  var token: String
  var rendererHeader: RendererHeader?
  var pid: pid_t?
}

struct JarvisState: Decodable {
  var agentId: String
  var managed: [String]
  var speaking: Bool?
}

struct JarvisToolCall: Decodable {
  var name: String
  var args: String
}

struct JarvisMessage: Decodable, Identifiable {
  var role: String
  var text: String
  var toolCalls: [JarvisToolCall]?
  var id: String { role + text + (toolCalls?.first?.name ?? "") }
}

struct JarvisMessages: Decodable {
  var messages: [JarvisMessage]
  var count: Int
}

struct JarvisAgent: Decodable, Identifiable {
  var id: String
  var title: String
  var hasInject: Bool
  var hasFollowup: Bool
}

struct JarvisAgentsResponse: Decodable {
  var agents: [JarvisAgent]
  var count: Int
}

enum JarvisClientError: Error {
  case noRuntime
  case http(Int)
}

/// HTTP client for the host plugin's /jarvis/* routes. Stateless aside from the
/// cached origin+token, which it reloads from the runtime file on every call
/// (so a host restart with a new port/token is picked up without a relaunch).
final class JarvisClient: @unchecked Sendable {
  private var origin = ""
  private var token = ""
  private var rendererHeader: RendererHeader?
  /// Host (DSH Desktop) process id — read from runtime.json so the panel can
  /// tell "DSH Desktop is frontmost" (show orb) from "another app / fullscreen
  /// video / Mission Control is frontmost" (hide orb).
  private(set) var hostPid: pid_t = 0

  /// Path to the runtime file. Override with JARVIS_RUNTIME_FILE for tests;
  /// default ~/.dsh/jarvis/runtime.json.
  private var runtimeURL: URL {
    if let override = ProcessInfo.processInfo.environment["JARVIS_RUNTIME_FILE"] {
      return URL(fileURLWithPath: override)
    }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".dsh/jarvis/runtime.json")
  }

  private func reloadRuntime() throws {
    let data = try Data(contentsOf: runtimeURL)
    let file = try JSONDecoder().decode(RuntimeFile.self, from: data)
    origin = file.origin
    token = file.token
    rendererHeader = file.rendererHeader
    hostPid = file.pid ?? 0
  }

  /// GET /jarvis/state → { agentId, managed: [...] }.
  func state() async throws -> JarvisState {
    try reloadRuntime()
    var request = try makeRequest("/jarvis/state")
    request.httpMethod = "GET"
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfBad(response)
    return try JSONDecoder().decode(JarvisState.self, from: data)
  }

  /// GET /jarvis/messages → the Jarvis session's conversation (last 20 msgs).
  /// Displayed in the悬浮窗 so the user sees Jarvis's replies inline (the session
  /// may not be visible in DSH Desktop's workspace).
  func messages() async throws -> JarvisMessages {
    try reloadRuntime()
    var request = try makeRequest("/jarvis/messages")
    request.httpMethod = "GET"
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfBad(response)
    return try JSONDecoder().decode(JarvisMessages.self, from: data)
  }

  /// GET /jarvis/agents → available sessions (for the session picker).
  func agents() async throws -> [JarvisAgent] {
    try reloadRuntime()
    var request = try makeRequest("/jarvis/agents")
    request.httpMethod = "GET"
    let (data, response) = try await URLSession.shared.data(for: request)
    try throwIfBad(response)
    let decoded = try JSONDecoder().decode(JarvisAgentsResponse.self, from: data)
    return decoded.agents
  }

  /// POST /jarvis/input { text, session? } → Jarvis processes the text. If a
  /// session is provided, Jarvis is told to inject into that session.
  func input(text: String, session: String? = nil) async throws {
    try reloadRuntime()
    var request = try makeRequest("/jarvis/input")
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    var body: [String: Any] = ["text": text]
    if let s = session { body["session"] = s }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (_, response) = try await URLSession.shared.data(for: request)
    try throwIfBad(response)
  }

  private func makeRequest(_ path: String) throws -> URLRequest {
    if origin.isEmpty { try reloadRuntime() }
    guard let url = URL(string: origin + path) else { throw JarvisClientError.noRuntime }
    var request = URLRequest(url: url, timeoutInterval: 5)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let h = rendererHeader {
      request.setValue(h.value, forHTTPHeaderField: h.name)
    }
    return request
  }

  private func throwIfBad(_ response: URLResponse) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status < 200 || status >= 300 { throw JarvisClientError.http(status) }
  }
}
