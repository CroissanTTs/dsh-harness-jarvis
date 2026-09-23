import Foundation

/// Runtime discovery file written by the host plugin. The Desktop shell's
/// webServer rejects routes lacking the renderer capability header (even on
/// loopback), so it is sent on every request.
struct RuntimeFile: Decodable {
  struct Header: Decodable {
    var name: String
    var value: String
  }
  var origin: String
  var token: String
  var rendererHeader: Header?
  var pid: Int32?
}

/// HTTP client for the host plugin's /jarvis/* routes. The runtime file is
/// re-read on every call so a host restart (new port/token) is picked up
/// without relaunching the panel.
public final class JarvisClient: JarvisAPI, @unchecked Sendable {
  private let runtimeURL: URL
  private let session: URLSession
  private let lock = NSLock()
  private var cachedHostPid: Int32 = 0

  public init(runtimeURL: URL = JarvisClient.defaultRuntimeURL, session: URLSession = .shared) {
    self.runtimeURL = runtimeURL
    self.session = session
  }

  public static var defaultRuntimeURL: URL {
    if let override = ProcessInfo.processInfo.environment["JARVIS_RUNTIME_FILE"] {
      return URL(fileURLWithPath: override)
    }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh/jarvis/runtime.json")
  }

  /// DSH Desktop pid from the last successful runtime read (0 = unknown).
  public var hostPid: Int32 {
    lock.lock(); defer { lock.unlock() }
    return cachedHostPid
  }

  public func snapshot() async throws -> Snapshot {
    let data = try await request("GET", "/jarvis/state")
    do { return try JSONDecoder().decode(Snapshot.self, from: data) } catch { throw JarvisAPIError.decoding }
  }

  public func messages() async throws -> [ChatMessage] {
    let data = try await request("GET", "/jarvis/messages")
    do { return try ChatMessages.decode(data) } catch { throw JarvisAPIError.decoding }
  }

  public func send(text: String, target: String?) async throws {
    var body: [String: Any] = ["text": text]
    if let target { body["session"] = target }
    _ = try await request("POST", "/jarvis/input", body: body)
  }

  public func answer(_ answer: PendingAnswer) async throws {
    let body: [String: Any]
    switch answer {
    case .decision(let id, let allow): body = ["id": id, "decision": allow ? "allow" : "deny"]
    case .choice(let id, let choice): body = ["id": id, "choice": choice]
    case .text(let id, let text): body = ["id": id, "text": text]
    }
    _ = try await request("POST", "/jarvis/pending/answer", body: body)
  }

  public func voice(_ action: VoiceAction) async throws {
    _ = try await request("POST", "/jarvis/voice", body: ["action": action.rawValue])
  }

  public func markRead(session: String?) async throws {
    var body: [String: Any] = [:]
    if let session { body["session"] = session }
    _ = try await request("POST", "/jarvis/read", body: body)
  }

  public func open(session: String) async throws {
    _ = try await request("POST", "/jarvis/open", body: ["session": session])
  }

  private func loadRuntime() throws -> RuntimeFile {
    guard let data = try? Data(contentsOf: runtimeURL) else { throw JarvisAPIError.noRuntime }
    guard let file = try? JSONDecoder().decode(RuntimeFile.self, from: data) else { throw JarvisAPIError.noRuntime }
    lock.lock()
    cachedHostPid = file.pid ?? 0
    lock.unlock()
    return file
  }

  private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
    let runtime = try loadRuntime()
    guard let url = URL(string: runtime.origin + path) else { throw JarvisAPIError.noRuntime }
    var req = URLRequest(url: url, timeoutInterval: 5)
    req.httpMethod = method
    req.setValue("Bearer \(runtime.token)", forHTTPHeaderField: "Authorization")
    if let h = runtime.rendererHeader { req.setValue(h.value, forHTTPHeaderField: h.name) }
    if let body {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: req)
    } catch {
      throw JarvisAPIError.transport(error.localizedDescription)
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw JarvisAPIError.http(status) }
    return data
  }
}
