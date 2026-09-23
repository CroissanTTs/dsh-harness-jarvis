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
}

public struct TargetOption: Identifiable, Equatable, Sendable {
  public var id: String { target.storageKey }
  public var target: Target
  public var label: String
  public var status: SessionStatus?
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

  @Published public private(set) var snapshot: Snapshot?
  @Published public private(set) var connection: Connection = .connecting
  @Published public private(set) var messages: [ChatMessage] = []
  @Published public private(set) var sendError: String?
  @Published public private(set) var toast: String?
  @Published public private(set) var answeringID: String?
  @Published public var draft = ""
  @Published public var target: Target = .jarvis
  @Published public private(set) var quickBarOpen = false
  @Published public private(set) var historyExpanded = false

  private let api: JarvisAPI
  private let store: SettingsStore

  public init(api: JarvisAPI, store: SettingsStore) {
    self.api = api
    self.store = store
    historyExpanded = store.settings.historyExpanded
  }

  // MARK: Derived

  public var appearance: OrbAppearance {
    OrbStateResolver.resolve(snapshot: snapshot, connected: connection == .online, inputOpen: quickBarOpen)
  }

  public var targets: [TargetOption] {
    [TargetOption(target: .jarvis, label: "贾维斯", status: nil)]
      + (snapshot?.sessions ?? []).map { TargetOption(target: .session($0.id), label: $0.shortName, status: $0.status) }
  }

  public var visiblePending: [PendingItem] {
    Array((snapshot?.pending ?? []).prefix(Self.maxVisiblePending))
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
    case .jarvis: return "贾维斯"
    case .session(let id):
      return snapshot?.sessions.first { $0.id == id }?.shortName ?? String(id.suffix(8))
    }
  }

  // MARK: Polling

  public func refresh() async {
    do {
      snapshot = try await api.snapshot()
      connection = .online
    } catch {
      connection = .offline(Self.describe(error))
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
    if let list = try? await api.messages() { messages = list }
  }

  // MARK: Quick bar

  public func openQuickBar() {
    if let first = snapshot?.pending.first {
      target = .session(first.session)
    } else {
      target = restoredTarget()
    }
    historyExpanded = store.settings.historyExpanded
    sendError = nil
    quickBarOpen = true
    if historyExpanded { Task { await loadMessages() } }
  }

  public func closeQuickBar() {
    quickBarOpen = false
    answeringID = nil
    sendError = nil
  }

  private func restoredTarget() -> Target {
    guard let key = store.settings.lastTarget, key != Target.jarvis.storageKey else { return .jarvis }
    return (snapshot?.sessions.contains { $0.id == key } ?? false) ? .session(key) : .jarvis
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
