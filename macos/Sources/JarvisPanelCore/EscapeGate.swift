import Foundation

/// Collapsing the quick bar takes two Esc presses within `window`, so a stray
/// press while typing only shows a hint.
public struct EscapeGate: Sendable {
  public static let window: TimeInterval = 0.6

  public enum Action: Equatable, Sendable { case hint, close }

  private var armedAt: TimeInterval?

  public init() {}

  /// `time` is monotonic seconds (e.g. system uptime).
  public mutating func press(at time: TimeInterval) -> Action {
    if let armed = armedAt, time >= armed, time - armed <= Self.window {
      armedAt = nil
      return .close
    }
    armedAt = time
    return .hint
  }

  public mutating func reset() { armedAt = nil }
}
