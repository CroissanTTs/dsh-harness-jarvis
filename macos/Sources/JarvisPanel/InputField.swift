import AppKit
import SwiftUI

/// Multi-line input backed by NSTextView. Return reaches `doCommandBy` only
/// after the input method has committed its marked text, so pressing Return to
/// pick a Chinese candidate never sends the message.
struct InputField: NSViewRepresentable {
  static let lineHeight: CGFloat = 17
  static let maxLines = 3

  @Binding var text: String
  @Binding var height: CGFloat
  var placeholder: String
  var focusToken: Int
  var onSubmit: () -> Void
  var onTab: () -> Void
  var onEscape: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.hasVerticalScroller = false
    scroll.borderType = .noBorder
    let tv = PlaceholderTextView()
    tv.delegate = context.coordinator
    tv.drawsBackground = false
    tv.isRichText = false
    tv.allowsUndo = true
    tv.font = .systemFont(ofSize: 13)
    tv.textColor = NSColor.white.withAlphaComponent(0.92)
    tv.insertionPointColor = NSColor(srgbRed: 92 / 255, green: 225 / 255, blue: 1, alpha: 1)
    tv.textContainerInset = NSSize(width: 0, height: 2)
    tv.textContainer?.lineFragmentPadding = 0
    tv.textContainer?.widthTracksTextView = true
    tv.isVerticallyResizable = true
    tv.isHorizontallyResizable = false
    tv.autoresizingMask = [.width]
    tv.isAutomaticQuoteSubstitutionEnabled = false
    tv.isAutomaticDashSubstitutionEnabled = false
    tv.placeholder = placeholder
    tv.string = text
    scroll.documentView = tv
    context.coordinator.textView = tv
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    context.coordinator.parent = self
    guard let tv = context.coordinator.textView else { return }
    tv.placeholder = placeholder
    if tv.string != text && !tv.hasMarkedText() {
      tv.string = text
      tv.needsDisplay = true
      context.coordinator.measure()
    }
    if context.coordinator.focusToken != focusToken {
      context.coordinator.focusToken = focusToken
      DispatchQueue.main.async {
        tv.window?.makeFirstResponder(tv)
        tv.setSelectedRange(NSRange(location: (tv.string as NSString).length, length: 0))
      }
    }
  }

  final class Coordinator: NSObject, NSTextViewDelegate {
    var parent: InputField
    weak var textView: PlaceholderTextView?
    var focusToken = -1

    init(_ parent: InputField) { self.parent = parent }

    func textDidChange(_ notification: Notification) {
      guard let tv = textView else { return }
      parent.text = tv.string
      measure()
    }

    func measure() {
      guard let tv = textView, let lm = tv.layoutManager, let tc = tv.textContainer else { return }
      lm.ensureLayout(for: tc)
      let used = lm.usedRect(for: tc).height + tv.textContainerInset.height * 2
      let clamped = min(max(used, InputField.lineHeight + 4),
                        InputField.lineHeight * CGFloat(InputField.maxLines) + 4)
      if abs(clamped - parent.height) > 0.5 {
        DispatchQueue.main.async { self.parent.height = clamped }
      }
    }

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
      switch selector {
      case #selector(NSResponder.insertNewline(_:)):
        if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
          let lines = textView.string.components(separatedBy: "\n").count
          if lines < InputField.maxLines { textView.insertNewlineIgnoringFieldEditor(nil) }
        } else {
          parent.onSubmit()
        }
        return true
      case #selector(NSResponder.insertTab(_:)):
        parent.onTab()
        return true
      case #selector(NSResponder.cancelOperation(_:)):
        // Holding Esc must not count as the second press.
        let event = NSApp.currentEvent
        if !(event?.type == .keyDown && event?.isARepeat == true) { parent.onEscape() }
        return true
      default:
        return false
      }
    }
  }
}

final class PlaceholderTextView: NSTextView {
  var placeholder = "" {
    didSet { if placeholder != oldValue { needsDisplay = true } }
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard string.isEmpty, !hasMarkedText() else { return }
    let attrs: [NSAttributedString.Key: Any] = [
      .font: font ?? .systemFont(ofSize: 13),
      .foregroundColor: NSColor.white.withAlphaComponent(0.35),
    ]
    (placeholder as NSString).draw(at: NSPoint(x: 0, y: textContainerInset.height), withAttributes: attrs)
  }

  override func didChangeText() {
    super.didChangeText()
    needsDisplay = true
  }
}
