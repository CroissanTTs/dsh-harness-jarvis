import Foundation

/// Render rate for the orb. Transitions (docking, undocking, state changes)
/// always run at full rate — at 20 fps a docking particle jumps ~30pt per
/// frame — and only the settled strip drops to its low idle rate.
public enum FramePacing {
  /// Long enough for the slowest particle to depart (≤0.55s) and settle.
  public static let transitionSeconds: Double = 1.2

  public static func fps(docked: Bool, motion: OrbMotion, transitioning: Bool) -> Int {
    if transitioning { return 60 }
    if docked { return 20 }
    return motion == .idle ? 30 : 60
  }
}
