import Foundation

public enum ParticleTier: String, Codable, CaseIterable, Sendable {
  case minimal, lite, standard

  public var count: Int {
    switch self {
    case .minimal: return 300
    case .lite: return 600
    case .standard: return 900
    }
  }

  /// UI shows names only, never particle counts.
  public var label: String {
    switch self {
    case .minimal: return "极简"
    case .lite: return "精简"
    case .standard: return "默认"
    }
  }
}

public enum DockEdge: String, Codable, CaseIterable, Sendable {
  case left, right, top, bottom, topLeft, topRight, bottomLeft, bottomRight

  public var isCorner: Bool {
    switch self {
    case .topLeft, .topRight, .bottomLeft, .bottomRight: return true
    default: return false
    }
  }
}

public struct SavedPosition: Codable, Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var dock: DockEdge?

  public init(x: Double, y: Double, dock: DockEdge?) {
    self.x = x
    self.y = y
    self.dock = dock
  }
}

public struct PanelSettings: Codable, Equatable, Sendable {
  public static let opacityRange: ClosedRange<Double> = 0.15...1.0

  public var dshOpacity = 1.0
  public var otherOpacity = 0.35
  public var proximityFade = true
  public var keepProminent = true
  public var hideInFullscreen = true
  public var hideInMissionControl = true
  public var hideInAppLauncher = true
  public var hiddenApps: [String] = []
  public var tier: ParticleTier = .standard
  public var followReduceMotion = true
  public var dockToStrip = true
  /// Keyed by display id (`NSScreenNumber`) so each monitor remembers its own spot.
  public var positions: [String: SavedPosition] = [:]
  /// "jarvis" or a session id; nil = never sent yet.
  public var lastTarget: String?
  public var historyExpanded = false
  public var showCaptions = true

  public init() {}

  public func normalized() -> PanelSettings {
    var s = self
    s.dshOpacity = min(max(s.dshOpacity, Self.opacityRange.lowerBound), Self.opacityRange.upperBound)
    s.otherOpacity = min(max(s.otherOpacity, Self.opacityRange.lowerBound), Self.opacityRange.upperBound)
    return s
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    // A bad value for one key falls back to its default instead of failing the whole file.
    func value<T: Decodable>(_ key: CodingKeys, _ fallback: T) -> T {
      ((try? c.decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
    let d = PanelSettings()
    dshOpacity = value(.dshOpacity, d.dshOpacity)
    otherOpacity = value(.otherOpacity, d.otherOpacity)
    proximityFade = value(.proximityFade, d.proximityFade)
    keepProminent = value(.keepProminent, d.keepProminent)
    hideInFullscreen = value(.hideInFullscreen, d.hideInFullscreen)
    hideInMissionControl = value(.hideInMissionControl, d.hideInMissionControl)
    hideInAppLauncher = value(.hideInAppLauncher, d.hideInAppLauncher)
    hiddenApps = value(.hiddenApps, d.hiddenApps)
    tier = value(.tier, d.tier)
    followReduceMotion = value(.followReduceMotion, d.followReduceMotion)
    dockToStrip = value(.dockToStrip, d.dockToStrip)
    positions = value(.positions, d.positions)
    lastTarget = value(.lastTarget, d.lastTarget)
    historyExpanded = value(.historyExpanded, d.historyExpanded)
    showCaptions = value(.showCaptions, d.showCaptions)
  }

  private enum CodingKeys: String, CodingKey {
    case dshOpacity, otherOpacity, proximityFade, keepProminent, hideInFullscreen, hideInMissionControl
    case hideInAppLauncher, hiddenApps, tier, followReduceMotion, dockToStrip, positions, lastTarget
    case historyExpanded, showCaptions
  }
}

/// Reads/writes `~/.dsh/jarvis/panel.json`. A missing or corrupt file yields
/// defaults; every write is normalized first.
public final class SettingsStore: @unchecked Sendable {
  public let url: URL
  private let lock = NSLock()
  private var current: PanelSettings

  public static var defaultURL: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh/jarvis/panel.json")
  }

  public init(url: URL = SettingsStore.defaultURL) {
    self.url = url
    if let data = try? Data(contentsOf: url),
       let decoded = try? JSONDecoder().decode(PanelSettings.self, from: data) {
      current = decoded.normalized()
    } else {
      current = PanelSettings()
    }
  }

  public var settings: PanelSettings {
    lock.lock(); defer { lock.unlock() }
    return current
  }

  public func update(_ change: (inout PanelSettings) -> Void) {
    lock.lock()
    var next = current
    change(&next)
    next = next.normalized()
    current = next
    lock.unlock()
    persist(next)
  }

  private func persist(_ s: PanelSettings) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(s) else { return }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? data.write(to: url, options: .atomic)
  }
}
