// RoomScanSupport.swift — everything that touches RoomPlan, and nothing else does.
//
// The app's floor is iOS 15.1 and RoomPlan is iOS 16, so:
//   * `import RoomPlan` sits behind `#if canImport(RoomPlan)`,
//   * every type that names a RoomPlan type is `@available(iOS 16.0, *)`,
//   * the simulator slice compiles none of it (no camera, no LiDAR),
//   * the two entry points below (`capabilities`, `present`) are callable on
//     any iOS and answer in words when RoomPlan is not there.
//
// WRITTEN AGAINST APPLE'S DOCUMENTATION, NOT COMPILED AGAINST THE iOS SDK.
// Lines marked UNSURE are the ones to read first when the first build fails;
// docs/scan-the-room-native-checklist.md lists each with what to check.

import ExpoModulesCore
import AVFoundation
import UIKit
#if canImport(RoomPlan) && !targetEnvironment(simulator)
import RoomPlan
#endif

internal enum RoomScanSupport {
  /// LiDAR plus iOS 16. RoomPlan's own answer, the single capability check.
  static func isSupported() -> Bool {
    #if canImport(RoomPlan) && !targetEnvironment(simulator)
    if #available(iOS 16.0, *) {
      return RoomCaptureSession.isSupported
    }
    #endif
    return false
  }

  static func capabilities() -> [String: Any] {
    var reason = "ok"
    var supported = false
    var multiRoom = false
    #if targetEnvironment(simulator)
    reason = "simulator"
    #else
    if #available(iOS 16.0, *) {
      supported = isSupported()
      if #available(iOS 17.0, *) { multiRoom = supported }
      if !supported {
        reason = "noLidar"
      } else {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: reason = "ok"
        case .notDetermined: reason = "cameraUndetermined"
        default: reason = "cameraDenied"
        }
      }
    } else {
      reason = "osTooOld"
    }
    #endif
    return [
      "linked": true,
      "supported": supported,
      "reason": reason,
      "multiRoom": multiRoom,
      "osVersion": UIDevice.current.systemVersion,
      "deviceModel": deviceModel(),
    ]
  }

  static func deviceModel() -> String {
    var info = utsname()
    uname(&info)
    let mirror = Mirror(reflecting: info.machine)
    let id = mirror.children.reduce(into: "") { acc, el in
      guard let value = el.value as? Int8, value != 0 else { return }
      acc.append(Character(UnicodeScalar(UInt8(bitPattern: value))))
    }
    return id.isEmpty ? UIDevice.current.model : id
  }

  /// Show the scanner. `done` is called exactly once, on the main queue.
  static func present(
    from presenter: UIViewController,
    options: RoomScanStartOptions,
    done: @escaping (Result<[String: Any], Exception>) -> Void
  ) {
    #if canImport(RoomPlan) && !targetEnvironment(simulator)
    if #available(iOS 16.0, *) {
      // A navigation bar gives the system's own Cancel and Done buttons, in
      // the phone's language, with no strings carried by this module.
      let nav = UINavigationController(rootViewController: RoomScanViewController(options: options, done: done))
      nav.modalPresentationStyle = .fullScreen
      presenter.present(nav, animated: true)
      return
    }
    #endif
    done(.failure(Exceptions.RoomScanOsTooOld()))
  }
}

#if canImport(RoomPlan) && !targetEnvironment(simulator)

/// Apple's RoomCaptureView under a navigation bar with Cancel and Done.
///
/// The controller is its own RoomCaptureViewDelegate. That protocol inherits
/// from NSCoding (UNSURE: true in the iOS 16 and 17 SDKs; a UIViewController
/// already conforms, which is why the delegate is the controller and not a
/// small helper object).
@available(iOS 16.0, *)
internal final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
  private let options: RoomScanStartOptions
  private var done: ((Result<[String: Any], Exception>) -> Void)?
  private var captureView: RoomCaptureView?
  private var warnings: [String] = []
  private var startedAt = Date()
  private var cancelled = false
  private var running = false

  init(options: RoomScanStartOptions, done: @escaping (Result<[String: Any], Exception>) -> Void) {
    self.options = options
    self.done = done
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    // Never restored from a storyboard or state restoration.
    return nil
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    let capture = RoomCaptureView(frame: view.bounds)
    capture.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    capture.delegate = self
    capture.captureSession.delegate = self
    view.addSubview(capture)
    captureView = capture

    navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped))
    navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(doneTapped))
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !running else { return }
    running = true
    startedAt = Date()
    // The screen must stay awake while the person walks the room.
    UIApplication.shared.isIdleTimerDisabled = true
    captureView?.captureSession.run(configuration: RoomCaptureSession.Configuration())
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    UIApplication.shared.isIdleTimerDisabled = false
    if running {
      // Dismissed some other way while scanning: stop the camera and the AR session.
      running = false
      captureView?.captureSession.stop()
    }
  }

  @objc private func doneTapped() {
    guard running else { return }
    running = false
    navigationItem.rightBarButtonItem?.isEnabled = false
    // stop() makes RoomPlan process what it has. The result arrives in
    // captureView(didPresent:error:) below.
    captureView?.captureSession.stop()
  }

  @objc private func cancelTapped() {
    cancelled = true
    if running {
      running = false
      captureView?.captureSession.stop()
    }
    finish(.success(payload(status: "cancelled", json: "", usdz: nil)))
  }

  // MARK: RoomCaptureSessionDelegate

  func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
    let name: String
    switch instruction {
    case .moveCloseToWall: name = "moveCloseToWall"
    case .moveAwayFromWall: name = "moveAwayFromWall"
    case .slowDown: name = "slowDown"
    case .turnOnLight: name = "turnOnLight"
    case .lowTexture: name = "lowTexture"
    case .normal: return
    @unknown default: name = "other"
    }
    if !warnings.contains(name) { warnings.append(name) }
  }

  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
    // A failed session never reaches captureView(didPresent:), so it is reported here.
    if let error = error, !cancelled {
      DispatchQueue.main.async { self.finish(.failure(Exceptions.RoomScanSessionFailed(error.localizedDescription))) }
    }
  }

  // MARK: RoomCaptureViewDelegate

  /// true: let Apple post-process the scan and show the finished model.
  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    return error == nil && !cancelled
  }

  /// The finished room. Encode it as it is and hand it over.
  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    if cancelled { return }
    if let error = error {
      finish(.failure(Exceptions.RoomScanSessionFailed(error.localizedDescription)))
      return
    }
    let json: String
    do {
      let data = try JSONEncoder().encode(processedResult)
      json = String(data: data, encoding: .utf8) ?? ""
    } catch {
      finish(.failure(Exceptions.RoomScanEncodeFailed(error.localizedDescription)))
      return
    }
    if json.isEmpty {
      finish(.failure(Exceptions.RoomScanEncodeFailed("empty")))
      return
    }
    var usdz: String? = nil
    if options.exportUsdz {
      // Optional. A failed export is a warning, never a failed scan: the JSON is the record.
      let safeId = options.scanId.filter { $0.isLetter || $0.isNumber || $0 == "-" }
      let name = "room-scan-" + (safeId.isEmpty ? UUID().uuidString : safeId) + ".usdz"
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      do {
        try? FileManager.default.removeItem(at: url)
        try processedResult.export(to: url, exportOptions: .parametric)
        usdz = url.absoluteString
      } catch {
        warnings.append("usdzExportFailed")
      }
    }
    finish(.success(payload(status: "done", json: json, usdz: usdz)))
  }

  // MARK: -

  private func payload(status: String, json: String, usdz: String?) -> [String: Any] {
    let iso = ISO8601DateFormatter()
    return [
      "status": status,
      "capturedRoomJson": json,
      "usdzUri": usdz.map { $0 as Any } ?? NSNull(),
      "startedAt": iso.string(from: startedAt),
      "endedAt": iso.string(from: Date()),
      "roomPlanSdk": UIDevice.current.systemVersion,
      "deviceModel": RoomScanSupport.deviceModel(),
      "warnings": warnings,
    ]
  }

  /// Resolve once, then leave the screen.
  private func finish(_ result: Result<[String: Any], Exception>) {
    guard let done = done else { return }
    self.done = nil
    UIApplication.shared.isIdleTimerDisabled = false
    (navigationController ?? self).dismiss(animated: true) { done(result) }
  }
}

#endif
