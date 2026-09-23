import SwiftUI
import JarvisPanelCore

/// Recent conversation, borderless, fading at the end away from the bar
/// (spec §6.3).
struct HistoryView: View {
  static let maxHeight: CGFloat = 360
  static let limit = 20

  @ObservedObject var model: PanelModel
  var growsUp: Bool
  @State private var contentHeight: CGFloat = 0

  var body: some View {
    let recent = Array(model.messages.suffix(Self.limit))
    let ordered = growsUp ? recent : recent.reversed()
    ScrollViewReader { proxy in
      ScrollView(.vertical, showsIndicators: false) {
        VStack(spacing: 6) {
          if recent.isEmpty {
            Text("还没有对话").font(.system(size: 11)).foregroundStyle(Theme.faint).padding(.vertical, 8)
          }
          ForEach(ordered) { bubble($0).id($0.id) }
        }
        .padding(.vertical, 10)
        .background(GeometryReader { g in Color.clear.preference(key: HeightKey.self, value: g.size.height) })
      }
      .onPreferenceChange(HeightKey.self) { contentHeight = $0 }
      .onAppear { scrollToNewest(proxy, recent) }
      .onChange(of: recent.last?.id) { scrollToNewest(proxy, recent) }
    }
    .frame(width: QuickBarView.width)
    .frame(maxHeight: min(max(contentHeight, 1), Self.maxHeight))
    .mask(fade)
    .hitArea()
  }

  private var fade: some View {
    LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.12),
                           .init(color: .black, location: 1)],
                   startPoint: growsUp ? .top : .bottom, endPoint: growsUp ? .bottom : .top)
  }

  private func scrollToNewest(_ proxy: ScrollViewProxy, _ recent: [ChatMessage]) {
    guard let id = recent.last?.id else { return }
    DispatchQueue.main.async { proxy.scrollTo(id, anchor: growsUp ? .bottom : .top) }
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

private struct HeightKey: PreferenceKey {
  static let defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
