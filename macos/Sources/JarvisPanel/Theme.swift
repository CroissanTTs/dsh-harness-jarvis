import AppKit
import SwiftUI
import JarvisPanelCore

enum Theme {
  static let cyan = Color(nsColor: OrbTint.cyan.color)
  static let amber = Color(nsColor: OrbTint.amber.color)
  static let red = Color(nsColor: OrbTint.red.color)
  static let text = Color.white.opacity(0.92)
  static let dim = Color.white.opacity(0.55)
  static let faint = Color.white.opacity(0.35)
  static let surface = Color(red: 10 / 255, green: 16 / 255, blue: 30 / 255).opacity(0.86)
  static let stroke = Color(red: 92 / 255, green: 225 / 255, blue: 255 / 255).opacity(0.22)
  static let radius: CGFloat = 12

  static func tint(_ t: OrbTint) -> Color {
    switch t {
    case .cyan: return cyan
    case .amber: return amber
    case .red: return red
    }
  }

  static func status(_ s: SessionStatus?) -> Color {
    switch s {
    case .running: return cyan
    case .waiting: return amber
    case .failed: return red
    case .done: return Color.white.opacity(0.85)
    case .idle, .none: return Color.white.opacity(0.35)
    }
  }
}

/// Dark translucent HUD surface shared by the bar, cards and readouts.
struct HUDSurface: ViewModifier {
  var radius: CGFloat = Theme.radius

  func body(content: Content) -> some View {
    content
      .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Theme.surface))
      .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Theme.stroke, lineWidth: 1))
  }
}

extension View {
  func hud(radius: CGFloat = Theme.radius) -> some View { modifier(HUDSurface(radius: radius)) }
}

enum Log {
  private static let url = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".dsh/jarvis/panel-debug.log")

  static func write(_ message: String) {
    let line = "\(Date().ISO8601Format()) \(message)\n"
    if let h = FileHandle(forWritingAtPath: url.path) {
      h.seekToEndOfFile()
      h.write(Data(line.utf8))
      h.closeFile()
    } else {
      try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? line.write(to: url, atomically: true, encoding: .utf8)
    }
  }
}
