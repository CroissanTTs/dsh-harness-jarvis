import SwiftUI
import JarvisPanelCore

/// Approval / question card stacked next to the quick bar (spec §6.2).
struct PendingCardView: View {
  let item: PendingItem
  @ObservedObject var model: PanelModel
  @State private var busy = false

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 6) {
        Circle().fill(Theme.amber).frame(width: 6, height: 6)
        Text("\(model.label(for: .session(item.session))) · \(item.kind == .approval ? "请求执行" : "问题")")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(Theme.amber)
          .lineLimit(1)
        Spacer(minLength: 4)
        Button {
          Task { await model.openInDSH(session: item.session) }
        } label: {
          Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.dim)
            .frame(width: 18, height: 18).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("回到 DSH 查看")
      }
      if item.kind == .approval {
        Text(item.detail ?? item.title)
          .font(.system(size: 11, design: .monospaced))
          .foregroundStyle(Theme.text)
          .lineLimit(3)
          .padding(.horizontal, 7)
          .padding(.vertical, 5)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.35)))
      } else {
        Text(item.title).font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(3)
        if let detail = item.detail, !detail.isEmpty {
          Text(detail).font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(2)
        }
      }
      if let note = item.note, !note.isEmpty {
        Text(note).font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(2)
      }
      actions
    }
    .padding(10)
    .frame(width: QuickBarView.width, alignment: .leading)
    .hud()
    .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.amber.opacity(0.35), lineWidth: 1))
    .disabled(busy)
    .opacity(busy ? 0.6 : 1)
    .hitArea()
  }

  @ViewBuilder
  private var actions: some View {
    if item.kind == .approval {
      HStack(spacing: 6) {
        pill("批准", filled: true) { await model.decide(item, allow: true) }
        pill("拒绝", filled: false) { await model.decide(item, allow: false) }
      }
    } else {
      FlowRow(spacing: 6) {
        ForEach(item.choices, id: \.self) { choice in
          pill(choice, filled: false) { await model.choose(item, choice: choice) }
        }
        pill("我来回答", filled: false, dim: true) { model.beginTextAnswer(item) }
      }
    }
  }

  private func pill(_ title: String, filled: Bool, dim: Bool = false, action: @escaping () async -> Void) -> some View {
    Button {
      busy = true
      Task {
        await action()
        busy = false
      }
    } label: {
      Text(title)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(filled ? Color.black.opacity(0.85) : (dim ? Theme.dim : Theme.text))
        .lineLimit(1)
        .padding(.horizontal, 10)
        .frame(height: 22)
        .background(Capsule().fill(filled ? Theme.amber : Color.white.opacity(0.08)))
        .overlay(Capsule().stroke(filled ? .clear : Color.white.opacity(0.14), lineWidth: 1))
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

/// Wraps pills onto new lines when they overflow the card width.
struct FlowRow: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, maxX: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        y += line + spacing
        x = 0
        line = 0
      }
      x += size.width + spacing
      maxX = max(maxX, x - spacing)
      line = max(line, size.height)
    }
    return CGSize(width: min(maxX, width), height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x > bounds.minX && x + size.width > bounds.maxX {
        y += line + spacing
        x = bounds.minX
        line = 0
      }
      s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}
