import XCTest
@testable import JarvisPanelCore

private final class NarrationURLProtocol: URLProtocol {
  static var status = 200
  static var bodies: [Data] = []
  static var paths: [String] = []
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.paths.append(request.url?.path ?? "")
    Self.bodies.append(request.httpBody ?? Self.read(request.httpBodyStream))
    let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data("{}".utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
  private static func read(_ stream: InputStream?) -> Data {
    guard let stream else { return Data() }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var bytes = [UInt8](repeating: 0, count: 1024)
    while stream.hasBytesAvailable {
      let count = stream.read(&bytes, maxLength: bytes.count)
      guard count > 0 else { break }
      data.append(bytes, count: count)
    }
    return data
  }
}

/// Per-session narration: who announces a managed session's results.
@MainActor
final class NarrationTests: XCTestCase {
  private var api: FakeAPI!
  private var dir: URL!
  private var model: PanelModel!

  private let hammer = SessionInfo(id: "s-hammer", title: "hammer", status: .running, unread: false, managed: true, narration: .session)
  private let docs = SessionInfo(id: "s-docs", title: "docs", status: .done, unread: false, managed: true, narration: .relay)
  private let quant = SessionInfo(id: "s-quant", title: "量化", status: .idle, unread: false, managed: false)

  override func setUp() async throws {
    api = FakeAPI()
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    model = PanelModel(api: api, store: SettingsStore(url: dir.appendingPathComponent("panel.json")))
  }

  override func tearDown() async throws {
    try? FileManager.default.removeItem(at: dir)
  }

  private func load(_ sessions: [SessionInfo]) async {
    await api.setSnapshot(Snapshot(agentId: "jarvis", sessions: sessions))
    await model.refresh()
  }

  private func decode(_ json: String) throws -> SessionInfo {
    try JSONDecoder().decode(SessionInfo.self, from: Data(json.utf8))
  }

  private func clientCall(_ narration: Narration?, status: Int = 200) async throws -> [String: Any] {
    let runtime = dir.appendingPathComponent("runtime.json")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try Data(#"{"origin":"http://localhost:9191","token":"t"}"#.utf8).write(to: runtime)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [NarrationURLProtocol.self]
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    NarrationURLProtocol.status = status
    NarrationURLProtocol.bodies = []
    NarrationURLProtocol.paths = []
    try await JarvisClient(runtimeURL: runtime, session: session).setNarration(session: "s-docs", narration: narration)
    XCTAssertEqual(NarrationURLProtocol.paths, ["/jarvis/narration"])
    return try XCTUnwrap(JSONSerialization.jsonObject(with: NarrationURLProtocol.bodies[0]) as? [String: Any])
  }

  // MARK: - 等价类

  func testHostValuesDecodeToBothModes() throws {
    XCTAssertEqual(try decode(#"{"id":"a","narration":"self"}"#).narration, .session)
    XCTAssertEqual(try decode(#"{"id":"a","narration":"relay"}"#).narration, .relay)
    XCTAssertEqual(Narration.session.toggled, .relay)
    XCTAssertEqual(Narration.relay.toggled, .session)
  }

  func testTargetsCarryTheirNarration() async {
    await load([hammer, docs, quant])
    XCTAssertEqual(model.targets.map(\.narration), [nil, .session, .relay])
    XCTAssertEqual(model.candidates.map(\.narration), [nil])
  }

  func testToggleSendsTheOtherModeAndRefreshes() async {
    await load([hammer, docs])
    let before = await api.snapshotCalls
    await model.toggleNarration("s-hammer")
    await model.toggleNarration("s-docs")
    let calls = await api.narrationCalls
    XCTAssertEqual(calls.map(\.session), ["s-hammer", "s-docs"])
    XCTAssertEqual(calls.map(\.narration), [.relay, .session])
    let after = await api.snapshotCalls
    XCTAssertEqual(after, before + 2)
    XCTAssertNil(model.managingID)
  }

  func testClientPostsHostValue() async throws {
    let body = try await clientCall(.session)
    XCTAssertEqual(body["session"] as? String, "s-docs")
    XCTAssertEqual(body["narration"] as? String, "self")
  }

  func testDemoTogglesAndShowsRelayedSession() async throws {
    let demo = DemoAPI()
    await demo.setScene(0)
    var docs = try await demo.snapshot().sessions.first { $0.id == "demo-docs" }
    XCTAssertEqual(docs?.narration, .relay)
    try await demo.setNarration(session: "demo-docs", narration: .session)
    docs = try await demo.snapshot().sessions.first { $0.id == "demo-docs" }
    XCTAssertEqual(docs?.narration, .session)
  }

  // MARK: - 边界值

  func testOldHostWithoutNarrationDecodesNilAndToggleIsNoop() async throws {
    XCTAssertNil(try decode(#"{"id":"a","managed":true}"#).narration)
    await load([SessionInfo(id: "old", title: "old", status: .idle, unread: false, managed: true)])
    XCTAssertEqual(model.targets.last?.narration, nil)
    await model.toggleNarration("old")
    let calls = await api.narrationCalls
    XCTAssertTrue(calls.isEmpty)
  }

  func testClientSendsNullToRestoreDefault() async throws {
    let body = try await clientCall(nil)
    XCTAssertTrue(body["narration"] is NSNull)
  }

  func testSecondToggleWhileBusyIsIgnored() async {
    await load([hammer, docs])
    await api.setManagedDelay(0.2)
    async let first: Void = model.toggleNarration("s-hammer")
    try? await Task.sleep(for: .seconds(0.05))
    await model.toggleNarration("s-docs")
    await first
    let calls = await api.narrationCalls
    XCTAssertEqual(calls.map(\.session), ["s-hammer"])
  }

  func testDemoResetAndReleaseRestoreDefaults() async throws {
    let demo = DemoAPI()
    await demo.setScene(0)
    try await demo.setNarration(session: "demo-hammer", narration: .relay)
    try await demo.setNarration(session: "demo-hammer", narration: nil)
    var hammer = try await demo.snapshot().sessions.first { $0.id == "demo-hammer" }
    XCTAssertEqual(hammer?.narration, .session)
    try await demo.setNarration(session: "demo-hammer", narration: .relay)
    try await demo.setManaged(session: "demo-hammer", managed: false)
    hammer = try await demo.snapshot().sessions.first { $0.id == "demo-hammer" }
    XCTAssertNil(hammer?.narration)
    try await demo.setManaged(session: "demo-hammer", managed: true)
    hammer = try await demo.snapshot().sessions.first { $0.id == "demo-hammer" }
    XCTAssertEqual(hammer?.narration, .session)
  }

  // MARK: - 异常路径

  func testUnknownOrMistypedValuesDecodeAsNilWithoutFailingTheRow() throws {
    for raw in [#""loud""#, #""SELF""#, "1", "null", "{}"] {
      let info = try decode(#"{"id":"a","title":"t","narration":"# + raw + "}")
      XCTAssertNil(info.narration)
      XCTAssertEqual(info.title, "t")
    }
  }

  func testHostFailureShowsErrorAndSkipsRefresh() async {
    await load([hammer])
    await api.setNarrationError(.http(404))
    let before = await api.snapshotCalls
    await model.toggleNarration("s-hammer")
    XCTAssertTrue(model.sendError?.hasPrefix("切换播报失败：") ?? false)
    let after = await api.snapshotCalls
    XCTAssertEqual(after, before)
    XCTAssertNil(model.managingID)
    await api.setNarrationError(nil)
    await model.toggleNarration("s-hammer")
    XCTAssertNil(model.sendError)
  }

  func testUnmanagedOrUnknownSessionsAreNeverSent() async {
    await load([hammer, quant])
    await model.toggleNarration("s-quant")
    await model.toggleNarration("ghost")
    let calls = await api.narrationCalls
    XCTAssertTrue(calls.isEmpty)
  }

  func testDemoRejectsUnmanagedSessions() async {
    let demo = DemoAPI()
    for id in ["demo-quant", "ghost"] {
      do {
        try await demo.setNarration(session: id, narration: .relay)
        XCTFail("expected 404 for \(id)")
      } catch { XCTAssertEqual(error as? JarvisAPIError, .http(404)) }
    }
  }

  func testClientSurfacesHostRejection() async {
    do {
      _ = try await clientCall(.relay, status: 404)
      XCTFail("expected http 404")
    } catch { XCTAssertEqual(error as? JarvisAPIError, .http(404)) }
  }
}
