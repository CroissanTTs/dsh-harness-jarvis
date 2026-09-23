import SwiftUI
import JarvisPanelCore

/// Recent conversation, borderless, fading at the end away from the bar
/// (spec §6.3).
struct HistoryView: View {
  static let maxHeight: CGFloat = 360
  static let limit = 20

  @ObservedObject var model: PanelModel
  var growsUp: Bool

  var body: some View {
    ViewThatFits(in: .vertical) {
      content
      ScrollView(.vertical, showsIndicators: false) { content }
        .defaultScrollAnchor(growsUp ? .bottom : .top)
    }
    .frame(width: QuickBarView.width)
    .frame(maxHeight: Self.maxHeight)
    .mask(fade)
    .hitArea()
  }

  /// Newest message sits next to the bar.
  private var content: some View {
    let recent = Array(model.messages.suffix(Self.limit))
    return VStack(spacing: 6) {
      if recent.isEmpty {
        Text(model.target == .jarvis ? "还没有对话" : "\(model.label(for: model.target)) 还没有对话")
          .font(.system(size: 11)).foregroundStyle(Theme.faint).padding(.vertical, 8)
      }
      ForEach(growsUp ? recent : recent.reversed()) { bubble($0) }
    }
    .padding(.vertical, 10)
  }

  private var fade: some View {
    LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.12),
                           .init(color: .black, location: 1)],
                   startPoint: growsUp ? .top : .bottom, endPoint: growsUp ? .bottom : .top)
  }

  private func bubble(_ m: ChatMessage) -> some View {
    HStack {
      if m.isMine { Spacer(minLength: 40) }
      VStack(alignment: .leading, spacing: 4) {
        Text(m.text)
          .font(.system(size: 12))
          .foregroundStyle(Theme.text)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
        if let routed = m.routedTo, !routed.isEmpty {
          Text("→ \(model.label(for: .session(routed)))")
            .font(.system(size: 10))
            .foregroundStyle(Theme.cyan.opacity(0.8))
        }
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(m.isMine ? Theme.cyan.opacity(0.18) : Theme.surface))
      if !m.isMine { Spacer(minLength: 40) }
    }
  }
}