import Foundation
import Combine

public enum Target: Equatable, Sendable {
  case jarvis
  case session(String)

  var storageKey: String {
    switch self {
    case .jarvis: return "jarvis"
    case .session(let id): return id
    }
  }

  public var sessionID: String? {
    if case .session(let id) = self { return id }
    return nil
  }
}

public struct TargetOption: Identifiable, Equatable, Sendable {
  public var id: String { target.storageKey }
  public var target: Target
  public var label: String
  public var status: SessionStatus?
  public var task: TaskInfo? = nil
  public var narration: Narration? = nil
}

public enum Connection: Equatable, Sendable {
  case connecting, online
  case offline(String)
}

/// Buttons on the hover arc: playback controls while voice is active, otherwise mute + history.
public enum HoverButton: Equatable, Sendable {
  case pause, resume, skip, clear, mute, unmute, history

  public var help: String {
    switch self {
    case .pause: return "暂停"
    case .resume: return "继续"
    case .skip: return "跳过这条"
    case .clear: return "清空队列"
    case .mute: return "静音"
    case .unmute: return "取消静音"
    case .history: return "对话记录"
    }
  }

  public var voiceAction: VoiceAction? {
    switch self {
    case .pause: return .pause
    case .resume: return .resume
    case .skip: return .skip
    case .clear: return .clear
    case .mute: return .mute
    case .unmute: return .unmute
    case .history: return nil
    }
  }
}

/// View model for the orb + quick-reply bar. Owns the host snapshot, the draft,
/// the explicit send target (SPEC §12: no auto-routing) and pending answers.
@MainActor
public final class PanelModel: ObservableObject {
  public static let maxVisiblePending = 3
  public static let maxVisibleAutoApprovals = 5
  @Published public private(set) var revokingAutoApproval: ApprovalRule.Identity?
  @Published public private(set) var autoApprovalError: String?
  private var revokedAutoApprovalIDs: Set<String> = []

  @Published public private(set) var snapshot: Snapshot?
  @Published public private(set) var connection: Connection = .connecting
  @Published public private(set) var messages: [ChatMessage] = []
  @Published public private(set) var sendError: String?
  @Published public private(set) var toast: String?
  @Published public private(set) var answeringID: String?
  @Published public var draft = ""
  /// The history shows the target's own conversation, so switching reloads it.
  @Published public var target: Target = .jarvis {
    didSet {
      guard target != oldValue, quickBarOpen, historyExpanded else { return }
      messages = []
      Task { await loadMessages() }
    }
  }
  @Published public private(set) var quickBarOpen = false
  @Published public private(set) var escapeHint = false
  private var escapeGate = EscapeGate()
  private var escapeHintTask: Task<Void, Never>?
  @Published public private(set) var historyExpanded = false
  /// The pointer is over the orb: it shows standby, as when the quick bar is open.
  @Published public private(set) var hovering = false

  @Published public private(set) var caption: Caption?
  private var captionState = CaptionState()
  private var captionTask: Task<Void, Never>?

  public var captionText: String? {
    guard let caption else { return nil }
    guard caption.source == .session else { return caption.text }
    let name = caption.sessionId.map { label(for: .session($0)) } ?? "其他会话"
    return "\(name)：\(caption.text)"
  }

  public func refreshCaptions() {
    captionTask?.cancel()
    let now = ProcessInfo.processInfo.systemUptime
    caption = captionState.caption(now: now, enabled: store.settings.showCaptions)
    guard caption != nil, let end = captionState.lastEnd else { return }
    let remaining = max(0, CaptionState.holdDuration - (now - end))
    captionTask = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
      guard let self else { return }
      caption = captionState.caption(now: ProcessInfo.processInfo.systemUptime, enabled: store.settings.showCaptions)
    }
  }

  private let api: JarvisAPI
  private let store: SettingsStore

  public init(api: JarvisAPI, store: SettingsStore) {
    self.api = api
    self.store = store
    historyExpanded = store.settings.historyExpanded
  }

  // MARK: Derived

  public var appearance: OrbAppearance {
    OrbStateResolver.resolve(snapshot: snapshot, connected: connection == .online, standby: quickBarOpen || hovering)
  }

  public static let jarvisLabel = "贾维斯"

  /// Jarvis plus the sessions handed to it.
  public var targets: [TargetOption] {
    [TargetOption(target: .jarvis, label: Self.jarvisLabel, status: nil)]
      + (snapshot?.sessions ?? []).filter(\.managed).map(option)
  }

  /// Sessions that could be handed to Jarvis.
  public var candidates: [TargetOption] {
    (snapshot?.sessions ?? []).filter { !$0.managed }.map(option)
  }

  private func option(_ s: SessionInfo) -> TargetOption {
    TargetOption(target: .session(s.id), label: displayName(s), status: s.status, task: s.task, narration: s.narration)
  }

  /// A session named like Jarvis itself, or like another session, gets its
  /// workspace folder appended; the id tail breaks any tie that remains.
  private func displayName(_ session: SessionInfo) -> String {
    let name = session.shortName
    let others = (snapshot?.sessions ?? []).filter { $0.id != session.id && $0.shortName == name }
    guard name == Self.jarvisLabel || !others.isEmpty else { return name }
    if let ws = session.workspace, !others.contains(where: { $0.workspace == ws }) { return "\(name) · \(ws)" }
    return "\(name) · \(session.id.suffix(6))"
  }

  public var visiblePending: [PendingItem] {
    Array((snapshot?.pending ?? []).prefix(Self.maxVisiblePending))
  }

  public var visibleAutoApprovals: [AutoApproval] {
    var seen: Set<String> = []
    return Array((snapshot?.autoApprovals ?? []).sorted { $0.at > $1.at }
      .filter { seen.insert($0.id).inserted }.prefix(Self.maxVisibleAutoApprovals)).map { entry in
        var entry = entry
        if revokedAutoApprovalIDs.contains(entry.id) { entry.rule = nil }
        return entry
      }
  }

  /// Revoking the saved preset does not undo an operation that already ran.
  public func revokeAutoApproval(_ entry: AutoApproval) async {
    guard revokingAutoApproval == nil,
          let rule = visibleAutoApprovals.first(where: { $0.id == entry.id })?.rule else { return }
    revokingAutoApproval = rule
    defer { revokingAutoApproval = nil }
    do {
      try await api.removeApprovalRule(rule)
    } catch JarvisAPIError.http(404) {
      // A different client already removed the same exact preset.
    } catch {
      autoApprovalError = "撤销规则失败：\(error.localizedDescription)"
      return
    }
    revokedAutoApprovalIDs.formUnion((snapshot?.autoApprovals ?? []).filter { $0.rule == rule }.map(\.id))
    autoApprovalError = nil
    await refresh()
  }

  public var hiddenPendingCount: Int {
    max(0, (snapshot?.pending.count ?? 0) - Self.maxVisiblePending)
  }

  public var answeringItem: PendingItem? {
    guard let answeringID else { return nil }
    return snapshot?.pending.first { $0.id == answeringID }
  }

  public var hoverButtons: [HoverButton] {
    let voice = snapshot?.voice ?? VoiceState()
    if voice.active { return [voice.paused ? .resume : .pause, .skip, .clear] }
    return [voice.muted ? .unmute : .mute, .history]
  }

  public func label(for target: Target) -> String {
    switch target {
    case .jarvis: return Self.jarvisLabel
    case .session(let id):
      if let agent = snapshot?.agentId, !agent.isEmpty, id == agent { return Self.jarvisLabel }
      return snapshot?.sessions.first { $0.id == id }.map(displayName) ?? String(id.suffix(8))
    }
  }

  // MARK: Polling

  public func refresh() async {
    do {
      snapshot = try await api.snapshot()
      connection = .online
      captionState.update(snapshot?.voice ?? VoiceState(), now: ProcessInfo.processInfo.systemUptime)
      refreshCaptions()
    } catch {
      connection = .offline(Self.describe(error))
      captionState.update(VoiceState(), now: ProcessInfo.processInfo.systemUptime)
      refreshCaptions()
      return
    }
    if quickBarOpen && historyExpanded {
      await loadMessages()
    }
  }

  private var hostVersion = -1

  /// Returns as soon as the host reports a change (speech start/end, turns,
  /// pending) or after `timeout`. Against a host without the change feed, or
  /// while it is unreachable, this is a plain `timeout` sleep.
  public func waitForChange(timeout: TimeInterval) async {
    do {
      hostVersion = try await api.waitForChange(after: hostVersion, timeout: timeout)
      // A line's end and the next line's start arrive back to back; read them as one change.
      try? await Task.sleep(for: .milliseconds(50))
    } catch {
      try? await Task.sleep(for: .seconds(max(0, timeout)))
    }
  }

  private func loadMessages() async {
    let wanted = target
    guard let list = try? await api.messages(session: wanted.sessionID) else { return }
    // A slower load for the previous target must not overwrite the current one.
    if target == wanted { messages = list }
  }

  public func setHovering(_ on: Bool) {
    if hovering != on { hovering = on }
  }

  // MARK: Quick bar

  public func openQuickBar() {
    if let first = snapshot?.pending.first, isManaged(first.session) {
      target = .session(first.session)
    } else {
      target = restoredTarget()
    }
    historyExpanded = store.settings.historyExpanded
    sendError = nil
    clearEscapeHint()
    quickBarOpen = true
    if historyExpanded { Task { await loadMessages() } }
  }

  public func closeQuickBar() {
    quickBarOpen = false
    answeringID = nil
    sendError = nil
    clearEscapeHint()
  }

  /// The first Esc only shows a hint; a second within `EscapeGate.window` closes.
  /// The draft survives either way.
  public func escapePressed(at time: TimeInterval = ProcessInfo.processInfo.systemUptime) {
    guard quickBarOpen else { return }
    switch escapeGate.press(at: time) {
    case .close:
      closeQuickBar()
    case .hint:
      escapeHint = true
      escapeHintTask?.cancel()
      escapeHintTask = Task { [weak self] in
        try? await Task.sleep(for: .seconds(EscapeGate.window))
        guard !Task.isCancelled else { return }
        self?.escapeHint = false
      }
    }
  }

  private func clearEscapeHint() {
    escapeGate.reset()
    escapeHintTask?.cancel()
    escapeHintTask = nil
    if escapeHint { escapeHint = false }
  }

  private func restoredTarget() -> Target {
    guard let key = store.settings.lastTarget, key != Target.jarvis.storageKey else { return .jarvis }
    return isManaged(key) ? .session(key) : .jarvis
  }

  private func isManaged(_ id: String) -> Bool {
    snapshot?.sessions.contains { $0.id == id && $0.managed } ?? false
  }

  // MARK: Managed set

  @Published public private(set) var managingID: String?

  /// Hands `session` to Jarvis or takes it back. Taking back the current
  /// target falls back to talking to Jarvis directly.
  public func setManaged(_ session: String, _ on: Bool) async {
    guard managingID == nil else { return }
    managingID = session
    defer { managingID = nil }
    do {
      try await api.setManaged(session: session, managed: on)
      sendError = nil
    } catch {
      sendError = (on ? "托管失败：" : "移出失败：") + Self.describe(error)
      return
    }
    if !on, target == .session(session) { target = .jarvis }
    await refresh()
  }

  /// Flips who announces `session`'s results. Shares the managed-set guard so
  /// only one host change is in flight.
  public func toggleNarration(_ session: String) async {
    guard managingID == nil,
          let current = snapshot?.sessions.first(where: { $0.id == session && $0.managed })?.narration else { return }
    managingID = session
    defer { managingID = nil }
    do {
      try await api.setNarration(session: session, narration: current.toggled)
      sendError = nil
    } catch {
      sendError = "切换播报失败：" + Self.describe(error)
      return
    }
    await refresh()
  }

  /// ⌘1…⌘9; 1-based, out-of-range numbers are ignored.
  public func selectTarget(number: Int) {
    let options = targets
    guard number >= 1, number <= options.count else { return }
    target = options[number - 1].target
    answeringID = nil
  }

  public func cycleTarget() {
    let options = targets
    let index = options.firstIndex { $0.target == target } ?? -1
    target = options[(index + 1) % options.count].target
    answeringID = nil
  }

  @discardableResult
  public func submit() async -> Bool {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return false }
    let destination = target
    do {
      if let id = answeringID {
        try await api.answer(.text(id: id, text: text))
      } else if case .session(let id) = destination {
        try await api.send(text: text, target: id)
      } else {
        try await api.send(text: text, target: nil)
      }
    } catch {
      sendError = "发送失败：\(Self.describe(error))"
      return false
    }
    toast = "已发给 \(label(for: destination))"
    store.update { $0.lastTarget = destination.storageKey }
    draft = ""
    sendError = nil
    answeringID = nil
    quickBarOpen = false
    await refresh()
    return true
  }

  public func clearToast() {
    toast = nil
  }

  // MARK: Pending

  public func decide(_ item: PendingItem, allow: Bool) async {
    await submitAnswer(.decision(id: item.id, allow: allow))
  }

  public func alwaysAllow(_ item: PendingItem) async {
    guard item.canAlwaysAllow else { return }
    await submitAnswer(.always(id: item.id))
  }

  public func choose(_ item: PendingItem, choice: String) async {
    await submitAnswer(.choice(id: item.id, choice: choice))
  }

  public func beginTextAnswer(_ item: PendingItem) {
    target = .session(item.session)
    answeringID = item.id
    quickBarOpen = true
  }

  private func submitAnswer(_ answer: PendingAnswer) async {
    do {
      try await api.answer(answer)
      sendError = nil
    } catch {
      sendError = "提交失败：\(Self.describe(error))"
    }
    await refresh()
  }

  // MARK: History, DSH, voice

  public func setHistoryExpanded(_ on: Bool) async {
    historyExpanded = on
    store.update { $0.historyExpanded = on }
    guard on else { return }
    try? await api.markRead(session: nil)
    await loadMessages()
  }

  public func openInDSH(session: String) async {
    try? await api.open(session: session)
    try? await api.markRead(session: session)
  }

  public func press(_ button: HoverButton) async {
    guard let action = button.voiceAction else { return }
    try? await api.voice(action)
    await refresh()
  }

  private static func describe(_ error: Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }
}
