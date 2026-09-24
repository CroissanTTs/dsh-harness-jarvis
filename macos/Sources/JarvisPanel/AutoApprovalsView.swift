import SwiftUI
import JarvisPanelCore

struct AutoApprovalsView: View {
  @ObservedObject var model: PanelModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("最近自动审批").font(.system(size: 12, weight: .semibold))
        Spacer()
        Text("最近 \(model.visibleAutoApprovals.count) 条").font(.system(size: 10)).foregroundStyle(Theme.dim)
      }
      if let caption = model.caption, let text = model.captionText {
        CaptionView(text: text, source: caption.source)
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(model.visibleAutoApprovals) { entry in
            VStack(alignment: .leading, spacing: 3) {
              HStack(spacing: 6) {
                Text(entry.title.isEmpty ? entry.tool : entry.title)
                  .font(.system(size: 11, weight: .medium)).lineLimit(1)
                Spacer(minLength: 2)
                Text(entry.tier.label).font(.system(size: 10))
                  .foregroundStyle(entry.tier == .safe ? Theme.cyan : Theme.amber)
              }
              Text(entry.command.isEmpty ? entry.tool : entry.command)
                .font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(1)
                .help("\(entry.tool) · \(entry.command)")
              if let rule = entry.rule {
                HStack(spacing: 5) {
                  Button("撤销此规则") { Task { await model.revokeAutoApproval(entry) } }
                    .buttonStyle(.plain).foregroundStyle(Theme.cyan)
                    .disabled(model.revokingAutoApproval != nil)
                    .accessibilityLabel("撤销 \(entry.title) 在 \(rule.workspace) 的审批规则")
                  if model.revokingAutoApproval == rule { ProgressView().controlSize(.mini) }
                }
                .font(.system(size: 10))
              } else {
                Text("无可撤销预设 · 仅显示本次记录")
                  .font(.system(size: 10)).foregroundStyle(Theme.faint)
              }
            }
            .padding(.bottom, 3)
          }
        }
      }
      if let error = model.autoApprovalError {
        Text("\(error)，请重试撤销。")
          .font(.system(size: 10)).foregroundStyle(Theme.red).lineLimit(2)
      }
      Text("撤销仅影响后续审批，已执行操作不会撤回。")
        .font(.system(size: 10)).foregroundStyle(Theme.dim)
    }
    .foregroundStyle(Theme.text)
    .padding(12)
    .hud()
  }
}
