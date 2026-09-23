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
    let visible = zip(rows, counts).filter { $0.1 > 0 }.map(\.0)
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

struct HoverLayerView: View {
  @ObservedObject var state: OverlayState
  @ObservedObject var model: PanelModel
  var onVoice: () -> Void
  var onHistory: () -> Void

  @State private var hovered: Int?

  var body: some View {
    ZStack(alignment: .topLeading) {
      Color.clear
      if let layout = state.hover {
        ForEach(Array(layout.buttons.enumerated()), id: \.offset) { i, center in
          if state.showHover {
            button(i, center: state.local(center), side: layout.side)
              .transition(.scale(scale: 0.6).combined(with: .opacity)
                .animation(.spring(response: 0.28, dampingFraction: 0.7).delay(Double(i) * 0.05)))
          }
        }
        if state.showHover {
          readout(layout.readout, rows: Readout.rows(snapshot: model.snapshot, connection: model.connection),
                  side: layout.side)
            .transition(.opacity.animation(.easeOut(duration: 0.18).delay(0.08)))
        }
      }
    }
  }

  private func spec(_ i: Int) -> (icon: String, help: String, action: () -> Void) {
    if i == 0 {
      let kind = model.voiceButtonKind
      let icon: String
      switch kind {
      case .pause: icon = "pause.fill"
      case .mute: icon = "speaker.wave.2.fill"
      case .unmute: icon = "speaker.slash.fill"
      }
      return (icon, kind.help, onVoice)
    }
    return ("text.bubble.fill", "对话记录", onHistory)
  }

  @ViewBuilder
  private func button(_ i: Int, center: CGPoint, side: HSide) -> some View {
    let s = spec(i)
    let size = Placement.buttonSize
    Button(action: s.action) {
      Image(systemName: s.icon)
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
        Text(s.help)
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
