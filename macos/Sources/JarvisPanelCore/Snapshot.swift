import Foundation

public enum Activity: String, Sendable, Equatable {
  case idle, awaiting, thinking, speaking
}

public enum SessionStatus: String, Sendable, Equatable {
  case running, waiting, done, failed, idle
}

public enum TaskStatus: String, Decodable, Sendable, Equatable {
  case open, judging, unsatisfied

  public var label: String {
    switch self {
    case .open: return "进行中"
    case .judging: return "判断中"
    case .unsatisfied: return "未完成"
    }
  }
}

public struct TaskInfo: Decodable, Sendable, Equatable {
  public var status: TaskStatus
  public var summary: String?

  public init(status: TaskStatus, summary: String? = nil) {
    self.status = status
    self.summary = summary
  }
}

public struct Counts: Decodable, Sendable, Equatable {
  public var running = 0
  public var pending = 0
  public var unread = 0
  public var failed = 0

  public init(running: Int = 0, pending: Int = 0, unread: Int = 0, failed: Int = 0) {
    self.running = running
    self.pending = pending
    self.unread = unread
    self.failed = failed
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    running = try c.decodeIfPresent(Int.self, forKey: .running) ?? 0
    pending = try c.decodeIfPresent(Int.self, forKey: .pending) ?? 0
    unread = try c.decodeIfPresent(Int.self, forKey: .unread) ?? 0
    failed = try c.decodeIfPresent(Int.self, forKey: .failed) ?? 0
  }

  private enum CodingKeys: String, CodingKey { case running, pending, unread, failed }
}

/// Who announces a managed session's results.
public enum Narration: String, Sendable, Equatable {
  /// The session speaks for itself through voice-mini (host value `self`).
  case session = "self"
  /// Jarvis retells the result in its own voice.
  case relay

  public var toggled: Narration { self == .session ? .relay : .session }
  public var label: String { self == .session ? "自己汇报" : "贾维斯转述" }
}

public struct SessionInfo: Decodable, Sendable, Equatable, Identifiable {
  public var id: String
  public var title: String
  public var status: SessionStatus
  public var unread: Bool
  /// Folder name of the session's working directory; tells same-titled sessions apart.
  public var workspace: String?
  /// Handed to Jarvis: only these are send targets. Older hosts list no others, so absent means true.
  public var managed: Bool
  /// Effective narration; hosts before narration modes send none.
  public var narration: Narration?
  public var task: TaskInfo?

  public init(id: String, title: String, status: SessionStatus, unread: Bool,
              workspace: String? = nil, managed: Bool = true, narration: Narration? = nil, task: TaskInfo? = nil) {
    self.id = id
    self.title = title
    self.status = status
    self.unread = unread
    self.workspace = workspace
    self.managed = managed
    self.narration = narration
    self.task = task
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    status = SessionStatus(rawValue: try c.decodeIfPresent(String.self, forKey: .status) ?? "") ?? .idle
    unread = try c.decodeIfPresent(Bool.self, forKey: .unread) ?? false
    let ws = ((try? c.decodeIfPresent(String.self, forKey: .workspace)) ?? nil)?.trimmingCharacters(in: .whitespaces)
    workspace = (ws?.isEmpty ?? true) ? nil : ws
    managed = ((try? c.decodeIfPresent(Bool.self, forKey: .managed)) ?? nil) ?? true
    narration = ((try? c.decodeIfPresent(String.self, forKey: .narration)) ?? nil).flatMap(Narration.init(rawValue:))
    task = try? c.decodeIfPresent(TaskInfo.self, forKey: .task)
  }

  /// Display name without the "贾维斯-" / "[贾维斯]" worker prefix (SPEC §9.2).
  public var shortName: String {
    var t = title.trimmingCharacters(in: .whitespaces)
    for prefix in ["贾维斯-", "[贾维斯]"] where t.hasPrefix(prefix) {
      t = String(t.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
    return t.isEmpty ? String(id.suffix(8)) : t
  }

  private enum CodingKeys: String, CodingKey { case id, title, status, unread, workspace, managed, narration, task }
}

public enum PendingKind: String, Sendable, Equatable {
  case approval, question
}

public struct PendingItem: Decodable, Sendable, Equatable, Identifiable {
  public var id: String
  public var kind: PendingKind
  public var session: String
  public var title: String
  public var detail: String?
  public var note: String?
  public var choices: [String]
  private var allowsWorkspaceRule: Bool
  public var canAlwaysAllow: Bool { kind == .approval && allowsWorkspaceRule }

  public init(id: String, kind: PendingKind, session: String, title: String,
              detail: String? = nil, note: String? = nil, choices: [String] = [], canAlwaysAllow: Bool = false) {
    self.id = id
    self.kind = kind
    self.session = session
    self.title = title
    self.detail = detail
    self.note = note
    self.choices = choices
    self.allowsWorkspaceRule = canAlwaysAllow
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    kind = PendingKind(rawValue: try c.decodeIfPresent(String.self, forKey: .kind) ?? "") ?? .question
    session = try c.decodeIfPresent(String.self, forKey: .session) ?? ""
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    detail = try c.decodeIfPresent(String.self, forKey: .detail)
    note = try c.decodeIfPresent(String.self, forKey: .note)
    choices = try c.decodeIfPresent([String].self, forKey: .choices) ?? []
    allowsWorkspaceRule = (try? c.decodeIfPresent(Bool.self, forKey: .canAlwaysAllow)) ?? false
  }

  private enum CodingKeys: String, CodingKey { case id, kind, session, title, detail, note, choices, canAlwaysAllow }
}

/// Whose words are playing: Jarvis's own voice, or voice-mini narrating another session.
public enum SpeechSource: String, Sendable, Equatable {
  case jarvis, session
}

/// `paused` / `queued` describe voice-mini's narration queue, which Jarvis only drives.
/// `source` is nil exactly when nothing is speaking.
public struct VoiceState: Decodable, Sendable, Equatable {
  public var speaking = false
  public var source: SpeechSource?
  public var sessionId: String?
  public var text: String?
  public var muted = false
  public var paused = false
  public var queued = 0

  public init(speaking: Bool = false, source: SpeechSource? = nil, sessionId: String? = nil, text: String? = nil,
              muted: Bool = false, paused: Bool = false, queued: Int = 0) {
    self.speaking = speaking
    self.source = speaking ? (source ?? .jarvis) : nil
    self.sessionId = speaking ? sessionId : nil
    self.text = speaking ? text : nil
    self.muted = muted
    self.paused = paused
    self.queued = queued
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    speaking = try c.decodeIfPresent(Bool.self, forKey: .speaking) ?? false
    if speaking {
      let raw = (try? c.decodeIfPresent(String.self, forKey: .source)) ?? nil
      source = raw.flatMap(SpeechSource.init(rawValue:)) ?? .jarvis
      sessionId = (try? c.decodeIfPresent(String.self, forKey: .sessionId)) ?? nil
      text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? nil
    }
    muted = try c.decodeIfPresent(Bool.self, forKey: .muted) ?? false
    paused = try c.decodeIfPresent(Bool.self, forKey: .paused) ?? false
    queued = max(0, try c.decodeIfPresent(Int.self, forKey: .queued) ?? 0)
  }

  /// Something is playing, parked, or waiting to play.
  public var active: Bool { speaking || paused || queued > 0 }

  private enum CodingKeys: String, CodingKey { case speaking, source, sessionId, text, muted, paused, queued }
}

/// GET /jarvis/state. Decoding is lenient so the panel keeps working against an
/// older host that only sends `{agentId, managed, speaking}`.
public struct Snapshot: Decodable, Sendable, Equatable {
  public var agentId: String
  public var activity: Activity
  public var error: String?
  public var voice: VoiceState
  public var counts: Counts
  public var sessions: [SessionInfo]
  public var pending: [PendingItem]
  public var autoApprovals: [AutoApproval]

  public init(agentId: String = "", activity: Activity = .idle, error: String? = nil,
              voice: VoiceState = VoiceState(), counts: Counts = Counts(),
              sessions: [SessionInfo] = [], pending: [PendingItem] = [], autoApprovals: [AutoApproval] = []) {
    self.agentId = agentId
    self.activity = activity
    self.error = error
    self.voice = voice
    self.counts = counts
    self.sessions = sessions
    self.pending = pending
    self.autoApprovals = autoApprovals
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    agentId = try c.decodeIfPresent(String.self, forKey: .agentId) ?? ""
    error = try c.decodeIfPresent(String.self, forKey: .error)
    counts = try c.decodeIfPresent(Counts.self, forKey: .counts) ?? Counts()
    pending = try c.decodeIfPresent([PendingItem].self, forKey: .pending) ?? []
    autoApprovals = ((try? c.decode([LenientAutoApproval].self, forKey: .autoApprovals)) ?? []).compactMap(\.value)

    let legacySpeaking = try c.decodeIfPresent(Bool.self, forKey: .speaking) ?? false
    voice = try c.decodeIfPresent(VoiceState.self, forKey: .voice) ?? VoiceState(speaking: legacySpeaking)
    if let raw = try c.decodeIfPresent(String.self, forKey: .activity) {
      activity = Activity(rawValue: raw) ?? .idle
    } else {
      activity = voice.speaking ? .speaking : .idle
    }

    if let s = try c.decodeIfPresent([SessionInfo].self, forKey: .sessions) {
      sessions = s
    } else {
      let managed = try c.decodeIfPresent([String].self, forKey: .managed) ?? []
      sessions = managed.map { SessionInfo(id: $0, title: "", status: .idle, unread: false) }
    }
  }

  private enum CodingKeys: String, CodingKey {
    case agentId, activity, error, voice, counts, sessions, pending, managed, speaking, autoApprovals
  }
}

public struct ChatMessage: Sendable, Equatable, Identifiable {
  public var id: String
  public var role: String
  public var text: String
  public var routedTo: String?

  public init(id: String, role: String, text: String, routedTo: String? = nil) {
    self.id = id
    self.role = role
    self.text = text
    self.routedTo = routedTo
  }

  public var isMine: Bool { role == "user" }

  /// Laying out a few thousand characters stalls the quick bar for seconds
  /// when it opens, so history bubbles show a cut-down copy.
  public static let previewCharacters = 280
  public static let previewLines = 8

  public var preview: String { Self.preview(text) }

  public static func preview(_ text: String) -> String {
    var lines = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
    var cut = lines.count > previewLines
    if cut { lines = Array(lines.prefix(previewLines)) }
    var s = lines.joined(separator: "\n")
    if s.count > previewCharacters {
      s = String(s.prefix(previewCharacters))
      cut = true
    }
    guard cut else { return text }
    return s.trimmingCharacters(in: .whitespacesAndNewlines) + "…"
  }
}

/// GET /jarvis/messages. Tool results and empty messages are dropped (spec §6.3);
/// messages without a stable id get a positional one.
public enum ChatMessages {
  private struct Wire: Decodable {
    struct Item: Decodable {
      var id: String?
      var role: String?
      var text: String?
      var routedTo: String?
    }
    var messages: [Item]
  }

  public static func decode(_ data: Data) throws -> [ChatMessage] {
    let wire = try JSONDecoder().decode(Wire.self, from: data)
    return wire.messages.enumerated().compactMap { index, m in
      let role = m.role ?? ""
      let text = (m.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard role != "tool", !text.isEmpty else { return nil }
      return ChatMessage(id: m.id ?? "m\(index)", role: role, text: text, routedTo: m.routedTo)
    }
  }
}
