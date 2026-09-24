/// Owns one registration. Call on the UI thread; a failed candidate never releases the current key.
public final class HotKeyBinding {
  public private(set) var spec: HotKeySpec?
  private let register: (HotKeySpec) -> (() -> Void)?
  private var release: (() -> Void)?

  public init(register: @escaping (HotKeySpec) -> (() -> Void)?) {
    self.register = register
  }

  @discardableResult
  public func replace(with candidate: HotKeySpec) -> Bool {
    if spec == candidate { return true }
    guard let nextRelease = register(candidate) else { return false }
    release?()
    spec = candidate
    release = nextRelease
    return true
  }

  public func unregister() {
    release?()
    release = nil
    spec = nil
  }

  deinit { release?() }
}
