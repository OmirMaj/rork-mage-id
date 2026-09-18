// ARTrackSession.swift — the ARSession owner.
//
// WHAT THIS IS FOR. A MEASURED TRIAL, not a feature. The founder asked whether
// a punch pin could be placed for him; the honest published numbers are
// loop-closure errors of 0.14–0.79 m over 84–145 m CLOSED loops and roughly
// 0.02–0.04 m/s of relative drift (~2–4% of the distance walked, ONE WAY), and
// ARKit tracks the PHONE, not the defect across the room. None of that has ever
// been measured on a construction floor. So this file's job is to hand JS raw,
// timestamped, honestly-labelled poses — and to refuse, loudly, when it cannot.
//
// THE THREE RULES THIS FILE IS BUILT AROUND
//
//   1. NEVER INVENT A POSITION. A raycast that misses returns `hit: false`; it
//      never substitutes a point at a guessed distance. A pose taken while
//      tracking is `.limited` is returned WITH that label, never silently.
//
//   2. EVERY READING CARRIES ITS EPOCH. The epoch counter increments on every
//      interruption and on every drop to `.notAvailable`. Two readings from
//      different epochs are not comparable unless ARKit came back through
//      `.limited(.relocalizing)` into `.normal` — the boundary then carries
//      `relocalized: true`. A trial that averages across an un-relocalized
//      break is measuring the wrong thing, and the published figures all assume
//      unbroken tracking.
//
//   3. THE RAW TRACK SURVIVES. `exportTrack` writes every sample as NDJSON.
//      Alignment, misses and drift rates are all re-derived offline from that
//      file, so one 15-minute walk answers short-baseline vs long-baseline vs
//      best-fit, with and without a mid-walk reset. If the app computed the
//      answer live, each variant would cost the founder another walk.
//
// THREADING. The ARSession delegate runs on a dedicated SERIAL queue so 60 Hz
// frame handling never contends with the UI. The latest pose is written into a
// lock-guarded snapshot that the synchronous `getPose` reads, which is why a
// tap-to-mark never waits on a queue hop.
//
// SIMULATOR. Everything below `#if !targetEnvironment(simulator)` is compiled
// OUT of the simulator slice, ARKit import included, and the stub at the bottom
// takes its place. That makes "does the simulator support ARKit" a question
// nobody has to bet on: the founder's simulator keeps building and booting, and
// the dev screen says why there is nothing to measure.

import ExpoModulesCore
import Foundation

#if !targetEnvironment(simulator)
import ARKit
import AVFoundation
import UIKit

internal final class ARTrackSession: NSObject, ARSessionDelegate {
  static let shared = ARTrackSession()

  // Callbacks into the module. Set once in OnCreate, cleared in OnDestroy.
  var onStatus: (([String: Any]) -> Void)?
  var onSample: (([String: Any]) -> Void)?
  var onError: (([String: Any]) -> Void)?

  private let session = ARSession()
  private let delegateQueue = DispatchQueue(label: "app.mageid.artrack.frames")
  private let lock = NSLock()

  // ── state, all behind `lock` ──────────────────────────────────────────────
  private var running = false
  private var startedAtBoot: TimeInterval = 0

  private var latest: PoseSnapshot?
  private var origin: OriginSnapshot?

  private var epoch = 0
  private var epochs: [EpochRecord] = []
  private var awaitingRelocalization = false

  private var pathLengthM: Double = 0
  private var lastPathPoint: SIMD3<Float>?
  private var sampleCount = 0

  private var normalS: Double = 0
  private var limitedS: Double = 0
  private var lostS: Double = 0
  private var lastStateChangeAt: TimeInterval = 0
  /// One of OUR labels ("tracked" | "limited" | "lost"), never ARKit's
  /// "notAvailable". It starts as "lost" because a session that has just been
  /// run has no pose yet; starting it on a string no frame can ever produce
  /// made the very first `.notAvailable` frame look like a CHANGE and opened a
  /// spurious "trackingLost" epoch at t = 0 — a break that every later reading
  /// would then have to be "relocalized" across.
  private var lastTrackingLabel = "lost"

  private var rawTrack: [[String: Any]] = []
  private var logIntervalS: Double = 0.2
  private var lastLoggedAt: TimeInterval = 0
  private var pathDownsampled = false

  private var eventIntervalS: Double = 0.2
  private var lastEventAt: TimeInterval = 0

  private var cachedCapabilities: [String: Any]?

  /// Raw samples kept in memory before the track is halved in place. 30 000 at
  /// 5 Hz is ~100 minutes, comfortably past the 45-minute auto-stop; the halving
  /// exists so a forgotten session degrades resolution instead of memory.
  private static let maxRawSamples = 30_000

  /// A single frame-to-frame step longer than this is a tracking JUMP, not a
  /// walk — 1 m at 60 Hz would be 60 m/s. Counting it would inflate "distance
  /// walked", which is one of the two denominators the whole trial is reported
  /// against.
  private static let maxPlausibleStepM: Double = 1.0

  private struct PoseSnapshot {
    let transform: simd_float4x4
    let atBoot: TimeInterval
    let frameTimestamp: TimeInterval
    let trust: String
    let reason: String?
    let epoch: Int
    let featurePoints: Int
    let worldMapping: String
    let ambientLumens: Double?
  }

  private struct OriginSnapshot {
    let translation: SIMD3<Float>
    let yaw0: Double
    let atBoot: TimeInterval
    let epoch: Int
  }

  private struct EpochRecord {
    let epoch: Int
    let startedAtS: Double
    let cause: String
    var relocalized: Bool
  }

  // MARK: - Capabilities

  /// Computed once and cached. `getCapabilities` is synchronous, so it must
  /// never touch ARKit from the JS thread.
  func capabilities() -> [String: Any] {
    lock.lock()
    if let c = cachedCapabilities { lock.unlock(); return c }
    lock.unlock()

    let supported = ARWorldTrackingConfiguration.isSupported
    let lidar = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    var highRes = false
    if #available(iOS 16.0, *) {
      highRes = ARWorldTrackingConfiguration.recommendedVideoFormatForHighResolutionFrameCapturing != nil
    }

    let reason: String
    if !supported {
      reason = "unsupportedDevice"
    } else {
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: reason = "ok"
      case .notDetermined: reason = "cameraUndetermined"
      default: reason = "cameraDenied"
      }
    }

    let caps: [String: Any] = [
      "available": supported && reason == "ok",
      "reason": reason,
      "hasLidar": lidar,
      "supportsHighResCapture": highRes,
      "deviceModel": ARTrackSession.deviceModel(),
      "osVersion": UIDevice.current.systemVersion,
    ]
    lock.lock(); cachedCapabilities = caps; lock.unlock()
    return caps
  }

  /// Re-read permission on the next `capabilities()` call. Called after JS has
  /// raised the camera prompt, because the cached answer is now stale.
  func invalidateCapabilities() {
    lock.lock(); cachedCapabilities = nil; lock.unlock()
  }

  private static func deviceModel() -> String {
    var info = utsname()
    uname(&info)
    let mirror = Mirror(reflecting: info.machine)
    let id = mirror.children.reduce(into: "") { acc, el in
      guard let value = el.value as? Int8, value != 0 else { return }
      acc.append(Character(UnicodeScalar(UInt8(bitPattern: value))))
    }
    return id.isEmpty ? UIDevice.current.model : id
  }

  // MARK: - Lifecycle

  func start(options: ARTrackStartOptions) throws {
    guard ARWorldTrackingConfiguration.isSupported else { throw Exceptions.ArUnavailable() }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: break
    case .notDetermined: throw Exceptions.ArCameraUndetermined()
    default: throw Exceptions.ArCameraDenied()
    }

    let config = ARWorldTrackingConfiguration()
    // .gravity, NOT .gravityAndHeading. gravityAndHeading ties the x/z axes to
    // the COMPASS, and the compass is the error source the research already
    // rejected for indoor work (5.6°/9.2° heading error; magnetic interference
    // from the steel it would be measuring). Gravity alone gives a y axis that
    // is true vertical and leaves heading to the origin the founder sets.
    config.worldAlignment = .gravity
    // Planes are what a raycast has to hit. Without them the defect channel
    // only ever gets `estimatedPlane` answers.
    config.planeDetection = [.horizontal, .vertical]
    config.environmentTexturing = .none

    if options.sceneDepth, ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      // Only ever set after the support check — setting an unsupported frame
      // semantic is a programmer error that traps.
      config.frameSemantics.insert(.sceneDepth)
    }
    if options.highResCapture, #available(iOS 16.0, *),
       let fmt = ARWorldTrackingConfiguration.recommendedVideoFormatForHighResolutionFrameCapturing {
      config.videoFormat = fmt
    }

    lock.lock()
    running = true
    startedAtBoot = ProcessInfo.processInfo.systemUptime
    latest = nil
    origin = nil
    epoch = 0
    epochs = [EpochRecord(epoch: 0, startedAtS: 0, cause: "start", relocalized: false)]
    awaitingRelocalization = false
    pathLengthM = 0
    lastPathPoint = nil
    sampleCount = 0
    normalS = 0; limitedS = 0; lostS = 0
    lastStateChangeAt = startedAtBoot
    lastTrackingLabel = "lost"
    rawTrack = []
    pathDownsampled = false
    logIntervalS = 0.2
    lastLoggedAt = 0
    let hz = max(0.5, min(30.0, options.hz))
    eventIntervalS = 1.0 / hz
    lastEventAt = 0
    lock.unlock()

    session.delegate = self
    session.delegateQueue = delegateQueue
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
    emitStatus(trust: "notAvailable", reason: "initializing", interrupted: false)
  }

  func stop() {
    session.pause()
    session.delegate = nil
    lock.lock()
    if running { accrueStateTime(now: ProcessInfo.processInfo.systemUptime) }
    running = false
    latest = nil
    lock.unlock()
    emitStatus(trust: "notAvailable", reason: nil, interrupted: false)
  }

  var isRunning: Bool {
    lock.lock(); defer { lock.unlock() }
    return running
  }

  // MARK: - Reads

  /// The CACHED latest frame, plus how old it is. `ageMs` is returned rather
  /// than hidden: a stale pose the caller can see is a fact; a stale pose that
  /// looks fresh is the bug this whole trial exists to avoid.
  func poseSnapshot() -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    guard running else {
      return ["available": false, "reason": "notRunning"]
    }
    guard let p = latest else {
      return ["available": false, "reason": "noFrameYet"]
    }
    var out = describe(pose: p, origin: origin)
    out["available"] = true
    out["ageMs"] = (ProcessInfo.processInfo.systemUptime - p.atBoot) * 1000.0
    return out
  }

  func setOrigin() throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    guard running else { throw Exceptions.ArNotRunning() }
    guard let p = latest else { throw Exceptions.ArNotTracking() }
    guard p.trust == "tracked" else { throw Exceptions.ArNotTracking() }

    let t = p.transform.translation
    let yaw = ARTrackSession.yaw(of: p.transform)
    origin = OriginSnapshot(translation: t, yaw0: yaw, atBoot: p.atBoot, epoch: p.epoch)
    return [
      "yawDeg": yaw * 180.0 / .pi,
      "world": ["x": Double(t.x), "y": Double(t.y), "z": Double(t.z)],
      "epoch": p.epoch,
      "atS": p.atBoot - startedAtBoot,
      "frameT": p.frameTimestamp,
    ]
  }

  func markPoint(label: String?) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    guard running else { throw Exceptions.ArNotRunning() }
    guard let p = latest else { throw Exceptions.ArNotTracking() }
    guard origin != nil else { throw Exceptions.ArNoOrigin() }
    var out = describe(pose: p, origin: origin)
    out["label"] = label as Any
    out["pathLengthM"] = pathLengthM
    out["ageMs"] = (ProcessInfo.processInfo.systemUptime - p.atBoot) * 1000.0
    rawTrack.append(mergedRawSample(out, kind: "mark"))
    return out
  }

  func trackSummary() throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    guard running else { throw Exceptions.ArNotRunning() }
    let now = ProcessInfo.processInfo.systemUptime
    // Charge the time since the last frame to the current label, so
    // normalS + limitedS + lostS == elapsedS at the moment this is read. Without
    // it, a summary taken mid-interruption (no frames arrive) would leave the
    // whole interruption uncounted — and normalS / elapsedS is a ship gate.
    accrueStateTime(now: now)
    return [
      "elapsedS": now - startedAtBoot,
      "pathLengthM": pathLengthM,
      "sampleCount": sampleCount,
      "normalS": normalS,
      "limitedS": limitedS,
      "lostS": lostS,
      "pathDownsampled": pathDownsampled,
      "epochs": epochs.map { ["epoch": $0.epoch, "startedAtS": $0.startedAtS, "cause": $0.cause, "relocalized": $0.relocalized] },
    ]
  }

  /// Every raw sample as NDJSON in the cache directory. Non-negotiable for a
  /// measured trial: the ARKit-world path has to survive the walk so the
  /// numbers can be re-derived afterwards instead of trusted live.
  func exportTrack() throws -> [String: Any] {
    lock.lock()
    let rows = rawTrack
    let downsampled = pathDownsampled
    lock.unlock()

    var text = ""
    for row in rows {
      guard let data = try? JSONSerialization.data(withJSONObject: row, options: []),
            let line = String(data: data, encoding: .utf8) else { continue }
      text += line + "\n"
    }
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let url = dir.appendingPathComponent("mage-ar-track-\(Int(Date().timeIntervalSince1970)).ndjson")
    do {
      try text.write(to: url, atomically: true, encoding: .utf8)
    } catch {
      throw Exceptions.ArExportFailed(error.localizedDescription)
    }
    return ["uri": url.absoluteString, "rows": rows.count, "pathDownsampled": downsampled]
  }

  // MARK: - Raycast

  func raycast(options: ARTrackRaycastOptions) throws -> [String: Any] {
    guard isRunning else { throw Exceptions.ArNotRunning() }
    guard let frame = session.currentFrame else { throw Exceptions.ArNotTracking() }

    let point = CGPoint(x: options.x, y: options.y)
    let alignment: ARRaycastQuery.TargetAlignment
    switch options.alignment {
    case "horizontal": alignment = .horizontal
    case "vertical": alignment = .vertical
    default: alignment = .any
    }

    // Tried in quality order, and the ANSWER SAYS WHICH ONE HIT. An existing
    // plane's geometry is a measured surface; an estimated plane is ARKit's
    // guess at one. Collapsing them into "hit: true" would hide the difference
    // that matters most when the miss is large.
    var targets: [(String, ARRaycastQuery.Target)] = [("existingPlaneGeometry", .existingPlaneGeometry)]
    if options.allowing != "existingPlaneGeometry" {
      targets.append(("estimatedPlane", .estimatedPlane))
    }

    for (name, target) in targets {
      let query = frame.raycastQuery(from: point, allowing: target, alignment: alignment)
      guard let hit = session.raycast(query).first else { continue }
      let hitPos = hit.worldTransform.translation
      let cam = frame.camera.transform.translation
      let d = simd_distance(hitPos, cam)
      return [
        "hit": true,
        "target": name,
        "alignment": ARTrackSession.label(for: hit.targetAlignment),
        "point": ["x": Double(hitPos.x), "y": Double(hitPos.y), "z": Double(hitPos.z)],
        "local": localPoint(world: hitPos),
        "distanceM": Double(d),
      ]
    }

    // A miss is a result, not an error. The module does not place a point at a
    // guessed distance so the screen has something to draw.
    return ["hit": false, "target": NSNull(), "alignment": NSNull()]
  }

  // MARK: - High-resolution capture

  /// The system camera CANNOT be used during an AR session — a session is
  /// interrupted the moment it stops receiving camera or motion data, which
  /// would end the very tracking being measured. So a photo taken during a
  /// tracked walk has to come from ARKit itself.
  func captureFrame(completion: @escaping (Result<[String: Any], Exception>) -> Void) {
    guard isRunning else { completion(.failure(Exceptions.ArNotRunning())); return }
    guard #available(iOS 16.0, *) else {
      completion(.failure(Exceptions.ArHighResUnsupported()))
      return
    }
    session.captureHighResolutionFrame { [weak self] frame, error in
      guard let self else { return }
      if let error {
        completion(.failure(Exceptions.ArExportFailed(error.localizedDescription)))
        return
      }
      guard let frame else {
        completion(.failure(Exceptions.ArNotTracking()))
        return
      }
      let buffer = frame.capturedImage
      let ci = CIImage(cvPixelBuffer: buffer)
      let ctx = CIContext()
      guard let cg = ctx.createCGImage(ci, from: ci.extent),
            let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.9) else {
        completion(.failure(Exceptions.ArExportFailed("could not encode the captured frame")))
        return
      }
      let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      let url = dir.appendingPathComponent("mage-ar-frame-\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
      do { try jpeg.write(to: url) } catch {
        completion(.failure(Exceptions.ArExportFailed(error.localizedDescription)))
        return
      }
      self.lock.lock()
      let snap = self.latest
      let org = self.origin
      self.lock.unlock()
      var out: [String: Any] = [
        "uri": url.absoluteString,
        "width": Int(ci.extent.width),
        "height": Int(ci.extent.height),
      ]
      if let snap { out["pose"] = self.describe(pose: snap, origin: org) }
      out["trust"] = snap?.trust ?? "lost"
      completion(.success(out))
    }
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    let now = ProcessInfo.processInfo.systemUptime
    let (trust, reason) = ARTrackSession.label(for: frame.camera.trackingState)

    lock.lock()
    guard running else { lock.unlock(); return }

    // Time in each state, accumulated at the full frame rate. `normalS` over
    // wall time is one of the pass/fail gates for the trial.
    accrueStateTime(now: now)

    if trust != lastTrackingLabel {
      if trust == "lost" {
        epoch += 1
        epochs.append(EpochRecord(epoch: epoch, startedAtS: now - startedAtBoot, cause: "trackingLost", relocalized: false))
        awaitingRelocalization = false
        lastPathPoint = nil
      }
      if reason == "relocalizing" { awaitingRelocalization = true }
      if trust == "tracked", awaitingRelocalization {
        // ARKit came back into the SAME world coordinates. Readings either side
        // of this boundary are comparable again — and that is exactly what the
        // `relocalized` flag licenses the analysis to do.
        awaitingRelocalization = false
        if !epochs.isEmpty { epochs[epochs.count - 1].relocalized = true }
      }
      lastTrackingLabel = trust
      let e = epoch
      lock.unlock()
      emitStatus(trust: trust, reason: reason, interrupted: false, epoch: e)
      lock.lock()
    }

    let t = frame.camera.transform
    let pos = t.translation
    if trust == "tracked" {
      if let last = lastPathPoint {
        let step = Double(simd_distance(pos, last))
        // Only plausible steps count toward "distance walked".
        if step <= ARTrackSession.maxPlausibleStepM { pathLengthM += step }
      }
      lastPathPoint = pos
    }

    let snap = PoseSnapshot(
      transform: t,
      atBoot: now,
      frameTimestamp: frame.timestamp,
      trust: trust,
      reason: reason,
      epoch: epoch,
      featurePoints: frame.rawFeaturePoints?.points.count ?? 0,
      worldMapping: ARTrackSession.label(for: frame.worldMappingStatus),
      ambientLumens: frame.lightEstimate.map { Double($0.ambientIntensity) }
    )
    latest = snap
    sampleCount += 1

    var rawRow: [String: Any]?
    if now - lastLoggedAt >= logIntervalS {
      lastLoggedAt = now
      rawRow = mergedRawSample(describe(pose: snap, origin: origin), kind: "path")
    }
    if let rawRow {
      rawTrack.append(rawRow)
      if rawTrack.count > ARTrackSession.maxRawSamples {
        // Halve the resolution in place rather than drop the tail or the head:
        // a long session should lose detail evenly, and the flag says it did.
        // ONLY "path" rows are thinned. A "mark" row is a station — the one
        // thing the trial exists to record — so every mark survives, however
        // long the session runs.
        var pathIndex = 0
        rawTrack = rawTrack.filter { row in
          guard (row["kind"] as? String) == "path" else { return true }
          defer { pathIndex += 1 }
          return pathIndex % 2 == 0
        }
        logIntervalS *= 2
        pathDownsampled = true
      }
    }

    var eventRow: [String: Any]?
    if now - lastEventAt >= eventIntervalS {
      lastEventAt = now
      eventRow = describe(pose: snap, origin: origin)
      eventRow?["pathLengthM"] = pathLengthM
    }
    lock.unlock()

    if let eventRow { onSample?(eventRow) }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    onError?(["code": "E_AR_SESSION_FAILED", "message": error.localizedDescription])
  }

  func sessionWasInterrupted(_ session: ARSession) {
    let now = ProcessInfo.processInfo.systemUptime
    lock.lock()
    // No frames arrive during an interruption, so nothing else will charge
    // this time anywhere. Close out the label that was current (usually
    // "tracked") up to NOW, then switch to "lost": the first frame after the
    // interruption charges the whole gap to lostS, where it belongs. Leaving
    // the label on "tracked" credited a pocketed phone with normal tracking,
    // which flatters the ">= 95% of wall time tracked" ship gate.
    accrueStateTime(now: now)
    lastTrackingLabel = "lost"
    epoch += 1
    epochs.append(EpochRecord(epoch: epoch, startedAtS: now - startedAtBoot, cause: "interrupted", relocalized: false))
    awaitingRelocalization = false
    lastPathPoint = nil
    // The cached pose is from BEFORE the camera stopped. Keeping it would let a
    // mark taken mid-interruption record a confident "tracked" position that is
    // really a memory; clearing it makes markPoint refuse instead.
    latest = nil
    let e = epoch
    lock.unlock()
    emitStatus(trust: "notAvailable", reason: nil, interrupted: true, epoch: e)
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    lock.lock(); awaitingRelocalization = true; let e = epoch; lock.unlock()
    emitStatus(trust: "limited", reason: "relocalizing", interrupted: false, epoch: e)
  }

  /// TRUE on purpose. Without it ARKit starts a NEW world after an interruption
  /// — a pocket, a phone call, a backgrounding — and the origin the founder set
  /// silently stops meaning anything while every reading still looks valid.
  func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

  // MARK: - Shaping

  /// Charge `now - lastStateChangeAt` to the label that was current, and
  /// restart the clock. Caller must hold `lock`.
  private func accrueStateTime(now: TimeInterval) {
    let dt = max(0, now - lastStateChangeAt)
    switch lastTrackingLabel {
    case "tracked": normalS += dt
    case "limited": limitedS += dt
    default: lostS += dt
    }
    lastStateChangeAt = now
  }

  /// Caller must hold `lock`.
  private func describe(pose p: PoseSnapshot, origin org: OriginSnapshot?) -> [String: Any] {
    let world = p.transform.translation
    var out: [String: Any] = [
      "t": p.atBoot - startedAtBoot,
      "frameT": p.frameTimestamp,
      "trust": p.trust,
      "reason": p.reason as Any,
      "epoch": p.epoch,
      "featurePoints": p.featurePoints,
      "worldMapping": p.worldMapping,
      "ambientLumens": p.ambientLumens as Any,
      // The UNROTATED ARKit-world translation rides along on every sample so the
      // origin maths can be redone from the exported file with a different
      // origin, or none at all.
      "world": ["x": Double(world.x), "y": Double(world.y), "z": Double(world.z)],
      "yawDeg": ARTrackSession.yaw(of: p.transform) * 180.0 / .pi,
    ]
    if let org {
      out["local"] = ARTrackSession.local(world: world, origin: org)
      out["originEpoch"] = org.epoch
      // The one thing the analysis must not have to infer: whether these two
      // readings are even comparable.
      out["sameEpochAsOrigin"] = org.epoch == p.epoch
    } else {
      out["local"] = NSNull()
      out["originEpoch"] = NSNull()
      out["sameEpochAsOrigin"] = false
    }
    return out
  }

  /// Caller must hold `lock`.
  private func localPoint(world: SIMD3<Float>) -> Any {
    guard let org = origin else { return NSNull() }
    return ARTrackSession.local(world: world, origin: org)
  }

  /// Caller must hold `lock`.
  private func mergedRawSample(_ row: [String: Any], kind: String) -> [String: Any] {
    var out = row
    out["kind"] = kind
    out["pathLengthM"] = pathLengthM
    return out
  }

  private func emitStatus(trust: String, reason: String?, interrupted: Bool, epoch: Int? = nil) {
    let caps = capabilities()
    onStatus?([
      "available": caps["available"] ?? false,
      "trackingState": trust,
      "reason": reason as Any,
      "interrupted": interrupted,
      "epoch": epoch ?? 0,
      "hasLidar": caps["hasLidar"] ?? false,
    ])
  }

  // MARK: - Geometry
  //
  // WHY SUBTRACTION AND NOT `ARSession.setWorldOrigin(relativeTransform:)`.
  // That call exists and is Apple-sanctioned, but passing the camera transform
  // would carry the phone's PITCH AND ROLL into the world basis and tilt the
  // world off gravity — and it MUTATES the session, so a bad matrix silently
  // corrupts every later reading with nothing left to audit. Subtraction is
  // arithmetic we can print, log and redo from the raw file, which is the whole
  // point of a measured trial. setWorldOrigin stays available for later; see
  // ../README.md so the next person knows it was considered, not missed.

  /// Heading of the lens projected onto the horizontal plane, in radians.
  /// At identity the camera looks down -z, and this returns 0. Turning right
  /// (toward +x) increases it.
  static func yaw(of m: simd_float4x4) -> Double {
    let forwardX = Double(-m.columns.2.x)
    let forwardZ = Double(-m.columns.2.z)
    return atan2(forwardX, -forwardZ)
  }

  /// World point expressed in the founder's frame: x = metres to his RIGHT when
  /// he set the origin, z = metres FORWARD, y = metres up. A yaw-only rotation
  /// leaves y as true gravity-referenced height.
  ///
  /// THIS FRAME IS LEFT-HANDED (right, up, forward) — a reflection of ARKit's
  /// right-handed world (right, up, toward-the-viewer). It exists for a person
  /// reading the file ("12 m ahead, 3 m to my right"), and it is NEVER an input
  /// to the plan fit: utils/arTrack/driftMath.ts fits on `world` only, because
  /// feeding this frame to a proper-rotation fit mirrors the floor.
  /// scripts/validate-ar-spike.ts carries a TS mirror of this formula and pins
  /// the text below so the two cannot drift apart.
  ///
  /// PRIVATE because `OriginSnapshot` is private: Swift rejects a less-private
  /// function whose signature names a private type, and that compile error
  /// would break EVERY iOS build, AR or not, since modules/ autolinks.
  private static func local(world: SIMD3<Float>, origin org: OriginSnapshot) -> [String: Any] {
    let dx = Double(world.x - org.translation.x)
    let dy = Double(world.y - org.translation.y)
    let dz = Double(world.z - org.translation.z)
    let c = cos(org.yaw0), s = sin(org.yaw0)
    return [
      "x": dx * c + dz * s,
      "y": dy,
      "z": dx * s - dz * c,
    ]
  }

  private static func label(for state: ARCamera.TrackingState) -> (String, String?) {
    switch state {
    case .normal: return ("tracked", nil)
    case .notAvailable: return ("lost", nil)
    case .limited(let why):
      switch why {
      case .initializing: return ("limited", "initializing")
      case .excessiveMotion: return ("limited", "excessiveMotion")
      case .insufficientFeatures: return ("limited", "insufficientFeatures")
      case .relocalizing: return ("limited", "relocalizing")
      @unknown default: return ("limited", "unknown")
      }
    }
  }

  private static func label(for status: ARFrame.WorldMappingStatus) -> String {
    switch status {
    case .notAvailable: return "notAvailable"
    case .limited: return "limited"
    case .extending: return "extending"
    case .mapped: return "mapped"
    @unknown default: return "unknown"
    }
  }

  private static func label(for alignment: ARRaycastQuery.TargetAlignment) -> String {
    switch alignment {
    case .horizontal: return "horizontal"
    case .vertical: return "vertical"
    case .any: return "any"
    @unknown default: return "unknown"
    }
  }
}

private extension simd_float4x4 {
  var translation: SIMD3<Float> { SIMD3<Float>(columns.3.x, columns.3.y, columns.3.z) }
}

#else

// ── SIMULATOR SLICE ─────────────────────────────────────────────────────────
//
// ARKit is not imported here at all, so the simulator build cannot fail on a
// framework it may not carry and cannot crash on an API that has no sensors
// behind it. Every entry point answers the same way: this is a simulator, and
// there is nothing to measure. The dev screen renders that sentence.

import UIKit

internal final class ARTrackSession: NSObject {
  static let shared = ARTrackSession()

  var onStatus: (([String: Any]) -> Void)?
  var onSample: (([String: Any]) -> Void)?
  var onError: (([String: Any]) -> Void)?

  var isRunning: Bool { false }

  func capabilities() -> [String: Any] {
    [
      "available": false,
      "reason": "simulator",
      "hasLidar": false,
      "supportsHighResCapture": false,
      "deviceModel": "simulator",
      "osVersion": UIDevice.current.systemVersion,
    ]
  }

  func invalidateCapabilities() {}

  func start(options: ARTrackStartOptions) throws { throw Exceptions.ArSimulator() }
  func stop() {}
  func poseSnapshot() -> [String: Any] { ["available": false, "reason": "simulator"] }
  func setOrigin() throws -> [String: Any] { throw Exceptions.ArSimulator() }
  func markPoint(label: String?) throws -> [String: Any] { throw Exceptions.ArSimulator() }
  func trackSummary() throws -> [String: Any] { throw Exceptions.ArSimulator() }
  func exportTrack() throws -> [String: Any] { throw Exceptions.ArSimulator() }
  func raycast(options: ARTrackRaycastOptions) throws -> [String: Any] { throw Exceptions.ArSimulator() }
  func captureFrame(completion: @escaping (Result<[String: Any], Exception>) -> Void) {
    completion(.failure(Exceptions.ArSimulator()))
  }
}

#endif
