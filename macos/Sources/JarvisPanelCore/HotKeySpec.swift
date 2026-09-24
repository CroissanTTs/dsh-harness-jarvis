import Foundation

/// Physical macOS virtual keys; labels use the ANSI layout regardless of the active input method.
public struct HotKeySpec: Equatable, Sendable {
  public let keyCode: UInt32
  /// Carbon modifier bits. Kept here as values so Core does not depend on AppKit/Carbon.
  public let modifiers: UInt32
  public static let command: UInt32 = 1 << 8
  public static let shift: UInt32 = 1 << 9
  public static let option: UInt32 = 1 << 11
  public static let control: UInt32 = 1 << 12
  public static let supportedModifiers = command | shift | option | control
  public static let `default` = HotKeySpec(keyCode: 38, modifiers: control | option)!

  private static let modifierLabels: [(Character, UInt32)] = [
    ("⌃", control), ("⌥", option), ("⇧", shift), ("⌘", command),
  ]
  private static let keys: [UInt32: String] = [
    0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V",
    11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T", 18: "1", 19: "2",
    20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
    30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 37: "L", 38: "J", 39: "'", 40: "K",
    41: ";", 42: "\\", 43: ",", 44: "/", 45: "N", 46: "M", 47: ".", 50: "`",
    36: "Return", 48: "Tab", 49: "Space", 51: "Delete", 53: "Escape",
    64: "F17", 79: "F18", 80: "F19", 90: "F20", 96: "F5", 97: "F6", 98: "F7", 99: "F3",
    100: "F8", 101: "F9", 103: "F11", 105: "F13", 106: "F16", 107: "F14", 109: "F10",
    111: "F12", 113: "F15", 118: "F4", 120: "F2", 122: "F1",
    115: "Home", 116: "PageUp", 117: "ForwardDelete", 119: "End", 121: "PageDown",
    123: "←", 124: "→", 125: "↓", 126: "↑",
  ]

  public init?(keyCode: UInt32, modifiers: UInt32) {
    guard Self.keys[keyCode] != nil, modifiers != 0,
          modifiers & ~Self.supportedModifiers == 0 else { return nil }
    self.keyCode = keyCode
    self.modifiers = modifiers
  }

  public init?(_ displayString: String) {
    var remaining = displayString[...]
    var modifiers: UInt32 = 0
    while let first = remaining.first, let (_, bit) = Self.modifierLabels.first(where: { $0.0 == first }) {
      guard modifiers & bit == 0 else { return nil }
      modifiers |= bit
      remaining.removeFirst()
    }
    guard let key = Self.keys.first(where: { $0.value.uppercased() == remaining.uppercased() }) else { return nil }
    self.init(keyCode: key.key, modifiers: modifiers)
  }

  public var displayString: String {
    Self.modifierLabels.filter { modifiers & $0.1 != 0 }.map { String($0.0) }.joined() + Self.keys[keyCode]!
  }
}

public enum InputHotKeyAction: Equatable, Sendable {
  case open, focus, close

  public static func resolve(inputOpen: Bool, inputFocused: Bool) -> Self {
    inputOpen ? (inputFocused ? .close : .focus) : .open
  }
}
