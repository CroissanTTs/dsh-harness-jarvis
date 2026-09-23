import SwiftUI

/// 悬浮窗 UI. Default state = the Siri orb (OrbView). On hover it expands into
/// the panel content (status, managed-session chips, text input → /jarvis/input,
/// last-sent). Approval/question rows are reserved for the core-function phase.
struct RootView: View {
  @ObservedObject var model: PanelModel

  var body: some View {
    Group {
      if model.expanded {
        ExpandedContent(model: model)
          .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .topTrailing)))
      } else {
        OrbView(state: model.orbState, edge: model.edgeState)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    // Expand/collapse is driven by the AppDelegate's cursor-timer (frame-based,
    // with a fold delay) — NOT SwiftUI .onHover, which jittered during the
    // resize/transition (rapid expand/collapse, couldn't open the content).
    .animation(.easeInOut(duration: 0.22), value: model.expanded)
  }
}

private struct ExpandedContent: View {
  @ObservedObject var model: PanelModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      header
      Divider()
      // Conversation (last 20 msgs) — scrollable, inline in the悬浮窗.
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 6) {
          ForEach(model.messages) { msg in
            VStack(alignment: .leading, spacing: 3) {
              // Role label
              Text(msg.role == "assistant" ? "贾维斯" : msg.role == "tool" ? "工具结果" : "我")
                .font(.caption2).foregroundStyle(msg.role == "assistant" ? .blue : .secondary)
              // Text content (if any)
              if !msg.text.isEmpty {
                Text(msg.text)
                  .font(.caption)
                  .foregroundStyle(.primary)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .padding(8)
                  .background(
                    msg.role == "assistant" ? Color.blue.opacity(0.12) : Color.gray.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 8)
                  )
              }
              // Tool calls (🔧 name + args)
              if let calls = msg.toolCalls {
                ForEach(calls.indices, id: \.self) { i in
                  let c = calls[i]
                  HStack(spacing: 4) {
                    Text("🔧").font(.caption2)
                    Text(c.name).font(.caption2).bold().foregroundStyle(.orange)
                    if !c.args.isEmpty {
                      Text(c.args).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(2)
                    }
                  }
                  .padding(5)
                  .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 5))
                }
              }
            }
          }
        }
      }
      Divider()
      // Session picker — select a target session for inject_to_session.
      if !model.agents.isEmpty {
        Picker("目标会话", selection: Binding(get: { model.selectedAgent ?? "" }, set: { model.selectedAgent = $0.isEmpty ? nil : $0 })) {
          Text("直接对话（无目标）").tag("")
          ForEach(model.agents) { a in
            Text(a.title.isEmpty ? String(a.id.suffix(8)) : a.title).tag(a.id)
          }
        }
        .font(.caption2)
        .labelsHidden()
      }
      inputRow
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    .shadow(color: .black.opacity(0.35), radius: 14, y: 4)
  }

  private var header: some View {
    HStack(spacing: 8) {
      OrbView(state: model.orbState, edge: .none).frame(width: 26, height: 26)
      Text("贾维斯").font(.headline)
      Spacer()
    }
  }

  private var statusLine: some View {
    Text(model.status)
      .font(.caption)
      .foregroundStyle(.secondary)
      .lineLimit(2)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var sessionChips: some View {
    if model.managed.isEmpty {
      Text("暂无托管会话")
        .font(.caption2)
        .foregroundStyle(.tertiary)
    } else {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(model.managed, id: \.self) { sid in
            Text(String(sid.prefix(12)))
              .font(.caption2)
              .lineLimit(1)
              .padding(.horizontal, 6).padding(.vertical, 2)
              .background(.white.opacity(0.08), in: Capsule())
          }
        }
      }
      .frame(height: 22)
    }
  }

  private var inputRow: some View {
    HStack(spacing: 8) {
      TextField("对贾维斯说…", text: $model.input, axis: .vertical)
        .textFieldStyle(.plain)
        .lineLimit(1...3)
        .onSubmit { Task { await model.send() } }
      Button(action: { Task { await model.send() } }) {
        Image(systemName: "paperplane.fill")
      }
      .buttonStyle(.borderless)
    }
  }

  private var lastSentLine: some View {
    Text("已发：\(model.lastSent)")
      .font(.caption2)
      .foregroundStyle(.green)
      .lineLimit(1)
  }
}
