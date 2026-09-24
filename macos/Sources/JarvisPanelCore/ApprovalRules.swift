import Combine
import Foundation

/// The plugin owns rule identity and expiry. Never derive these from display text.
public struct ApprovalRule: Decodable, Sendable, Equatable, Identifiable {
  public struct Identity: Hashable, Sendable {
    public let fingerprint: String
    public let tool: String
    public let workspace: String
  }

  public let fingerprint: String
  public let tool: String
  public let workspace: String
  /// Epoch milliseconds, matching the host's Date.now().
  public let createdAt: Double
  public let expiresAt: Double?
  public var identity: Identity { Identity(fingerprint: fingerprint, tool: tool, workspace: workspace) }
  public var id: Identity { identity }

  public init(fingerprint: String, tool: String, workspace: String, createdAt: Double, expiresAt: Double? = nil) {
    self.fingerprint = fingerprint
    self.tool = tool
    self.workspace = workspace
    self.createdAt = createdAt
    self.expiresAt = expiresAt
  }
}

@MainActor
public final class ApprovalRulesModel: ObservableObject {
  @Published public private(set) var rules: [ApprovalRule] = []
  @Published public private(set) var isLoading = false
  @Published public private(set) var removing: ApprovalRule.Identity?
  @Published public private(set) var error: String?
  private let api: JarvisAPI

  public init(api: JarvisAPI) { self.api = api }

  public func refresh() async {
    guard !isLoading, removing == nil else { return }
    isLoading = true
    defer { isLoading = false }
    do {
      rules = try await api.approvalRules()
      error = nil
    } catch {
      self.error = "加载审批规则失败：\(error.localizedDescription)"
    }
  }

  public func remove(_ rule: ApprovalRule) async {
    guard !isLoading, removing == nil else { return }
    removing = rule.identity
    defer { removing = nil }
    do {
      try await api.removeApprovalRule(rule.identity)
      rules.removeAll { $0.identity == rule.identity }
      error = nil
    } catch JarvisAPIError.http(404) {
      // Another panel may already have removed it. Reload the authoritative list.
      removing = nil
      await refresh()
    } catch {
      self.error = "删除审批规则失败：\(error.localizedDescription)"
    }
  }
}
