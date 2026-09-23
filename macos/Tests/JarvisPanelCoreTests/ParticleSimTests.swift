import XCTest
@testable import JarvisPanelCore

final class ParticleSimTests: XCTestCase {
  private let dt = 1.0 / 60

  private func run(_ sim: inout ParticleSim, from t0: Double, seconds: Double) -> Double {
    var t = t0
    for _ in 0..<Int(seconds / dt) {
      t += dt
      sim.step(t: t, dt: dt)
    }
    return t
  }

  private func radii(_ sim: ParticleSim) -> [Double] {
    sim.positions().map { ($0.x * $0.x + $0.y * $0.y).squareRoot() }
  }

  func testSameSeedIsDeterministic() {
    var a = ParticleSim(count: 200, seed: 9)
    var b = ParticleSim(count: 200, seed: 9)
    a.setMotion(.thinking, t: 0)
    b.setMotion(.thinking, t: 0)
    _ = run(&a, from: 0, seconds: 1)
    _ = run(&b, from: 0, seconds: 1)
    XCTAssertEqual(a.positions().map(\.x), b.positions().map(\.x))
  }

  func testStartsInCore() {
    let sim = ParticleSim(count: 900, seed: 1)
    XCTAssertEqual(sim.count, 900)
    XCTAssertTrue(radii(sim).allSatisfy { $0 <= 0.40 })
  }

  func testNonIdleStatesEmptyTheCore() {
    for motion in [OrbMotion.awaiting, .thinking, .attention, .error] {
      var sim = ParticleSim(count: 900, seed: 3)
      sim.setMotion(motion, t: 0)
      _ = run(&sim, from: 0, seconds: 4)
      let inCore = radii(sim).filter { $0 < 0.40 }.count
      XCTAssertEqual(inCore, 0, "\(motion) left \(inCore) particles in the core")
    }
  }

  func testSpeakingKeepsCoreAlmostEmpty() {
    var sim = ParticleSim(count: 900, seed: 3)
    sim.setMotion(.speaking, t: 0)
    _ = run(&sim, from: 0, seconds: 4)
    let inCore = radii(sim).filter { $0 < 0.40 }.count
    XCTAssertLessThan(inCore, 18)
  }

  func testIdleReturnsToCore() {
    var sim = ParticleSim(count: 900, seed: 4)
    sim.setMotion(.awaiting, t: 0)
    var t = run(&sim, from: 0, seconds: 3)
    sim.setMotion(.idle, t: t)
    t = run(&sim, from: t, seconds: 5)
    XCTAssertTrue(radii(sim).allSatisfy { $0 <= 0.40 })
  }

  func testAttentionGoesToOuterRing() {
    var sim = ParticleSim(count: 900, seed: 5)
    sim.setMotion(.attention, t: 0)
    _ = run(&sim, from: 0, seconds: 4)
    let outer = radii(sim).filter { $0 >= 0.70 && $0 <= 1.0 }.count
    XCTAssertGreaterThan(Double(outer) / 900, 0.9)
  }

  func testSetCountChangesParticleCount() {
    var sim = ParticleSim(count: 900, seed: 6)
    sim.setCount(300, t: 0)
    XCTAssertEqual(sim.count, 300)
    sim.setCount(600, t: 0)
    XCTAssertEqual(sim.count, 600)
  }

  func testRightDockFormsStripAtWindowEdge() {
    var sim = ParticleSim(count: 900, seed: 7)
    sim.setDock(.right, t: 0)
    _ = run(&sim, from: 0, seconds: 3)
    XCTAssertTrue(sim.positions().allSatisfy { $0.x > ParticleSim.windowHalf - 0.2 })
  }

  func testTopLeftDockFormsLShape() {
    var sim = ParticleSim(count: 900, seed: 8)
    sim.setDock(.topLeft, t: 0)
    _ = run(&sim, from: 0, seconds: 3)
    let h = ParticleSim.windowHalf
    XCTAssertTrue(sim.positions().allSatisfy { $0.x < -h + 0.2 || $0.y > h - 0.2 })
  }

  func testUndockReturnsToMotionRegion() {
    var sim = ParticleSim(count: 900, seed: 8)
    sim.setMotion(.awaiting, t: 0)
    sim.setDock(.right, t: 0)
    var t = run(&sim, from: 0, seconds: 3)
    sim.setDock(nil, t: t)
    t = run(&sim, from: t, seconds: 4)
    XCTAssertTrue(radii(sim).allSatisfy { $0 >= 0.40 && $0 <= 0.72 })
  }

  func testVoiceEnvelopeInUnitRange() {
    for i in 0..<2000 {
      let v = ParticleSim.voiceEnv(Double(i) * 0.013)
      XCTAssert(v >= 0 && v <= 1)
    }
  }

  func testSpriteAlphaClamped() {
    var sim = ParticleSim(count: 300, seed: 10)
    var buffer: [PointSprite] = []
    for motion in OrbMotion.allCases {
      sim.setMotion(motion, t: 0)
      let t = run(&sim, from: 0, seconds: 1)
      sim.sprites(t: t, into: &buffer)
      XCTAssertEqual(buffer.count, 300)
      XCTAssertTrue(buffer.allSatisfy { $0.alpha >= 0.08 && $0.alpha <= 1 }, "\(motion)")
    }
  }

  func testReduceMotionSnapsToTargetsImmediately() {
    var sim = ParticleSim(count: 900, seed: 11)
    sim.reduceMotion = true
    sim.setMotion(.awaiting, t: 0)
    XCTAssertTrue(radii(sim).allSatisfy { $0 >= 0.40 && $0 <= 0.70 })
    let before = sim.positions().map(\.x)
    _ = run(&sim, from: 0, seconds: 1)
    let drift = zip(before, sim.positions().map(\.x)).map { abs($0 - $1) }.max() ?? 0
    XCTAssertLessThan(drift, 0.01)
  }
}
