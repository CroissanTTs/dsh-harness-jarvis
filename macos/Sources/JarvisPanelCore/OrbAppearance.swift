import Foundation

public enum OrbMotion: String, CaseIterable, Sendable, Equatable {
  case idle, awaiting, thinking, speaking, attention, error
}

/// `violet` is not a status: it marks voice-mini narrating another session, so
/// that voice is never mistaken for Jarvis's own.
public enum OrbTint: Sendable, Equatable {
  case cyan, amber, red, violet

  /// sRGB components 0…1.
  public var rgb: (r: Double, g: Double, b: Double) {
    switch self {
    case .cyan: return (92 / 255, 225 / 255, 255 / 255)
    case .amber: return (255 / 255, 194 / 255, 77 / 255)
    case .red: return (255 / 255, 95 / 255, 95 / 255)
    case .violet: return (178 / 255, 140 / 255, 255 / 255)
    }
  }
}

/// `count == 0` with `unreadDot` renders as a dot-only badge.
public struct Badge: Sendable, Equatable {
  public var count: Int
  public var tint: OrbTint
  public var unreadDot: Bool

  public init(count: Int, tint: OrbTint, unreadDot: Bool) {
    self.count = count
    self.tint = tint
    self.unreadDot = unreadDot
  }
}

public struct OrbAppearance: Sendable, Equatable {
  public var motion: OrbMotion
  public var tint: OrbTint
  public var badge: Badge?

  public init(motion: OrbMotion, tint: OrbTint, badge: Badge?) {
    self.motion = motion
    self.tint = tint
    self.badge = badge
  }
}

/// Spec §2.4 / §5.1: colour carries status (host error > pending > failed),
/// motion carries activity (speaking > thinking > status > awaiting > idle),
/// and the badge follows the same priority as the colour. With no status to
/// show, another session's narration turns the orb violet instead of cyan.
public enum OrbStateResolver {
  public static func resolve(snapshot: Snapshot?, connected: Bool, standby: Bool) -> OrbAppearance {
    let counts = snapshot?.counts ?? Counts()
    let hostError = !connected || snapshot == nil || snapshot?.error != nil

    let status: OrbTint
    if hostError { status = .red }
    else if counts.pending > 0 { status = .amber }
    else if counts.failed > 0 { status = .red }
    else { status = .cyan }

    let activity = snapshot?.activity ?? .idle
    let narrating = activity == .speaking && snapshot?.voice.source == .session
    let tint: OrbTint = status == .cyan && narrating ? .violet : status

    let motion: OrbMotion
    if activity == .speaking { motion = .speaking }
    else if activity == .thinking { motion = .thinking }
    else if tint == .red { motion = .error }
    else if tint == .amber { motion = .attention }
    else if activity == .awaiting || standby { motion = .awaiting }
    else { motion = .idle }

    let badge: Badge?
    let dot = counts.unread > 0
    if hostError { badge = nil }
    else if counts.pending > 0 { badge = Badge(count: counts.pending, tint: status, unreadDot: dot) }
    else if counts.failed > 0 { badge = Badge(count: counts.failed, tint: status, unreadDot: dot) }
    else if counts.running > 0 { badge = Badge(count: counts.running, tint: status, unreadDot: dot) }
    else if dot { badge = Badge(count: 0, tint: status, unreadDot: true) }
    else { badge = nil }

    return OrbAppearance(motion: motion, tint: tint, badge: badge)
  }
}
