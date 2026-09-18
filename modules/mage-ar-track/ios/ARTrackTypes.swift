// ARTrackTypes.swift — the option records and the typed errors.
//
// WHY TYPED ERRORS. Every one of these states is a DIFFERENT sentence on the
// dev screen ("the simulator has no camera", "this build has no AR module",
// "camera access is off"), and a JS layer that has to regex an English message
// to tell them apart will get it wrong the first time Apple rewords one. Each
// exception below carries a stable `code`; utils/arTrack/native.ts switches on
// the code and nothing else.

import ExpoModulesCore

// MARK: - Options

/// Options for `start`. Every field is opt-in and defaults to the cheapest,
/// most widely supported configuration, because the measurement trial must run
/// identically on a non-Pro iPhone.
internal struct ARTrackStartOptions: Record {
  /// How often `onSample` fires, in Hz. ARKit delivers frames at ~60 Hz; the
  /// delegate integrates path length at the FULL rate and only the event is
  /// decimated, so lowering this never changes the measured distance.
  @Field var hz: Double = 5.0

  /// Ask for LiDAR depth. Ignored unless the device reports
  /// `supportsFrameSemantics(.sceneDepth)` — setting an unsupported frame
  /// semantic is a programmer error that traps, so it is never set blind.
  @Field var sceneDepth: Bool = false

  /// Prefer a video format suited to high-resolution still capture (iOS 16+).
  /// Only worth paying for when the caller intends to call `captureFrame`.
  @Field var highResCapture: Bool = false
}

/// Options for `raycast`. The default point is the screen centre on purpose:
/// the image centre maps to the screen centre under EVERY interface
/// orientation, so the spike needs no `displayTransform` work to be correct.
internal struct ARTrackRaycastOptions: Record {
  /// Normalised UI coordinate, 0 = top-left, 1 = bottom-right.
  @Field var x: Double = 0.5
  @Field var y: Double = 0.5
  /// "existingPlaneGeometry" | "estimatedPlane". The module tries the stricter
  /// one first and REPORTS which one answered — they are different qualities of
  /// answer and the screen has to be able to say which one it got.
  @Field var allowing: String = "estimatedPlane"
  /// "any" | "horizontal" | "vertical".
  @Field var alignment: String = "any"
}

// MARK: - Typed errors

internal extension Exceptions {
  /// `ARWorldTrackingConfiguration.isSupported` is false on this device.
  final class ArUnavailable: Exception {
    override var code: String { "E_AR_UNAVAILABLE" }
    override var reason: String { "This iPhone does not support ARKit world tracking." }
  }

  /// Compiled-out path: the simulator has no camera and no motion sensors.
  final class ArSimulator: Exception {
    override var code: String { "E_AR_SIMULATOR" }
    override var reason: String { "ARKit only runs on a real iPhone — the simulator has no camera or motion sensors." }
  }

  /// Camera access was refused. The module never raises the prompt itself
  /// (see MageArTrackModule.swift), so this is terminal until the user changes
  /// it in Settings.
  final class ArCameraDenied: Exception {
    override var code: String { "E_AR_CAMERA_DENIED" }
    override var reason: String { "Camera access is off for MAGE ID, so AR tracking cannot start." }
  }

  /// Camera access has never been asked for. JS raises the prompt (through
  /// expo-image-picker, which already owns this app's camera permission story)
  /// and calls `start` again.
  final class ArCameraUndetermined: Exception {
    override var code: String { "E_AR_CAMERA_UNDETERMINED" }
    override var reason: String { "Camera access has not been granted yet." }
  }

  /// `start` has not been called, or `stop` already ran.
  final class ArNotRunning: Exception {
    override var code: String { "E_AR_NOT_RUNNING" }
    override var reason: String { "The AR session is not running." }
  }

  /// `setOrigin` has not been called, so there is nothing to measure from.
  final class ArNoOrigin: Exception {
    override var code: String { "E_AR_NO_ORIGIN" }
    override var reason: String { "No origin has been set — stand where you want zero and set it first." }
  }

  /// A frame exists but ARKit is not tracking well enough to answer. Returning
  /// a position anyway is the one thing this module must never do.
  final class ArNotTracking: Exception {
    override var code: String { "E_AR_NOT_TRACKING" }
    override var reason: String { "ARKit is not tracking right now, so there is no position to report." }
  }

  /// `captureHighResolutionFrame` is iOS 16+. On 15.x this is thrown rather
  /// than quietly handing back a low-resolution frame that looks the same in a
  /// file name and is not.
  final class ArHighResUnsupported: Exception {
    override var code: String { "E_AR_HIGHRES_UNSUPPORTED" }
    override var reason: String { "High-resolution AR capture needs iOS 16 or later." }
  }

  /// Writing the raw track to the cache directory failed.
  final class ArExportFailed: GenericException<String> {
    override var code: String { "E_AR_EXPORT_FAILED" }
    override var reason: String { "Could not write the AR track file: \(param)" }
  }
}
