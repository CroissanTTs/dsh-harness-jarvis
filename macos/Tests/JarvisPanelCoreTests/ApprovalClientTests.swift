import XCTest
@testable import JarvisPanelCore

private final class ApprovalURLProtocol: URLProtocol {
  static var response: (status: Int, body: String) = (200, "{}")
  static var requests: [URLRequest] = []
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.requests.append(request)
    let response = HTTPURLResponse(url: request.url!, statusCode: Self.response.status, httpVersion: nil, headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(Self.response.body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

final class ApprovalClientTests: XCTestCase {
  private var client: JarvisClient!
  private var runtime: URL!
  private var session: URLSession!
  override func setUpWithError() throws {
    runtime = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data(#"{"origin":"http://localhost:9191","token":"test-token","rendererHeader":{"name":"X-Renderer","value":"renderer-cap"}}"#.utf8).write(to: runtime)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ApprovalURLProtocol.self]
    session = URLSession(configuration: config)
    client = JarvisClient(runtimeURL: runtime, session: session)
    ApprovalURLProtocol.requests = []
    ApprovalURLProtocol.response = (204, "")
  }
  override func tearDownWithError() throws {
    session.invalidateAndCancel()
    try FileManager.default.removeItem(at: runtime)
  }
  private func body(_ request: URLRequest) throws -> [String: String] {
    if let data = request.httpBody { return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String]) }
    let stream = try XCTUnwrap(request.httpBodyStream)
    stream.open()
    defer { stream.close() }
    var data = Data()
    var bytes = [UInt8](repeating: 0, count: 1024)
    while stream.hasBytesAvailable {
      let count = stream.read(&bytes, maxLength: bytes.count)
      guard count > 0 else { break }
      data.append(bytes, count: count)
    }
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
  }

  // MARK: - 等价类
  func testSnapshotIncludesAutomaticApprovals() async throws {
    ApprovalURLProtocol.response = (200, #"{"autoApprovals":[{"id":"a","session":"s","title":"run","tool":"shell","command":"git status","tier":"safe","at":1234}]}"#)
    let snapshot = try await client.snapshot()
    XCTAssertEqual(snapshot.autoApprovals.first?.command, "git status")
    XCTAssertNil(snapshot.autoApprovals.first?.rule)
    XCTAssertEqual(ApprovalURLProtocol.requests.first?.url?.path, "/jarvis/state")
  }

  func testAlwaysAnswerUsesDecisionWireValueAndAuthentication() async throws {
    try await client.answer(.always(id: "pending-1"))
    let request = try XCTUnwrap(ApprovalURLProtocol.requests.first)
    XCTAssertEqual(request.url?.path, "/jarvis/pending/answer")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(try body(request), ["id": "pending-1", "decision": "always"])
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
    XCTAssertEqual(request.value(forHTTPHeaderField: "X-Renderer"), "renderer-cap")
  }
  func testListDecodesEpochMillisecondsAndOptionalExpiry() async throws {
    ApprovalURLProtocol.response = (200, #"{"rules":[{"fingerprint":"fp","tool":"shell","workspace":"/repo","createdAt":1234},{"fingerprint":"fp2","tool":"read","workspace":"/repo","createdAt":5678,"expiresAt":9999}]}"#)
    let rules = try await client.approvalRules()
    XCTAssertEqual(rules.count, 2)
    XCTAssertEqual(rules[0].createdAt, 1234)
    XCTAssertNil(rules[0].expiresAt)
    XCTAssertEqual(rules[1].expiresAt, 9999)
    XCTAssertEqual(ApprovalURLProtocol.requests.first?.httpMethod, "GET")
    XCTAssertEqual(ApprovalURLProtocol.requests.first?.url?.path, "/jarvis/approval-rules")
  }
  func testRemoveSendsExactTupleWithoutAdditionalID() async throws {
    let rule = ApprovalRule(fingerprint: "a|b", tool: "工具", workspace: "/repo with spaces/", createdAt: 1)
    try await client.removeApprovalRule(rule.identity)
    let request = try XCTUnwrap(ApprovalURLProtocol.requests.first)
    XCTAssertEqual(request.url?.path, "/jarvis/approval-rules/remove")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(try body(request), ["fingerprint": "a|b", "tool": "工具", "workspace": "/repo with spaces/"])
  }

  // MARK: - 边界值
  func testEmptyListIsValid() async throws {
    ApprovalURLProtocol.response = (200, #"{"rules":[]}"#)
    let rules = try await client.approvalRules()
    XCTAssertTrue(rules.isEmpty)
  }

  // MARK: - 异常路径
  func testMalformedListReportsDecodingError() async {
    ApprovalURLProtocol.response = (200, #"{"rules":[{"fingerprint":"fp"}]}"#)
    do { _ = try await client.approvalRules(); XCTFail("expected decoding error") }
    catch { XCTAssertEqual(error as? JarvisAPIError, .decoding) }
  }
  func testDeletePreserves404And400() async {
    for status in [404, 400] {
      ApprovalURLProtocol.response = (status, "")
      let rule = ApprovalRule(fingerprint: "fp", tool: "shell", workspace: "/repo", createdAt: 0)
      do { try await client.removeApprovalRule(rule.identity); XCTFail("expected HTTP error") }
      catch { XCTAssertEqual(error as? JarvisAPIError, .http(status)) }
    }
  }
}
