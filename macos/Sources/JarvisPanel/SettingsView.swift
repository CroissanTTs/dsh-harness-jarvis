import AppKit
import SwiftUI
import JarvisPanelCore

/// Settings edited from the window; changes apply immediately (spec §7).
@MainActor
final class SettingsModel: ObservableObject {
  @Published var settings: PanelSettings {
    didSet {
      guard settings != oldValue else { return }
      let s = settings
      store.update { current in
        current.dshOpacity = s.dshOpacity
        current.otherOpacity = s.otherOpacity
        current.proximityFade = s.proximityFade
        current.keepProminent = s.keepProminent
        current.hideInFullscreen = s.hideInFullscreen
        current.hideInMissionControl = s.hideInMissionControl
        current.hideInAppLauncher = s.hideInAppLauncher
        current.hiddenApps = s.hiddenApps
        current.tier = s.tier
        current.followReduceMotion = s.followReduceMotion
        current.dockToStrip = s.dockToStrip
      }
      onChange()
    }
  }

  private let store: SettingsStore
  private let onChange: () -> Void
  let onResetPosition: () -> Void

  init(store: SettingsStore, onChange: @escaping () -> Void, onResetPosition: @escaping () -> Void) {
    self.store = store
    self.onChange = onChange
    self.onResetPosition = onResetPosition
    settings = store.settings
  }
}

struct SettingsView: View {
  @ObservedObject var model: SettingsModel

  var body: some View {
    Form {
      Section("显示") {
        opacitySlider("DSH 在前台时", value: $model.settings.dshOpacity)
        opacitySlider("其他应用在前台时", value: $model.settings.otherOpacity)
        Toggle("鼠标靠近时渐显", isOn: $model.settings.proximityFade)
        Toggle("需要处理或出错时保持醒目", isOn: $model.settings.keepProminent)
      }
      Section("隐藏") {
        Toggle("全屏应用或视频时隐藏", isOn: $model.settings.hideInFullscreen)
        Toggle("调度中心中隐藏", isOn: $model.settings.hideInMissionControl)
        Toggle("应用程序启动器中隐藏", isOn: $model.settings.hideInAppLauncher)
        hiddenApps
      }
      Section("动效") {
        Picker("粒子档位", selection: $model.settings.tier) {
          ForEach(ParticleTier.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        Toggle("跟随系统\u{201C}减少动态效果\u{201D}", isOn: $model.settings.followReduceMotion)
      }
      Section("位置") {
        Toggle("贴边时收成细带", isOn: $model.settings.dockToStrip)
        Button("重置位置") { model.onResetPosition() }
      }
    }
    .formStyle(.grouped)
    .frame(width: 420)
    .fixedSize(horizontal: false, vertical: true)
  }

  private func opacitySlider(_ title: String, value: Binding<Double>) -> some View {
    LabeledContent(title) {
      HStack {
        Slider(value: value, in: PanelSettings.opacityRange, step: 0.05)
        Text("\(Int((value.wrappedValue * 100).rounded()))%")
          .monospacedDigit()
          .frame(width: 40, alignment: .trailing)
      }
      .frame(width: 200)
    }
  }

  @ViewBuilder
  private var hiddenApps: some View {
    LabeledContent("这些应用在前台时隐藏") {
      Menu("添加…") {
        ForEach(runningApps, id: \.bundle) { app in
          Button(app.name) { model.settings.hiddenApps.append(app.bundle) }
        }
      }
      .fixedSize()
    }
    ForEach(model.settings.hiddenApps, id: \.self) { bundle in
      HStack {
        Text(Self.name(for: bundle))
        Spacer()
        Button {
          model.settings.hiddenApps.removeAll { $0 == bundle }
        } label: {
          Image(systemName: "minus.circle.fill").foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
      }
    }
  }

  private var runningApps: [(name: String, bundle: String)] {
    let taken = Set(model.settings.hiddenApps)
    let apps = NSWorkspace.shared.runningApplications.compactMap { app -> (String, String)? in
      guard app.activationPolicy == .regular, let id = app.bundleIdentifier, !taken.contains(id),
            !id.hasPrefix(VisibilityPolicy.dshPrefix) else { return nil }
      return (app.localizedName ?? id, id)
    }
    return apps.sorted { $0.0.localizedCompare($1.0) == .orderedAscending }.map { (name: $0.0, bundle: $0.1) }
  }

  private static func name(for bundle: String) -> String {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
      return FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
    }
    return bundle
  }
}
