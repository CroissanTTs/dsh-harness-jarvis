import AppKit
import Carbon
import JarvisPanelCore

/// Carbon delivers registered combinations without global keyboard monitoring or accessibility access.
@MainActor
final class HotKey {
  private static let signature: OSType = 0x4A565348 // JVSH
  private var handler: EventHandlerRef?
  private static var nextID: UInt32 = 0
  private var activeID: UInt32?
  private let onPress: (HotKeySpec) -> Void
  private var binding: HotKeyBinding!

  init(onPress: @escaping (HotKeySpec) -> Void) {
    self.onPress = onPress
    var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
      guard let event, let context else { return OSStatus(eventNotHandledErr) }
      var id = EventHotKeyID()
      let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
        nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
      guard status == noErr else { return status }
      return MainActor.assumeIsolated {
        let owner = Unmanaged<HotKey>.fromOpaque(context).takeUnretainedValue()
        guard id.signature == HotKey.signature, id.id == owner.activeID, let spec = owner.binding.spec else {
          return OSStatus(eventNotHandledErr)
        }
        owner.onPress(spec)
        return noErr
      }
    }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handler)
    if status != noErr { handler = nil }
    binding = HotKeyBinding { [weak self] spec in self?.register(spec) }
  }

  @discardableResult
  func replace(with spec: HotKeySpec) -> Bool { binding.replace(with: spec) }

  private func register(_ spec: HotKeySpec) -> (() -> Void)? {
    guard handler != nil else { return nil }
    Self.nextID &+= 1
    let id = Self.nextID
    var reference: EventHotKeyRef?
    let status = RegisterEventHotKey(spec.keyCode, spec.modifiers, EventHotKeyID(signature: Self.signature, id: id),
      GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &reference)
    guard status == noErr, let reference else { return nil }
    activeID = id
    return { [weak self] in
      UnregisterEventHotKey(reference)
      if self?.activeID == id { self?.activeID = nil }
    }
  }

  func invalidate() {
    binding.unregister()
    if let handler { RemoveEventHandler(handler) }
    handler = nil
  }

  deinit {
    binding.unregister()
    if let handler { RemoveEventHandler(handler) }
  }
}
