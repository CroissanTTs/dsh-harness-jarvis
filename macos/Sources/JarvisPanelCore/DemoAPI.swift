import Foundation

/// Offline stand-in for the host (JARVIS_DEMO=1). Cycles through every orb
/// state on a fixed period so the whole UI can be reviewed without DSH.
public actor DemoAPI: JarvisAPI {
  public static let scenePeriod: TimeInterval = 6

  private let start: Date
  private var muted = false
  private var answered: Set<String> = []
  private var answeredCycle = -1
  private var extraMessages: [ChatMessage] = []
  private var read = false
  private var pinned: Int?

  public init(start: Date = Date()) {
    self.start = start
  }

  private enum Scene: Int, CaseIterable {
    case idle, awaiting, thinking, speaking, attention, failed, narrating
  }

  /// Freezes the demo on one scene (0 idle … 6 narrating, wrapping); nil resumes the clock.
  public func setScene(_ index: Int?) {
    pinned = index
  }

  private func scene(at now: Date) -> (Scene, cycle: Int) {
    if let pinned { return (Scene(rawValue: pinned % Scene.allCases.count)!, 0) }
    let elapsed = max(0, now.timeIntervalSince(start))
    let index = Int(elapsed / Self.scenePeriod)
    return (Scene(rawValue: index % Scene.allCases.count)!, index / Scene.allCases.count)
  }

  private let sessions = [
    SessionInfo(id: "demo-hammer", title: "贾维斯-hammer", status: .running, unread: false, workspace: "hammer"),
    SessionInfo(id: "demo-anvil", title: "贾维斯-anvil", status: .waiting, unread: false, workspace: "anvil"),
    SessionInfo(id: "demo-docs", title: "贾维斯-docs", status: .done, unread: true, workspace: "docs"),
    SessionInfo(id: "demo-quant", title: "量化回测", status: .idle, unread: false, workspace: "Quant", managed: false),
    SessionInfo(id: "demo-dev", title: "贾维斯", status: .idle, unread: false, workspace: "dsh-plugin-discovery", managed: false),
  ]
  private var managedOverride: [String: Bool] = [:]

  private let demoPending = [
    PendingItem(id: "demo-p1", kind: .approval, session: "demo-hammer", title: "请求执行",
                detail: "rm -rf node_modules && pnpm i", note: "依赖损坏后重装，只影响项目目录。"),
    PendingItem(id: "demo-p2", kind: .question, session: "demo-anvil", title: "数据库迁移用哪个方案？",
                choices: ["保留旧表", "直接替换"]),
  ]

  /// Answers and read state last for one pass through the scenes.
  @discardableResult
  private func syncCycle() -> Scene {
    let (scene, cycle) = scene(at: Date())
    if cycle != answeredCycle { answered = []; answeredCycle = cycle; read = false }
    return scene
  }

  public func snapshot() async throws -> Snapshot {
    let scene = syncCycle()
    let pending = scene == .attention ? demoPending.filter { !answered.contains($0.id) } : []
    let activity: Activity
    switch scene {
    case .awaiting: activity = .awaiting
    case .thinking: activity = .thinking
    case .speaking, .narrating: activity = .speaking
    default: activity = .idle
    }
    var list = sessions.map { s -> SessionInfo in
      var s = s
      if let on = managedOverride[s.id] { s.managed = on }
      return s
    }
    if read { list = list.map { var s = $0; s.unread = false; return s } }
    if scene == .failed { list[0].status = .failed }
    let voice: VoiceState
    switch scene {
    case .speaking: voice = VoiceState(speaking: true, source: .jarvis, muted: muted, queued: 2)
    case .narrating: voice = VoiceState(speaking: true, source: .session, sessionId: "demo-docs", muted: muted)
    default: voice = VoiceState(muted: muted)
    }
    return Snapshot(
      agentId: "demo-jarvis",
      activity: activity,
      error: nil,
      voice: voice,
      counts: Counts(running: scene == .failed ? 1 : 2, pending: pending.count,
                     unread: read ? 0 : 1, failed: scene == .failed ? 1 : 0),
      sessions: list,
      pending: pending
    )
  }

  public func waitForChange(after: Int, timeout: TimeInterval) async throws -> Int {
    try await Task.sleep(for: .seconds(max(0, timeout)))
    return after + 1
  }

  public func setManaged(session: String, managed: Bool) async throws {
    guard sessions.contains(where: { $0.id == session }) else { throw JarvisAPIError.http(404) }
    managedOverride[session] = managed
  }

  public func messages(session: String?) async throws -> [ChatMessage] {
    if let session {
      return [
        ChatMessage(id: "\(session)-u", role: "user", text: "修完测试后跑一遍 lint"),
        ChatMessage(id: "\(session)-a", role: "assistant", text: "lint 通过，改了 2 个文件的导入顺序。"),
      ]
    }
    return [
      ChatMessage(id: "d1", role: "assistant", text: "hammer 的测试还剩 28 个在跑。"),
      ChatMessage(id: "d2", role: "user", text: "让 hammer 修完测试后跑一遍 lint"),
      ChatMessage(id: "d3", role: "assistant", text: "好的，已转告。", routedTo: "demo-hammer"),
      ChatMessage(id: "d4", role: "assistant", text: "docs 那边完成了，更新了 3 个文件。"),
    ] + extraMessages
  }

  public func send(text: String, target: String?) async throws {
    let n = extraMessages.count
    extraMessages.append(ChatMessage(id: "u\(n)", role: "user", text: text))
    let reply = target == nil ? "收到。" : "好的，已转告。"
    extraMessages.append(ChatMessage(id: "a\(n)", role: "assistant", text: reply, routedTo: target))
  }

  public func answer(_ answer: PendingAnswer) async throws {
    syncCycle()
    switch answer {
    case .decision(let id, _), .choice(let id, _), .text(let id, _):
      guard demoPending.contains(where: { $0.id == id }), !answered.contains(id) else {
        throw JarvisAPIError.http(404)
      }
      answered.insert(id)
    }
  }

  public func voice(_ action: VoiceAction) async throws {
    switch action {
    case .mute: muted = true
    case .unmute: muted = false
    case .pause, .resume, .skip, .clear: break
    }
  }

  public func markRead(session: String?) async throws {
    syncCycle()
    read = true
  }

  public func open(session: String) async throws {}
}
