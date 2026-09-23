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

  public init(start: Date = Date()) {
    self.start = start
  }

  private enum Scene: Int, CaseIterable {
    case idle, awaiting, thinking, speaking, attention, failed
  }

  private func scene(at now: Date) -> (Scene, cycle: Int) {
    let elapsed = max(0, now.timeIntervalSince(start))
    let index = Int(elapsed / Self.scenePeriod)
    return (Scene(rawValue: index % Scene.allCases.count)!, index / Scene.allCases.count)
  }

  private let sessions = [
    SessionInfo(id: "demo-hammer", title: "贾维斯-hammer", status: .running, unread: false),
    SessionInfo(id: "demo-anvil", title: "贾维斯-anvil", status: .waiting, unread: false),
    SessionInfo(id: "demo-docs", title: "贾维斯-docs", status: .done, unread: true),
  ]

  private let demoPending = [
    PendingItem(id: "demo-p1", kind: .approval, session: "demo-hammer", title: "请求执行",
                detail: "rm -rf node_modules && pnpm i", note: "依赖损坏后重装，只影响项目目录。"),
    PendingItem(id: "demo-p2", kind: .question, session: "demo-anvil", title: "数据库迁移用哪个方案？",
                choices: ["保留旧表", "直接替换"]),
  ]

  public func snapshot() async throws -> Snapshot {
    let (scene, cycle) = scene(at: Date())
    if cycle != answeredCycle { answered = []; answeredCycle = cycle; read = false }
    let pending = scene == .attention ? demoPending.filter { !answered.contains($0.id) } : []
    let activity: Activity
    switch scene {
    case .awaiting: activity = .awaiting
    case .thinking: activity = .thinking
    case .speaking: activity = .speaking
    default: activity = .idle
    }
    var list = sessions
    if read { list = list.map { var s = $0; s.unread = false; return s } }
    if scene == .failed { list[0].status = .failed }
    return Snapshot(
      agentId: "demo-jarvis",
      activity: activity,
      error: nil,
      voice: VoiceState(speaking: scene == .speaking, muted: muted),
      counts: Counts(running: scene == .failed ? 1 : 2, pending: pending.count,
                     unread: read ? 0 : 1, failed: scene == .failed ? 1 : 0),
      sessions: list,
      pending: pending
    )
  }

  public func messages() async throws -> [ChatMessage] {
    [
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
    case .pause: break
    }
  }

  public func markRead(session: String?) async throws {
    read = true
  }

  public func open(session: String) async throws {}
}
