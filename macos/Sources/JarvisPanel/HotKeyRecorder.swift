import AppKit
import SwiftUI
import JarvisPanelCore

/// Only the focused control receives keys; there is no global key event monitor.
struct HotKeyRecorder: NSViewRepresentable {
  var value: String
  var onRecord: (HotKeySpec) -> Void
  var onInvalid: () -> Void

  func makeNSView(context: Context) -> HotKeyRecorderButton {
    let button = HotKeyRecorderButton()
    button.bezelStyle = .rounded
    button.setAccessibilityLabel("录制呼出输入框快捷键")
    button.target = button
    button.action = #selector(HotKeyRecorderButton.beginRecording)
    return button
  }

  func updateNSView(_ button: HotKeyRecorderButton, context: Context) {
    button.value = value
    button.onRecord = onRecord
    button.onInvalid = onInvalid
    button.refreshTitle()
  }
}

final class HotKeyRecorderButton: NSButton {
  var value = HotKeySpec.default.displayString
  var onRecord: ((HotKeySpec) -> Void)?
  var onInvalid: (() -> Void)?
  private(set) var recording = false
  override var acceptsFirstResponder: Bool { true }

  @objc func beginRecording() {
    guard window?.makeFirstResponder(self) == true else { return }
    recording = true
    refreshTitle()
  }

  func refreshTitle() { title = recording ? "请按快捷键（Esc 取消）" : value }

  /// The currently registered combination is consumed by Carbon before AppKit keyDown.
  func record(_ spec: HotKeySpec) {
    guard recording else { return }
    recording = false
    refreshTitle()
    onRecord?(spec)
  }

  override func resignFirstResponder() -> Bool {
    recording = false
    refreshTitle()
    return super.resignFirstResponder()
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard recording, window?.firstResponder === self else { return super.performKeyEquivalent(with: event) }
    capture(event)
    return true
  }

  override func keyDown(with event: NSEvent) {
    if recording { capture(event) } else { super.keyDown(with: event) }
  }

  private func capture(_ event: NSEvent) {
    guard !event.isARepeat else { return }
    var modifiers: UInt32 = 0
    if event.modifierFlags.contains(.command) { modifiers |= HotKeySpec.command }
    if event.modifierFlags.contains(.control) { modifiers |= HotKeySpec.control }
    if event.modifierFlags.contains(.option) { modifiers |= HotKeySpec.option }
    if event.modifierFlags.contains(.shift) { modifiers |= HotKeySpec.shift }
    if event.keyCode == 53 && modifiers == 0 {
      recording = false
      refreshTitle()
      return
    }
    guard let spec = HotKeySpec(keyCode: UInt32(event.keyCode), modifiers: modifiers) else {
      onInvalid?()
      return
    }
    record(spec)
  }
}
