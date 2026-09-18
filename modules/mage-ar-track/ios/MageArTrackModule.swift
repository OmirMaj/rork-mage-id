// MageArTrackModule.swift — the JS surface. The smallest one that can answer
// the founder's question: "if MAGE placed the pin for me, how far off would it
// be, after how long, and does it get worse as I walk?"
//
// WHAT IS DELIBERATELY NOT HERE
//
//   • No renderer, no ARView, no anchors drawn on screen. This is a measurement
//     harness. Anything drawn would be the first thing that anchored the
//     founder's own tap and contaminated the ground truth.
//   • No camera PERMISSION PROMPT. The module reads
//     `AVCaptureDevice.authorizationStatus(for: .video)` and refuses to start
//     with a typed error; JS raises the prompt through expo-image-picker, which
//     is already in the bundle and already owns this app's camera permission
//     story. Two code paths asking for the same TCC key is how permission bugs
//     are born.
//   • No `setWorldOrigin`. See the geometry section of ARTrackSession.swift.
//
// EVERY SESSION-MUTATING CALL RUNS ON THE MAIN QUEUE. ARSession is
// UIKit-adjacent and its lifecycle calls belong there. The two SYNCHRONOUS
// functions (`getCapabilities`, `getPose`) read cached values behind a lock and
// never touch ARKit, because a tap-to-mark must not wait on a queue hop.

import ExpoModulesCore

public class MageArTrackModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MageArTrack")

    Events("onStatusChange", "onSample", "onError")

    OnCreate {
      let s = ARTrackSession.shared
      s.onStatus = { [weak self] payload in self?.sendEvent("onStatusChange", payload) }
      s.onSample = { [weak self] payload in self?.sendEvent("onSample", payload) }
      s.onError = { [weak self] payload in self?.sendEvent("onError", payload) }
    }

    OnDestroy {
      let s = ARTrackSession.shared
      s.stop()
      s.onStatus = nil
      s.onSample = nil
      s.onError = nil
    }

    // ── Synchronous reads ────────────────────────────────────────────────────

    /// { available, reason, hasLidar, supportsHighResCapture, deviceModel, osVersion }
    ///
    /// `reason` is one of "ok" | "simulator" | "unsupportedDevice" |
    /// "cameraDenied" | "cameraUndetermined". Each is a DIFFERENT sentence on
    /// the dev screen; the JS layer never collapses them into "AR is off".
    Function("getCapabilities") { () -> [String: Any] in
      ARTrackSession.shared.capabilities()
    }

    /// Drop the cached permission answer. Called by JS immediately after it has
    /// raised the camera prompt, so the next `getCapabilities` reflects what the
    /// user just chose rather than what was true when the screen mounted.
    Function("refreshCapabilities") { () -> [String: Any] in
      ARTrackSession.shared.invalidateCapabilities()
      return ARTrackSession.shared.capabilities()
    }

    /// The CACHED latest frame with `ageMs` alongside it, or
    /// `{ available: false, reason }`. Synchronous on purpose.
    Function("getPose") { () -> [String: Any] in
      ARTrackSession.shared.poseSnapshot()
    }

    // ── Session mutation ─────────────────────────────────────────────────────

    AsyncFunction("start") { (options: ARTrackStartOptions) in
      try ARTrackSession.shared.start(options: options)
    }
    .runOnQueue(.main)

    AsyncFunction("stop") {
      ARTrackSession.shared.stop()
    }
    .runOnQueue(.main)

    /// "Zero is here, facing this way." Stores the current translation and the
    /// lens heading; every later position is reported relative to both, AND
    /// keeps its raw ARKit-world translation so the maths can be redone offline.
    AsyncFunction("setOrigin") { () -> [String: Any] in
      try ARTrackSession.shared.setOrigin()
    }
    .runOnQueue(.main)

    /// The camera position at the latest frame, with trust, epoch and the frame
    /// timestamp. This is the phone's position — NOT the defect's. The defect
    /// needs `raycast`.
    AsyncFunction("markPoint") { (label: String?) -> [String: Any] in
      try ARTrackSession.shared.markPoint(label: label)
    }
    .runOnQueue(.main)

    /// Ray from a normalised screen point (default: dead centre) to the first
    /// real-world surface. A miss returns `hit: false` — never a point at a
    /// guessed distance — and a hit says which kind of surface answered.
    AsyncFunction("raycast") { (options: ARTrackRaycastOptions) -> [String: Any] in
      try ARTrackSession.shared.raycast(options: options)
    }
    .runOnQueue(.main)

    /// A still taken THROUGH the AR session (iOS 16+). The system camera cannot
    /// be used while a session runs — a session is interrupted the moment it
    /// stops receiving camera or motion data, which would end the tracking being
    /// measured. On iOS 15.x this throws E_AR_HIGHRES_UNSUPPORTED rather than
    /// quietly handing back a low-resolution frame.
    AsyncFunction("captureFrame") { (promise: Promise) in
      ARTrackSession.shared.captureFrame { result in
        switch result {
        case .success(let payload): promise.resolve(payload)
        case .failure(let error): promise.reject(error)
        }
      }
    }
    .runOnQueue(.main)

    // ── Track ────────────────────────────────────────────────────────────────

    AsyncFunction("getTrack") { () -> [String: Any] in
      try ARTrackSession.shared.trackSummary()
    }

    /// Every raw sample as NDJSON in the cache directory. The analysis re-derives
    /// alignment, misses and drift rates from this file; nothing the app printed
    /// live is treated as a measurement.
    AsyncFunction("exportTrack") { () -> [String: Any] in
      try ARTrackSession.shared.exportTrack()
    }
  }
}
