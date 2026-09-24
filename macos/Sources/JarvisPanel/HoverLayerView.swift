import SwiftUI
import JarvisPanelCore

struct ReadoutRow: Identifiable, Equatable {
  var id: String { label }
  var label: String
  var value: String
  var color: Color
}

/// Detail readout shown in place of the badge while hovering (spec §5.3).
enum Readout {
  static let rowHeight: CGFloat = 20
  static let listWidth: CGFloat = 110

  static func rows(snapshot: Snapshot?, connection: Connection) -> [ReadoutRow] {
    if case .offline = connection { return [ReadoutRow(label: "贾维斯", value: "离线", color: Theme.red)] }
    guard let snapshot else { return [ReadoutRow(label: "贾维斯", value: "连接中", color: Theme.dim)] }
    if let error = snapshot.error { return [ReadoutRow(label: "出错", value: String(error.prefix(8)), color: Theme.red)] }
    let c = snapshot.counts
    let rows = [
      ReadoutRow(label: "运行中", value: "\(c.running)", color: Theme.cyan),
      ReadoutRow(label: "待处理", value: "\(c.pending)", color: Theme.amber),
      ReadoutRow(label: "新结果", value: "\(c.unread)", color: Color.white),
      ReadoutRow(label: "失败", value: "\(c.failed)", color: Theme.red),
    ]
    let counts = [c.running, c.pending, c.unread, c.failed]
    var visible = zip(rows, counts).filter { $0.1 > 0 }.map(\.0)
    let voice = snapshot.voice
    if voice.paused || voice.queued > 0 {
      let value = voice.queued > 0 ? "\(voice.queued)" : ""
      visible.insert(ReadoutRow(label: voice.paused ? "已暂停" : "排队", value: value, color: Theme.cyan), at: 0)
    }
    return visible.isEmpty ? [ReadoutRow(label: "一切就绪", value: "", color: Theme.dim)] : visible
  }

  static func listSize(_ rows: [ReadoutRow]) -> CGSize {
    CGSize(width: listWidth, height: CGFloat(max(rows.count, 1)) * rowHeight)
  }

  static func capsuleSize(_ rows: [ReadoutRow]) -> CGSize {
    let width = rows.reduce(CGFloat(16)) { $0 + CGFloat($1.label.count) * 12 + CGFloat($1.value.count) * 7 + 18 }
    return CGSize(width: width, height: 24)
  }
}

/// The views are full-overlay sized after `.position`, so scaling is anchored
/// at the button's own center rather than the overlay's.
private struct EmergeModifier: ViewModifier {
  var offset: CGSize
  var scale: CGFloat
  var opacity: Double
  var anchor: UnitPoint

  func body(content: Content) -> some View {
    content
      .scaleEffect(scale, anchor: anchor)
      .offset(offset)
      .opacity(opacity)
  }
}

struct HoverLayerView: View {
  @ObservedObject var state: OverlayState
  @ObservedObject var model: PanelModel
  var onHistory: () -> Void

  @State private var hovered: Int?

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.clear
      if let layout = state.hover {
        let kinds = model.hoverButtons
        ForEach(Array(layout.buttons.enumerated()), id: \.offset) { i, center in
          if state.showHover, i < kinds.count {
            let local = state.local(center)
            button(i, kind: kinds[i], center: local, side: layout.side)
              .transition(emerge(at: local, index: i))
          }
        }
        if state.showHover, !model.visibleAutoApprovals.isEmpty {
          let frame = state.local(state.autoApprovalsFrame)
          AutoApprovalsView(model: model)
            .frame(width: frame.width, height: frame.height)
            .hitArea()
            .position(x: frame.midX, y: frame.midY)
            .transition(.opacity)
        }
        if state.showHover {
          readout(layout.readout, rows: Readout.rows(snapshot: model.snapshot, connection: model.connection),
                  side: layout.side)
            .transition(.opacity.animation(.easeOut(duration: 0.18).delay(0.08)))
        }
      }
    }
  }

  /// Grows out of the orb center on insert and shrinks back into it on removal.
  private func emerge(at center: CGPoint, index: Int) -> AnyTransition {
    let orb = state.local(state.orbCenter)
    let size = state.frame.size
    let anchor = UnitPoint(x: center.x / max(size.width, 1), y: center.y / max(size.height, 1))
    let hidden = EmergeModifier(offset: CGSize(width: orb.x - center.x, height: orb.y - center.y),
                                scale: 0.2, opacity: 0, anchor: anchor)
    let shown = EmergeModifier(offset: .zero, scale: 1, opacity: 1, anchor: anchor)
    return .asymmetric(
      insertion: .modifier(active: hidden, identity: shown)
        .animation(.spring(response: 0.32, dampingFraction: 0.72).delay(Double(index) * 0.05)),
      removal: .modifier(active: hidden, identity: shown).animation(.easeIn(duration: 0.16)))
  }

  private static func icon(_ kind: HoverButton) -> String {
    switch kind {
    case .pause: return "pause.fill"
    case .resume: return "play.fill"
    case .skip: return "forward.end.fill"
    case .clear: return "stop.fill"
    case .mute: return "speaker.wave.2.fill"
    case .unmute: return "speaker.slash.fill"
    case .history: return "text.bubble.fill"
    }
  }

  @ViewBuilder
  private func button(_ i: Int, kind: HoverButton, center: CGPoint, side: HSide) -> some View {
    let size = Placement.buttonSize
    Button {
      if kind == .history { onHistory() } else { Task { await model.press(kind) } }
    } label: {
      Image(systemName: Self.icon(kind))
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(hovered == i ? Color.black.opacity(0.85) : Theme.cyan)
        .frame(width: size, height: size)
        .background(Circle().fill(hovered == i ? Theme.cyan : Theme.surface))
        .overlay(Circle().stroke(Theme.cyan.opacity(0.45), lineWidth: 1))
        .shadow(color: Theme.cyan.opacity(hovered == i ? 0.6 : 0.25), radius: 6)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 ? i : (hovered == i ? nil : hovered) }
    .hitArea()
    .position(center)
    .overlay(alignment: .topLeading) {
      if hovered == i {
        Text(kind.help)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(Theme.text)
          .fixedSize()
          .padding(.horizontal, 7)
          .padding(.vertical, 3)
          .hud(radius: 6)
          .position(x: center.x + (side == .right ? 1 : -1) * (size / 2 + 34), y: center.y)
          .allowsHitTesting(false)
      }
    }
  }

  @ViewBuilder
  private func readout(_ placement: ReadoutPlacement, rows: [ReadoutRow], side: HSide) -> some View {
    switch placement {
    case .list(let rect):
      let r = state.local(rect)
      let arcRadius: CGFloat = 80
      let listOnRight = side == .left
      VStack(alignment: listOnRight ? .leading : .trailing, spacing: 0) {
        ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
          let dy = (CGFloat(i) - CGFloat(rows.count - 1) / 2) * Readout.rowHeight
          let inset = arcRadius - (arcRadius * arcRadius - dy * dy).squareRoot()
          rowView(row)
            .frame(height: Readout.rowHeight)
            .offset(x: listOnRight ? -inset : inset)
        }
      }
      .frame(width: r.width, height: r.height, alignment: listOnRight ? .leading : .trailing)
      .position(x: r.midX, y: r.midY)
      .allowsHitTesting(false)
    case .capsule(let rect):
      let r = state.local(rect)
      HStack(spacing: 10) {
        ForEach(rows) { rowView($0) }
      }
      .padding(.horizontal, 8)
      .frame(width: r.width, height: r.height)
      .hud(radius: r.height / 2)
      .position(x: r.midX, y: r.midY)
      .allowsHitTesting(false)
    case .none:
      EmptyView()
    }
  }

  private func rowView(_ row: ReadoutRow) -> some View {
    HStack(spacing: 5) {
      Circle().fill(row.color).frame(width: 5, height: 5)
      Text(row.label).font(.system(size: 11)).foregroundStyle(Theme.dim)
      if !row.value.isEmpty {
        Text(row.value).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(row.color)
      }
    }
    .fixedSize()
    .shadow(color: .black.opacity(0.8), radius: 2)
  }
}
