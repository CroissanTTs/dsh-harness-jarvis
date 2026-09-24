import Foundation

public struct Caption: Equatable, Sendable {
  public var text: String
  public var source: SpeechSource
  public var sessionId: String?

  public init(text: String, source: SpeechSource, sessionId: String? = nil) {
    self.text = text
    self.source = source
    self.sessionId = sessionId
  }
}

/// Keeps the last line only across a speaking → silent transition. Polls while
/// silent must not extend its lifetime; textless speech must not reuse old words.
public struct CaptionState: Equatable, Sendable {
  public static let holdDuration: TimeInterval = 1.5
  private var last: Caption?
  private var speaking = false
  public private(set) var lastEnd: TimeInterval?

  public init() {}

  public mutating func update(_ voice: VoiceState, now: TimeInterval) {
    if voice.speaking {
      let text = voice.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      last = text.isEmpty ? nil : Caption(text: text, source: voice.source ?? .jarvis, sessionId: voice.sessionId)
      lastEnd = nil
    } else if speaking {
      lastEnd = now
    }
    speaking = voice.speaking
  }

  public func caption(now: TimeInterval, enabled: Bool = true) -> Caption? {
    guard enabled else { return nil }
    if speaking { return last }
    guard let lastEnd, now >= lastEnd, now - lastEnd < Self.holdDuration else { return nil }
    return last
  }
}
