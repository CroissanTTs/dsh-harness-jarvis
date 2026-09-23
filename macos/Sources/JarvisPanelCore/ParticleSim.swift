import Foundation

/// One quad for the renderer. Coordinates are orb units (1 = 55.2pt, y up);
/// `size` is the sprite side in the same units.
public struct PointSprite: Equatable {
  public var x: Float
  public var y: Float
  public var size: Float
  public var alpha: Float
}

/// Per-state motion parameters, verbatim from `states-v5.html` (`STATES`).
public struct MotionParams: Sendable {
  public enum Region: Sendable { case core, ring1, ring2, speak }

  public var region: Region
  public var retarget: Double
  public var hop: Double
  public var orbit: (Double, Double)
  public var jitter: Double
  public var kMul: Double
  public var base: Double
  public var speedGlow: Double = 0.35
  public var noise: Double = 0
  public var beat = false
  public var flicker = false

  public static func params(_ m: OrbMotion) -> MotionParams {
    switch m {
    case .idle:
      return MotionParams(region: .core, retarget: 0.10, hop: .pi * 2, orbit: (0, 0), jitter: 0.012, kMul: 0.55, base: 0.22)
    case .awaiting:
      return MotionParams(region: .ring1, retarget: 0.06, hop: 0.6, orbit: (0.04, 0.3), jitter: 0.008, kMul: 0.8, base: 0.32)
    case .thinking:
      return MotionParams(region: .ring1, retarget: 1.8, hop: 0.9, orbit: (0, 0), jitter: 0.004, kMul: 1.7, base: 0.2,
                          speedGlow: 1.1)
    case .speaking:
      return MotionParams(region: .speak, retarget: 0, hop: 0, orbit: (0.02, 0.1), jitter: 0.006, kMul: 1.3, base: 0.35)
    case .attention:
      return MotionParams(region: .ring2, retarget: 0.05, hop: 0.5, orbit: (0.02, 0.08), jitter: 0.006, kMul: 0.9,
                          base: 0.35, beat: true)
    case .error:
      return MotionParams(region: .ring1, retarget: 0.7, hop: 0.4, orbit: (0, 0), jitter: 0.004, kMul: 2.0, base: 0.3,
                          noise: 2.6, flicker: true)
    }
  }
}

/// Independent spring-driven particles (spec §2.2). Each particle owns its
/// stiffness, damping, orbit speed and twinkle phase, and travels to its own
/// slot, so state changes read as many individuals moving rather than a shape
/// morphing.
public struct ParticleSim {
  public static let r0 = 0.40
  public static let ringWidth = 0.30
  public static let core: ClosedRange<Double> = 0...(0.40 * 0.93)
  public static let ring1: ClosedRange<Double> = 0.42...0.68
  public static let ring2: ClosedRange<Double> = 0.72...0.98
  /// Points per orb unit: 120pt orb, drawn at 92% of its radius.
  public static let unitPoints = 55.2
  /// Half of the 140pt orb window, in orb units.
  public static let windowHalf = 70.0 / 55.2
  static let spriteUnits = 3.6 / 55.2

  private static let tau = Double.pi * 2
  private static let gold = Double.pi * (3 - 5.0.squareRoot())

  private struct Particle {
    var x = 0.0, y = 0.0, vx = 0.0, vy = 0.0
    var tr = 0.0, tth = 0.0
    var ntr = 0.0, nth = 0.0
    var departAt: Double?
    var b = 0.0, om = 0.0
    var k = 0.0, zeta = 0.0
    var ph1 = 0.0, ph2 = 0.0, f1 = 0.0, f2 = 0.0, tw = 0.0, sz = 0.0
    /// Fixed random coordinates used to lay out the dock strip.
    var u = 0.0, v = 0.0
  }

  private var parts: [Particle] = []
  private var rng: SeededRandom
  private var lastBeatSlot = -1
  private var lastEnv = 0.0

  public private(set) var motion: OrbMotion = .idle
  public private(set) var dock: DockEdge?
  public var reduceMotion = false

  public init(count: Int, seed: UInt64) {
    rng = SeededRandom(seed: seed)
    parts = (0..<count).map { makeParticle(slotIndex: $0, of: count) }
  }

  public var count: Int { parts.count }

  public func positions() -> [(x: Double, y: Double)] {
    parts.map { ($0.x, $0.y) }
  }

  private mutating func makeParticle(slotIndex i: Int, of n: Int) -> Particle {
    let slot = Self.slots(n, Self.core)[i]
    var p = Particle()
    p.x = cos(slot.th) * slot.r
    p.y = sin(slot.th) * slot.r
    p.tr = slot.r
    p.tth = slot.th
    p.k = rng.range(10, 28)
    p.zeta = rng.range(0.55, 0.9)
    p.ph1 = rng.range(0, Self.tau)
    p.ph2 = rng.range(0, Self.tau)
    p.f1 = rng.range(0.6, 1.6)
    p.f2 = rng.range(0.6, 1.6)
    p.tw = rng.range(0, Self.tau)
    p.sz = rng.range(0.7, 1.3)
    p.u = rng.unit()
    p.v = rng.unit()
    return p
  }

  // MARK: Layout helpers

  private static func slots(_ n: Int, _ range: ClosedRange<Double>) -> [(r: Double, th: Double)] {
    let a = range.lowerBound, b = range.upperBound
    return (0..<n).map { i in
      let f = (Double(i) + 0.5) / Double(n)
      return ((a * a + (b * b - a * a) * f).squareRoot(), (Double(i) * gold).truncatingRemainder(dividingBy: tau))
    }
  }

  private static func range(for region: MotionParams.Region) -> ClosedRange<Double> {
    switch region {
    case .core: return core
    case .ring1, .speak: return ring1
    case .ring2: return ring2
    }
  }

  public static func voiceEnv(_ t: Double) -> Double {
    min(1, max(0, 0.5 + 0.34 * sin(t * 9.1) * sin(t * 2.3) + 0.22 * sin(t * 5.7 + 1)))
  }

  /// Double-beat heart pulse, period 1.6s.
  public static func pulse(_ t: Double) -> Double {
    let ph = t.truncatingRemainder(dividingBy: 1.6)
    return exp(-ph * 7) + (ph > 0.28 ? 0.7 * exp(-(ph - 0.28) * 7) : 0)
  }

  // MARK: State changes

  public mutating func setMotion(_ m: OrbMotion, t: Double) {
    motion = m
    if dock == nil { assign(t: t) }
  }

  public mutating func setDock(_ edge: DockEdge?, t: Double) {
    guard edge != dock else { return }
    dock = edge
    if edge == nil { assign(t: t) }
  }

  public mutating func setCount(_ n: Int, t: Double) {
    guard n != parts.count, n > 0 else { return }
    if n < parts.count {
      parts.removeLast(parts.count - n)
    } else {
      let extra = (parts.count..<n).map { makeParticle(slotIndex: $0, of: n) }
      parts.append(contentsOf: extra)
    }
    if dock == nil { assign(t: t) }
  }

  /// Sorted-angle matching so every particle travels radially to a nearby slot,
  /// departing with an angle-staggered delay.
  private mutating func assign(t: Double) {
    let st = MotionParams.params(motion)
    let n = parts.count
    let sl = Self.slots(n, Self.range(for: st.region)).sorted { $0.th < $1.th }
    let order = parts.indices
      .map { i -> (Int, Double) in
        let a = atan2(parts[i].y, parts[i].x)
        return (i, a < 0 ? a + Self.tau : a)
      }
      .sorted { $0.1 < $1.1 }
    let offset = Int(rng.unit() * Double(n))
    let r1 = Self.ring1
    for (rank, (i, a)) in order.enumerated() {
      let s = sl[(rank + offset) % n]
      var th = s.th
      while th - a > .pi { th -= Self.tau }
      while a - th > .pi { th += Self.tau }
      parts[i].ntr = s.r
      parts[i].nth = th
      parts[i].b = st.region == .speak ? (s.r - r1.lowerBound) / (r1.upperBound - r1.lowerBound) : 0
      if st.orbit.1 > 0 {
        parts[i].om = rng.range(st.orbit.0, st.orbit.1) * (rng.unit() < 0.85 ? 1 : -1)
      } else {
        parts[i].om = 0
      }
      if reduceMotion {
        parts[i].tr = s.r
        parts[i].tth = th
        parts[i].departAt = nil
        parts[i].om = 0
        let r = st.region == .speak ? Self.speakRadius(env: 0.5, b: parts[i].b) : s.r
        parts[i].x = cos(th) * r
        parts[i].y = sin(th) * r
        parts[i].vx = 0
        parts[i].vy = 0
      } else {
        parts[i].departAt = t + (a / Self.tau) * 0.3 + rng.unit() * 0.25
      }
    }
  }

  private static func speakRadius(env: Double, b: Double) -> Double {
    r0 + ringWidth * env + ringWidth * (0.05 + 0.9 * b)
  }

  // MARK: Stepping

  public mutating func step(t: Double, dt: Double) {
    if let dock {
      stepDocked(dock, t: t, dt: dt)
      return
    }
    let st = MotionParams.params(motion)
    let region = Self.range(for: st.region)
    let still = reduceMotion
    let env = st.region == .speak ? (still ? 0.5 : Self.voiceEnv(t)) : 0
    lastEnv = env

    var kick = 0.0
    if st.beat && !still {
      let ph = t.truncatingRemainder(dividingBy: 1.6)
      let slot = Int(t / 1.6) * 2 + (ph >= 0.28 ? 1 : 0)
      if slot != lastBeatSlot {
        kick = ph >= 0.28 ? 0.7 : 1
        lastBeatSlot = slot
      }
    }
    let jitter = still ? 0 : st.jitter
    let vmax = 2.4 * st.kMul.squareRoot()

    for i in parts.indices {
      var p = parts[i]
      if let at = p.departAt, t >= at {
        p.tr = p.ntr
        p.tth = p.nth
        p.departAt = nil
      }
      if p.departAt == nil && !still {
        if st.retarget > 0 && rng.unit() < st.retarget * dt {
          p.tr = (region.lowerBound * region.lowerBound
                  + (region.upperBound * region.upperBound - region.lowerBound * region.lowerBound) * rng.unit()).squareRoot()
          p.tth = st.hop >= Self.tau ? rng.unit() * Self.tau : p.tth + (rng.unit() - 0.5) * st.hop
        }
        p.tth += p.om * dt
      }
      var tr = p.tr
      if st.region == .speak && p.departAt == nil { tr = Self.speakRadius(env: env, b: p.b) }
      let tx = cos(p.tth) * tr + jitter * sin(t * p.f1 + p.ph1)
      let ty = sin(p.tth) * tr + jitter * cos(t * p.f2 + p.ph2)
      let k = p.k * st.kMul
      let c = 2 * k.squareRoot() * p.zeta
      var ax = (tx - p.x) * k - p.vx * c
      var ay = (ty - p.y) * k - p.vy * c
      if st.noise > 0 && !still {
        ax += (rng.unit() - 0.5) * st.noise * 2
        ay += (rng.unit() - 0.5) * st.noise * 2
      }
      p.vx += ax * dt
      p.vy += ay * dt
      if kick > 0 {
        let d = max((p.x * p.x + p.y * p.y).squareRoot(), 1e-6)
        let f = kick * rng.range(0.15, 0.45)
        p.vx += p.x / d * f
        p.vy += p.y / d * f
      }
      let sp = (p.vx * p.vx + p.vy * p.vy).squareRoot()
      if sp > vmax {
        p.vx *= vmax / sp
        p.vy *= vmax / sp
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      parts[i] = p
    }
  }

  /// Dock style B (`dock.html`): a thin particle strip along the edge, an L at
  /// corners. Speaking breathes the strip thickness.
  private mutating func stepDocked(_ edge: DockEdge, t: Double, dt: Double) {
    let env = motion == .speaking && !reduceMotion ? Self.voiceEnv(t) : 0
    lastEnv = env
    let jitter = reduceMotion ? 0 : 0.7 / Self.unitPoints
    for i in parts.indices {
      var p = parts[i]
      let target = Self.dockTarget(edge, u: p.u, v: p.v, env: env)
      let tx = target.x + jitter * sin(t * p.f1 + p.ph1)
      let ty = target.y + jitter * cos(t * p.f2 + p.ph2)
      let k = p.k * 1.2
      let c = 2 * k.squareRoot() * p.zeta
      p.vx += ((tx - p.x) * k - p.vx * c) * dt
      p.vy += ((ty - p.y) * k - p.vy * c) * dt
      let sp = (p.vx * p.vx + p.vy * p.vy).squareRoot()
      if sp > 12 {
        p.vx *= 12 / sp
        p.vy *= 12 / sp
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      parts[i] = p
    }
  }

  static func dockTarget(_ edge: DockEdge, u: Double, v: Double, env: Double) -> (x: Double, y: Double) {
    let h = windowHalf
    let th = (2 + 5 * u) / unitPoints * (1 + 1.2 * env)
    let along = (v - 0.5) * 96 / unitPoints
    let len = 78 / unitPoints
    let inset = 3 / unitPoints
    switch edge {
    case .right: return (h - th, along)
    case .left: return (-(h - th), along)
    case .top: return (along, h - th)
    case .bottom: return (along, -(h - th))
    case .topRight, .topLeft, .bottomRight, .bottomLeft:
      let sx: Double = (edge == .topRight || edge == .bottomRight) ? 1 : -1
      let sy: Double = (edge == .topRight || edge == .topLeft) ? 1 : -1
      if v < 0.5 {
        return (sx * (h - th), sy * (h - inset - v * 2 * len))
      }
      return (sx * (h - inset - (v - 0.5) * 2 * len), sy * (h - th))
    }
  }

  // MARK: Rendering data

  public func sprites(t: Double, into buffer: inout [PointSprite]) {
    let st = MotionParams.params(motion)
    let pulse = st.beat ? Self.pulse(t) : 0
    let docked = dock != nil
    buffer.removeAll(keepingCapacity: true)
    buffer.reserveCapacity(parts.count)
    for p in parts {
      let sp = (p.vx * p.vx + p.vy * p.vy).squareRoot()
      var a = st.base + 0.18 * sin(t * 2.2 + p.tw * 3) + st.speedGlow * sp + 0.4 * lastEnv + 0.45 * pulse
      if st.flicker { a *= 0.5 + 0.5 * abs(sin(t * (8 + p.f1 * 6) + p.tw)) }
      if docked { a *= 0.85 }
      a = min(1, max(0.08, a))
      buffer.append(PointSprite(x: Float(p.x), y: Float(p.y), size: Float(Self.spriteUnits * p.sz), alpha: Float(a)))
    }
  }
}
