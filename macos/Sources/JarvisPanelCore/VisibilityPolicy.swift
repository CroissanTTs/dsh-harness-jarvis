import Foundation

public struct VisibilityInput: Sendable {
  public var frontBundleID: String?
  public var fullscreen: Bool
  public var appLauncher: Bool
  /// Cursor distance from the orb center in points; nil = unknown.
  public var cursorDistance: Double?
  public var hovering: Bool
  /// Quick bar open or a drag in progress.
  public var interacting: Bool
  /// Orb tint is amber or red (needs attention / error).
  public var prominent: Bool
  /// Collapsed into the edge strip, which is too thin to read when faded.
  public var strip = false
  /// Explicit user input remains visible even when the ambient orb would hide.
  public var inputOpen = false
  public var settings: PanelSettings

  public init(frontBundleID: String?, fullscreen: Bool, appLauncher: Bool, cursorDistance: Double?,
              hovering: Bool, interacting: Bool, prominent: Bool, settings: PanelSettings) {
    self.frontBundleID = frontBundleID
    self.fullscreen = fullscreen
    self.appLauncher = appLauncher
    self.cursorDistance = cursorDistance
    self.hovering = hovering
    self.interacting = interacting
    self.prominent = prominent
    self.settings = settings
  }
}

public struct VisibilityOutput: Equatable, Sendable {
  public var hidden: Bool
  public var opacity: Double

  public init(hidden: Bool, opacity: Double) {
    self.hidden = hidden
    self.opacity = opacity
  }
}

/// Spec §3. Mission Control is handled by the window's collection behavior,
/// not here.
public enum VisibilityPolicy {
  public static let dshPrefix = "ai.deepseek.dsh.desktop"
  public static let proximity = 80.0
  public static let prominentFloor = 0.85
  public static let stripFloor = 0.8

  public static func evaluate(_ i: VisibilityInput) -> VisibilityOutput {
    if i.inputOpen { return VisibilityOutput(hidden: false, opacity: 1) }
    let s = i.settings
    let front = i.frontBundleID ?? ""
    let hidden = (s.hideInFullscreen && i.fullscreen)
      || (s.hideInAppLauncher && i.appLauncher)
      || (!front.isEmpty && s.hiddenApps.contains(front))
    if hidden { return VisibilityOutput(hidden: true, opacity: 0) }

    var base = front.hasPrefix(dshPrefix) ? s.dshOpacity : s.otherOpacity
    if s.keepProminent && i.prominent { base = max(base, prominentFloor) }
    if i.strip { base = max(base, stripFloor) }
    if i.hovering || i.interacting { return VisibilityOutput(hidden: false, opacity: 1) }
    if s.proximityFade, let d = i.cursorDistance {
      let radius = Double(Placement.orbRadius)
      let f = min(1, max(0, 1 - (d - radius) / proximity))
      base += (1 - base) * f
    }
    return VisibilityOutput(hidden: false, opacity: base)
  }
}
