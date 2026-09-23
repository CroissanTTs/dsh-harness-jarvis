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

/// Tint crossfade: ease-in-out so a colour change drifts in rather than snapping.
public enum ColorFade {
  /// Shorter than `FramePacing.transitionSeconds`, so the fade always renders at full rate.
  public static let seconds: Double = 0.9

  /// Blend factor 0…1 after `elapsed` seconds (smoothstep).
  public static func progress(elapsed: Double) -> Double {
    guard elapsed.isFinite else { return elapsed > 0 ? 1 : 0 }
    let x = min(1, max(0, elapsed / seconds))
    return x * x * (3 - 2 * x)
  }
}
