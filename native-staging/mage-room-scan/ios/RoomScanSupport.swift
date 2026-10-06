// RoomScanSupport.swift — everything that touches RoomPlan, and nothing else does.
//
// The app's floor is iOS 15.1 and RoomPlan is iOS 16, so:
//   * `import RoomPlan` sits behind `#if canImport(RoomPlan)`,
//   * every type that names a RoomPlan type is `@available(iOS 16.0, *)`,
//   * the simulator slice compiles none of it (no camera, no LiDAR),
//   * the two entry points below (`capabilities`, `present`) are callable on
//     any iOS and answer in words when RoomPlan is not there.
//
// TYPECHECKED AGAINST APPLE'S iOS SDK (iPhoneOS 27.0, deployment target 15.1,
// and the simulator SDK) by scripts/validate-scan-room.ts on a Mac with Xcode,
// with only ExpoModulesCore stubbed. NEVER LINKED INTO AN APP AND NEVER RUN ON
// A PHONE. What is still open is behaviour, not spelling;
// docs/scan-the-room-native-checklist.md lists each line with what to check.

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

  /// Show the scanner. `done` is called exactly once, on the main queue,
  /// on every path: the scan finished, it was cancelled, it failed, the
  /// scanner was taken off the screen from outside, or it never got on screen.
  static func present(
    from presenter: UIViewController,
    options: RoomScanStartOptions,
    done: @escaping (Result<[String: Any], Exception>) -> Void
  ) {
    #if canImport(RoomPlan) && !targetEnvironment(simulator)
    if #available(iOS 16.0, *) {
      // UIKit refuses a second presentation, and one from a controller that is
      // not on screen, with a console line and nothing else. Without this the
      // promise would never settle and the `scanning` guard would stay set.
      guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
        done(.failure(Exceptions.RoomScanNoPresenter()))
        return
      }
      // A navigation bar gives the system's own Cancel and Done buttons, in
      // the phone's language, with no strings carried by this module.
      let scanner = RoomScanViewController(options: options, done: done)
      let nav = UINavigationController(rootViewController: scanner)
      nav.modalPresentationStyle = .fullScreen
      presenter.present(nav, animated: true)
      if nav.presentingViewController == nil {
        // The presentation did not happen. The controller hands its completion
        // back (so it can never fire later) and it is called here, once.
        scanner.abandon()?(.failure(Exceptions.RoomScanNoPresenter()))
      }
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
/// from NSCoding (so the iPhoneOS 27.0 SDK says, and the typecheck against it
/// passes); a UIViewController already conforms, which is why the delegate is
/// the controller and not a small helper object.
///
/// ONE COMPLETION, CALLED ONCE. `done` is taken (set to nil) before it is
/// called, by `take()`, and every path that ends the scan goes through it.
/// All state below is read and written on the main queue only: RoomPlan's
/// delegate calls are moved there before they touch anything.
@available(iOS 16.0, *)
internal final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
  private let options: RoomScanStartOptions
  private var done: ((Result<[String: Any], Exception>) -> Void)?
  private var captureView: RoomCaptureView?
  private var warnings: [String] = []
  private var startedAt = Date()
  private var cancelled = false
  private var running = false
  /// What the idle timer was before the scan, so it goes back to that and not to a guess. nil = not changed by us.
  private var priorIdleTimerDisabled: Bool?

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
    guard !running, done != nil else { return }
    running = true
    startedAt = Date()
    // The screen must stay awake while the person walks the room.
    if priorIdleTimerDisabled == nil { priorIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled }
    UIApplication.shared.isIdleTimerDisabled = true
    captureView?.captureSession.run(configuration: RoomCaptureSession.Configuration())
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    restoreIdleTimer()
    if running {
      // Leaving the screen some other way while scanning: stop the camera and the AR session.
      running = false
      captureView?.captureSession.stop()
    }
    // Taken off the screen from outside (the app dismissed its modals, a
    // deep link replaced the stack) with the completion still pending: that
    // is a cancel. The completion is called directly, because the dismissal
    // is already under way and finish() would start a second one.
    let leaving = isBeingDismissed || (navigationController?.isBeingDismissed ?? false)
    if leaving, let pending = take() {
      cancelled = true
      pending(.success(payload(status: "cancelled", json: "", usdz: nil)))
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
    // RoomPlan does not promise which queue this arrives on.
    onMain { if !self.warnings.contains(name) { self.warnings.append(name) } }
  }

  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
    // A failed session never reaches captureView(didPresent:), so it is reported here.
    guard let error = error else { return }
    let message = error.localizedDescription
    onMain { self.fail(message) }
  }

  // MARK: RoomCaptureViewDelegate

  /// true: let Apple post-process the scan and show the finished model.
  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    if let error = error {
      // Returning false means captureView(didPresent:) never comes. Without
      // this the JS screen would wait for ever on a scan that already failed.
      let message = error.localizedDescription
      onMain { self.fail(message) }
      return false
    }
    return true
  }

  /// The finished room. Encode it as it is and hand it over.
  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    let message = error?.localizedDescription
    onMain { self.deliver(processedResult, errorMessage: message) }
  }

  // MARK: - main queue only below

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }

  /// A session error. Nothing to say when the person already cancelled (the cancel has settled the promise).
  private func fail(_ message: String) {
    if cancelled { return }
    finish(.failure(Exceptions.RoomScanSessionFailed(message)))
  }

  private func deliver(_ processedResult: CapturedRoom, errorMessage: String?) {
    if cancelled || done == nil { return }
    if let errorMessage = errorMessage {
      finish(.failure(Exceptions.RoomScanSessionFailed(errorMessage)))
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

  /// Put the idle timer back to what it was before the scan. Once.
  private func restoreIdleTimer() {
    guard let prior = priorIdleTimerDisabled else { return }
    priorIdleTimerDisabled = nil
    UIApplication.shared.isIdleTimerDisabled = prior
  }

  /// The completion, handed out at most once. After this the controller can settle nothing.
  private func take() -> ((Result<[String: Any], Exception>) -> Void)? {
    let pending = done
    done = nil
    return pending
  }

  /// For a scanner that never got on screen: stop it from ever settling, and give the completion back to the caller.
  func abandon() -> ((Result<[String: Any], Exception>) -> Void)? {
    cancelled = true
    restoreIdleTimer()
    return take()
  }

  /// Settle once, then leave the screen.
  private func finish(_ result: Result<[String: Any], Exception>) {
    guard let pending = take() else { return }
    restoreIdleTimer()
    let top: UIViewController = navigationController ?? self
    if top.presentingViewController == nil {
      // Not on screen (any more): there is no dismissal whose completion would run.
      pending(result)
      return
    }
    top.dismiss(animated: true) { pending(result) }
  }
}

#endif
