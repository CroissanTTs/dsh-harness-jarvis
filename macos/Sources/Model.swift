import Foundation
import Combine

/// View model: polls /jarvis/state every couple seconds, owns the input field
/// text + the collapsed/expanded state, and derives the orb state (idle /
/// speaking / error). All UI mutation happens on the main actor.
@MainActor
final class PanelModel: ObservableObject {
  @Published var agentId = ""
  @Published var managed: [String] = []
  @Published var speaking = false
  @Published var hostPid: pid_t = 0 // DSH Desktop pid (0 = unknown yet)
  @Published var status = "connecting…"
  @Published var input = ""
  @Published var lastSent = ""
  @Published var expanded = false
  @Published var edgeState: EdgeState = .none
  @Published var messages: [JarvisMessage] = []
  @Published var agents: [JarvisAgent] = []
  @Published var selectedAgent: String? = nil

  private let client = JarvisClient()
  private var timer: Timer?
  private let pollInterval: TimeInterval = 2.0

  var orbState: OrbState {
    if speaking { return .speaking }
    if status.hasPrefix("offline") || status.hasPrefix("send failed") { return .error }
    return .idle
  }

  func start() {
    Task { await refresh() }
    timer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) { [weak self] _ in
      Task { @MainActor in await self?.refresh() }
    }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  func refresh() async {
    do {
      let snap = try await client.state()
      agentId = snap.agentId
      managed = snap.managed
      speaking = snap.speaking ?? false
      hostPid = client.hostPid
      status = speaking ? "speaking…" : "ready · \(managed.count) managed"
      // Also fetch the conversation (last 20 msgs) for inline display.
      if let msgs = try? await client.messages() {
        messages = msgs.messages
      }
      // Fetch available agents (for the session picker).
      if let ags = try? await client.agents() {
        agents = ags
      }
    } catch JarvisClientError.noRuntime {
      status = "runtime.json not found — host plugin not running?"
    } catch JarvisClientError.http(let code) {
      status = "offline · HTTP \(code)"
    } catch {
      status = "offline · \(error.localizedDescription)"
    }
  }

  func send() async {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    do {
      try await client.input(text: text, session: selectedAgent)
      lastSent = text
      input = ""
      status = "sent ✓"
    } catch {
      status = "send failed · \(error.localizedDescription)"
    }
  }
}
