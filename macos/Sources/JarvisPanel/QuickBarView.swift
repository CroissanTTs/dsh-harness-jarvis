import SwiftUI
import JarvisPanelCore

/// `[target ▾] input [⌃] [send]` (spec §6.1).
struct QuickBarView: View {
  static let width: CGFloat = 320
  static let baseHeight: CGFloat = 40

  @ObservedObject var model: PanelModel
  @ObservedObject var state: OverlayState
  var growsUp: Bool
  var onEscape: () -> Void

  @State private var inputHeight = InputField.lineHeight + 4
  @State private var sending = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .center, spacing: 8) {
        targetChip
        InputField(text: $model.draft, height: $inputHeight, placeholder: placeholder,
                   focusToken: state.focusToken, onSubmit: send, onTab: { model.cycleTarget() },
                   onEscape: onEscape)
          .frame(height: inputHeight)
        iconButton(historyIcon, help: model.historyExpanded ? "收起对话" : "展开对话") {
          Task { await model.setHistoryExpanded(!model.historyExpanded) }
        }
        sendButton
      }
      if let error = model.sendError {
        Text(error)
          .font(.system(size: 11))
          .foregroundStyle(Theme.red)
          .lineLimit(2)
          .padding(.leading, 2)
      }
      if model.escapeHint {
        Text("再按一次 Esc 收起")
          .font(.system(size: 11))
          .foregroundStyle(Theme.dim)
          .padding(.leading, 2)
          .transition(.opacity)
      }
    }
    .animation(.easeOut(duration: 0.12), value: model.escapeHint)
    .padding(.horizontal, 10)
    .padding(.vertical, 9)
    .frame(width: Self.width, alignment: .leading)
    .hud()
    .shadow(color: .black.opacity(0.35), radius: 10, y: 3)
    .hitArea()
  }

  private var placeholder: String {
    model.answeringItem != nil ? "输入你的回答…" : "发给\(model.label(for: model.target))…"
  }

  private var historyIcon: String {
    (model.historyExpanded != growsUp) ? "chevron.up" : "chevron.down"
  }

  private var targetChip: some View {
    Button {
      state.showTargets.toggle()
    } label: {
      HStack(spacing: 5) {
        if model.answeringItem != nil {
          Text("回答中").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.amber)
        } else {
          Circle().fill(dotColor).frame(width: 6, height: 6)
        }
        Text(model.label(for: model.target))
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(Theme.text)
          .lineLimit(1)
          .frame(maxWidth: 70, alignment: .leading)
          .fixedSize(horizontal: true, vertical: false)
        Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.dim)
      }
      .padding(.horizontal, 8)
      .frame(height: 24)
      .background(Capsule().fill(Color.white.opacity(0.07)))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .help("Tab 切换，⌘1–⌘9 直接选")
  }

  private var dotColor: Color {
    if case .session(let id) = model.target {
      return Theme.status(model.snapshot?.sessions.first { $0.id == id }?.status)
    }
    return Theme.cyan
  }

  private var sendButton: some View {
    let empty = model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return Button(action: send) {
      Image(systemName: sending ? "ellipsis" : "arrow.up")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(empty ? Theme.faint : Color.black.opacity(0.85))
        .frame(width: 24, height: 24)
        .background(Circle().fill(empty ? Color.white.opacity(0.08) : Theme.cyan))
    }
    .buttonStyle(.plain)
    .disabled(empty || sending)
  }

  private func iconButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: icon)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(Theme.dim)
        .frame(width: 22, height: 22)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(help)
  }

  private func send() {
    guard !sending else { return }
    sending = true
    Task {
      await model.submit()
      sending = false
    }
  }
}

/// Target list opened from the chip (spec §6.1): Jarvis plus the sessions
/// handed to it, and below them the other sessions that can be handed over.
struct TargetListView: View {
  static let candidatesMaxHeight: CGFloat = 160

  @ObservedObject var model: PanelModel
  var onPick: () -> Void

  @State private var adding = false
  @State private var hovered: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      ForEach(Array(model.targets.enumerated()), id: \.element.id) { i, option in targetRow(i, option) }
      if !model.candidates.isEmpty {
        Rectangle().fill(Color.white.opacity(0.08)).frame(height: 1).padding(.vertical, 3).padding(.horizontal, 6)
        addToggle
        if adding {
          ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 1) {
              ForEach(model.candidates) { candidateRow($0) }
            }
          }
          .frame(maxHeight: Self.candidatesMaxHeight)
          .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(4)
    .frame(width: 220)
    .hud(radius: 10)
    .hitArea()
    .animation(.easeOut(duration: 0.15), value: adding)
  }

  private func targetRow(_ i: Int, _ option: TargetOption) -> some View {
    HStack(spacing: 0) {
      Button {
        model.selectTarget(number: i + 1)
        onPick()
      } label: {
        HStack(spacing: 8) {
          Circle().fill(option.status == nil ? Theme.cyan : Theme.status(option.status)).frame(width: 6, height: 6)
          Text(option.label).font(.system(size: 12)).foregroundStyle(Theme.text).lineLimit(1)
          if let task = option.task {
            Text(task.status.label)
              .font(.system(size: 9, weight: .medium))
              .foregroundStyle(task.status == .unsatisfied ? Theme.amber : Theme.dim)
              .padding(.horizontal, 4)
              .padding(.vertical, 2)
              .background(Capsule().fill((task.status == .unsatisfied ? Theme.amber : Color.white).opacity(0.10)))
              .fixedSize()
              .help(task.summary ?? "")
          }
          if option.target == .jarvis {
            Text("直接对话").font(.system(size: 10)).foregroundStyle(Theme.faint)
          }
          Spacer(minLength: 8)
          if i < 9, hovered != option.id || option.target == .jarvis {
            Text("⌘\(i + 1)").font(.system(size: 10, design: .rounded)).foregroundStyle(Theme.faint)
          }
        }
        .padding(.leading, 10)
        .padding(.trailing, option.target == .jarvis ? 10 : 4)
        .frame(height: 26)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if let id = option.target.sessionID, hovered == option.id {
        Button {
          Task { await model.setManaged(id, false) }
        } label: {
          Image(systemName: "minus.circle")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.dim)
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("不再交给贾维斯")
        .disabled(model.managingID != nil)
      }
    }
    .background(RoundedRectangle(cornerRadius: 6).fill(option.target == model.target ? Theme.cyan.opacity(0.14) : .clear))
    .onHover { on in
      if on { hovered = option.id } else if hovered == option.id { hovered = nil }
    }
  }

  private var addToggle: some View {
    Button {
      adding.toggle()
    } label: {
      HStack(spacing: 8) {
        Image(systemName: "plus").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.cyan)
        Text("交给贾维斯…").font(.system(size: 12)).foregroundStyle(Theme.dim)
        Spacer(minLength: 8)
        Text("\(model.candidates.count)").font(.system(size: 10, design: .rounded)).foregroundStyle(Theme.faint)
        Image(systemName: adding ? "chevron.up" : "chevron.down")
          .font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.faint)
      }
      .padding(.horizontal, 10)
      .frame(height: 26)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func candidateRow(_ option: TargetOption) -> some View {
    Button {
      guard let id = option.target.sessionID else { return }
      Task { await model.setManaged(id, true) }
    } label: {
      HStack(spacing: 8) {
        Circle().fill(Theme.status(option.status)).frame(width: 6, height: 6)
        Text(option.label).font(.system(size: 12)).foregroundStyle(Theme.dim).lineLimit(1)
        Spacer(minLength: 8)
        Image(systemName: model.managingID == option.target.sessionID ? "ellipsis" : "plus.circle")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(Theme.cyan.opacity(hovered == option.id ? 1 : 0.6))
      }
      .padding(.horizontal, 10)
      .frame(height: 26)
      .background(RoundedRectangle(cornerRadius: 6).fill(hovered == option.id ? Color.white.opacity(0.05) : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(model.managingID != nil)
    .help("交给贾维斯管理")
    .onHover { on in
      if on { hovered = option.id } else if hovered == option.id { hovered = nil }
    }
  }
}
