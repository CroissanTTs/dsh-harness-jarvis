import Foundation

/// Host-owned audit entry. A missing rule means there is no saved preset to revoke.
public struct AutoApproval: Decodable, Sendable, Equatable, Identifiable {
  public enum Tier: String, Decodable, Sendable {
    case safe, grey, medium
    public var label: String {
      switch self {
      case .safe: return "安全"
      case .grey: return "灰区"
      case .medium: return "中风险"
      }
    }
  }
  public let id: String
  public let session: String
  public let title: String
  public let tool: String
  public let command: String
  public let tier: Tier
  /// Epoch milliseconds, matching Date.now() in the host.
  public let at: Double
  public var rule: ApprovalRule.Identity?

  public init(id: String, session: String, title: String, tool: String, command: String,
              tier: Tier, at: Double, rule: ApprovalRule.Identity? = nil) {
    self.id = id
    self.session = session
    self.title = title
    self.tool = tool
    self.command = command
    self.tier = tier
    self.at = at
    self.rule = rule
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    session = try c.decode(String.self, forKey: .session)
    title = try c.decode(String.self, forKey: .title)
    tool = try c.decode(String.self, forKey: .tool)
    command = try c.decode(String.self, forKey: .command)
    tier = try c.decode(Tier.self, forKey: .tier)
    at = try c.decode(Double.self, forKey: .at)
    guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, at.isFinite, at >= 0 else {
      throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Invalid audit identity or timestamp")
    }
    if let candidate = try? c.decode(ApprovalRule.Identity.self, forKey: .rule),
       [candidate.fingerprint, candidate.tool, candidate.workspace].allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
      rule = candidate
    } else { rule = nil }
  }

  private enum CodingKeys: String, CodingKey { case id, session, title, tool, command, tier, at, rule }
}

/// One malformed entry must not hide other valid audit records or disconnect the panel.
struct LenientAutoApproval: Decodable {
  let value: AutoApproval?
  init(from decoder: Decoder) throws { value = try? AutoApproval(from: decoder) }
}
