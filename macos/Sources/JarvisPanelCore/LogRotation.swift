public struct LogRotation {
  private var writes = 0

  public init() {}

  public mutating func recordWrite() -> Bool {
    writes = (writes + 1) % 100
    return writes == 0
  }

  public static func shouldRotate(size: Int64, limit: Int64 = 1_048_576) -> Bool {
    limit >= 0 && size > limit
  }
}
