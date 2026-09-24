import SwiftUI
import JarvisPanelCore

struct OverlayRootView: View {
  static let space = "overlay"

  @ObservedObject var state: OverlayState
  @ObservedObject var model: PanelModel
  var onHistory: () -> Void
  var onClose: () -> Void

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.clear
      HoverLayerView(state: state, model: model, onHistory: onHistory)
      if model.quickBarOpen, let q = state.quick {
        column(q)
          .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: q.side == .right ? .leading : .trailing)))
      }
      if !model.quickBarOpen, model.caption != nil {
        let rect = state.local(state.captionFrame)
        caption
          .frame(width: rect.width)
          .position(x: rect.midX, y: rect.midY)
      }
      if let toast = state.toast, model.caption == nil, !model.quickBarOpen, let q = state.quick {
        toastView(toast, q)
          .transition(.opacity)
      }
    }
    .frame(width: state.frame.width, height: state.frame.height, alignment: .topLeading)
    .coordinateSpace(name: Self.space)
    .onPreferenceChange(HitRectsKey.self) { rects in
      MainActor.assumeIsolated { state.hitRects = rects }
    }
    .animation(.easeOut(duration: 0.16), value: model.quickBarOpen)
    .animation(.easeOut(duration: 0.2), value: state.toast)
    .animation(state.reduceCaptionMotion ? nil : .easeOut(duration: 0.2), value: model.caption)
  }

  private func column(_ q: QuickBarLayout) -> some View {
    let bar = state.local(q.bar)
    let height = q.stackLimit + q.bar.height
    let cards = q.growsUp ? model.visiblePending.reversed() : model.visiblePending
    return VStack(alignment: .leading, spacing: 6) {
      caption
      if q.growsUp {
        if model.historyExpanded { HistoryView(model: model, growsUp: true) }
        more
        ForEach(cards) { PendingCardView(item: $0, model: model) }
        if state.showTargets { targets }
        QuickBarView(model: model, state: state, growsUp: true, onClose: onClose)
      } else {
        QuickBarView(model: model, state: state, growsUp: false, onClose: onClose)
        if state.showTargets { targets }
        ForEach(cards) { PendingCardView(item: $0, model: model) }
        more
        if model.historyExpanded { HistoryView(model: model, growsUp: false) }
      }
    }
    .frame(width: QuickBarView.width, height: height, alignment: q.growsUp ? .bottomLeading : .topLeading)
    .position(x: bar.midX, y: q.growsUp ? bar.maxY - height / 2 : bar.minY + height / 2)
    .animation(.easeOut(duration: 0.18), value: model.historyExpanded)
    .animation(.easeOut(duration: 0.18), value: model.visiblePending.map(\.id))
  }

  @ViewBuilder
  private var caption: some View {
    if let line = model.caption, let text = model.captionText {
      CaptionView(text: text, source: line.source)
        .transition(state.reduceCaptionMotion ? .identity : .opacity)
    }
  }

  @ViewBuilder
  private var more: some View {
    if model.hiddenPendingCount > 0 {
      Text("还有 \(model.hiddenPendingCount) 件")
        .font(.system(size: 11))
        .foregroundStyle(Theme.amber.opacity(0.8))
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .hud(radius: 9)
    }
  }

  private var targets: some View {
    TargetListView(model: model) { state.showTargets = false }
  }

  private func toastView(_ text: String, _ q: QuickBarLayout) -> some View {
    let bar = state.local(q.bar)
    return HStack(spacing: 6) {
      Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.cyan)
      Text(text).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
    }
    .padding(.horizontal, 12)
    .frame(height: 28)
    .hud(radius: 14)
    .fixedSize()
    .frame(width: bar.width, height: 28, alignment: q.side == .right ? .leading : .trailing)
    .position(x: bar.midX, y: bar.midY)
    .allowsHitTesting(false)
  }
}
