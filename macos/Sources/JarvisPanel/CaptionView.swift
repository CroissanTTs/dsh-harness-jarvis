import SwiftUI
import JarvisPanelCore

/// Passive subtitles never join the overlay's interactive hit regions.
struct CaptionView: View {
  var text: String
  var source: SpeechSource

  private var tint: Color { source == .jarvis ? Theme.cyan : Theme.violet }

  var body: some View {
    Text(text)
      .font(.system(size: 12, weight: .medium))
      .foregroundStyle(tint)
      .lineLimit(2)
      .truncationMode(.tail)
      .multilineTextAlignment(.leading)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
      .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
      .overlay(RoundedRectangle(cornerRadius: 12).stroke(tint.opacity(0.28), lineWidth: 1))
      .allowsHitTesting(false)
      .accessibilityLabel("播报字幕：\(text)")
  }
}
