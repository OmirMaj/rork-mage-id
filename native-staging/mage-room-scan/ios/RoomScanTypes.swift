// RoomScanTypes.swift — the option record and the typed errors.
//
// Every "no" is a DIFFERENT sentence on the screen (no LiDAR, iOS too old,
// camera refused, a scan already running), so each carries a stable `code`.
// utils/roomScan/native.ts switches on the code and nothing else.

import ExpoModulesCore

internal struct RoomScanStartOptions: Record {
  /// Caller-made id, used for the temp file name. Letters, digits and dashes only are kept.
  @Field var scanId: String = ""
  /// Also write the room as a USDZ file in the temp directory.
  @Field var exportUsdz: Bool = false
}

internal extension Exceptions {
  /// No LiDAR sensor, or RoomPlan says it cannot run on this device.
  final class RoomScanUnsupportedDevice: Exception {
    override var code: String { "E_ROOM_SCAN_UNSUPPORTED_DEVICE" }
    override var reason: String { "This iPhone cannot scan a room. Room scanning needs a LiDAR sensor." }
  }

  /// RoomPlan needs iOS 16.
  final class RoomScanOsTooOld: Exception {
    override var code: String { "E_ROOM_SCAN_OS_TOO_OLD" }
    override var reason: String { "Room scanning needs iOS 16 or later." }
  }

  /// Compiled-out path: the simulator has no camera and no LiDAR.
  final class RoomScanSimulator: Exception {
    override var code: String { "E_ROOM_SCAN_SIMULATOR" }
    override var reason: String { "Room scanning only runs on a real iPhone." }
  }

  final class RoomScanCameraDenied: Exception {
    override var code: String { "E_ROOM_SCAN_CAMERA_DENIED" }
    override var reason: String { "Camera access is off for MAGE ID, so a room scan cannot start." }
  }

  /// Never asked. JS raises the prompt and calls startScan again.
  final class RoomScanCameraUndetermined: Exception {
    override var code: String { "E_ROOM_SCAN_CAMERA_UNDETERMINED" }
    override var reason: String { "Camera access has not been granted yet." }
  }

  final class RoomScanAlreadyRunning: Exception {
    override var code: String { "E_ROOM_SCAN_ALREADY_RUNNING" }
    override var reason: String { "A room scan is already running." }
  }

  /// There is no screen to present the scanner from.
  final class RoomScanNoPresenter: Exception {
    override var code: String { "E_ROOM_SCAN_NO_PRESENTER" }
    override var reason: String { "The scanner could not be shown." }
  }

  /// RoomPlan ended the session with an error, or handed back no room.
  final class RoomScanSessionFailed: GenericException<String> {
    override var code: String { "E_ROOM_SCAN_SESSION_FAILED" }
    override var reason: String { "The room scan stopped: \(param)" }
  }

  /// The room could not be written as JSON.
  final class RoomScanEncodeFailed: GenericException<String> {
    override var code: String { "E_ROOM_SCAN_ENCODE_FAILED" }
    override var reason: String { "The room scan could not be read: \(param)" }
  }
}
