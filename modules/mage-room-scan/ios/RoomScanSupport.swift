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
import simd
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
    // The phone was locked or the app left the screen: the camera stops and
    // RoomPlan does not promise a delegate call for it. Without this the
    // promise could wait for ever. See `interrupted` below.
    NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: UIApplication.didEnterBackgroundNotification, object: nil)
    captureView?.captureSession.run(configuration: RoomCaptureSession.Configuration())
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
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

  /// The app went to the background with a scan pending (a lock, the home
  /// gesture, a call taken full screen). The scan is over: say so, once, and
  /// leave the screen without an animation nobody would see. Settled BEFORE the
  /// dismissal, because a dismissal's completion is not promised to run while
  /// the app is in the background.
  @objc private func interrupted() {
    guard !cancelled, let pending = take() else { return }
    cancelled = true
    if running {
      running = false
      captureView?.captureSession.stop()
    }
    restoreIdleTimer()
    pending(.failure(Exceptions.RoomScanInterrupted()))
    let top: UIViewController = navigationController ?? self
    if top.presentingViewController != nil { top.dismiss(animated: false) }
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
    let message = RoomScanViewController.describe(error)
    onMain { self.fail(message) }
  }

  // MARK: RoomCaptureViewDelegate

  /// true: let Apple post-process the scan and show the finished model.
  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    if let error = error {
      // Returning false means captureView(didPresent:) never comes. Without
      // this the JS screen would wait for ever on a scan that already failed.
      let message = RoomScanViewController.describe(error)
      onMain { self.fail(message) }
      return false
    }
    return true
  }

  /// The finished room. Encode it as it is and hand it over.
  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    let message = error.map { RoomScanViewController.describe($0) }
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
    // The counts and the first wall, read from the CapturedRoom itself. They
    // do not pass through JSONEncoder, so they are what the JSON and the
    // TypeScript parser are checked against after the first real scan.
    let summary = RoomScanViewController.summary(of: processedResult)
    // A room that will not encode is still a finished scan: the summary goes
    // back with an empty JSON string and the reason, so the screen can say what
    // the phone saw instead of only "it failed".
    var json = ""
    var encodeError: String? = nil
    do {
      let data = try JSONEncoder().encode(processedResult)
      json = String(data: data, encoding: .utf8) ?? ""
      if json.isEmpty { encodeError = "The encoded room was empty or was not UTF-8 text." }
    } catch {
      encodeError = RoomScanViewController.describe(error)
    }
    var usdz: String? = nil
    if options.exportUsdz && !json.isEmpty {
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
    finish(.success(payload(status: "done", json: json, usdz: usdz, summary: summary, encodeError: encodeError)))
  }

  /// The error's own name (for a RoomPlan CaptureError that is its case, such
  /// as "worldTrackingFailure") and Apple's sentence for it.
  static func describe(_ error: Error) -> String {
    let kind = String(describing: error)
    let text = error.localizedDescription
    return kind == text ? text : kind + ": " + text
  }

  /// Plain numbers only. `floors` and `sections` exist from iOS 17.
  /// `firstWall.transform` is the wall's 4x4 matrix as 16 numbers, column by
  /// column (columns.0 first), the order simd keeps them in.
  static func summary(of room: CapturedRoom) -> [String: Any] {
    var out: [String: Any] = [
      "walls": room.walls.count,
      "doors": room.doors.count,
      "windows": room.windows.count,
      "openings": room.openings.count,
      "objects": room.objects.count,
      "wallDimensions": room.walls.map { [Double($0.dimensions.x), Double($0.dimensions.y), Double($0.dimensions.z)] },
    ]
    if #available(iOS 17.0, *) {
      out["floors"] = room.floors.count
      out["sections"] = room.sections.count
    }
    if let wall = room.walls.first {
      let d = wall.dimensions
      let c = wall.transform.columns
      out["firstWall"] = [
        "dimensions": [Double(d.x), Double(d.y), Double(d.z)],
        "transform": [c.0, c.1, c.2, c.3].flatMap { [Double($0.x), Double($0.y), Double($0.z), Double($0.w)] },
      ] as [String: Any]
    }
    return out
  }

  private func payload(status: String, json: String, usdz: String?, summary: [String: Any]? = nil, encodeError: String? = nil) -> [String: Any] {
    let iso = ISO8601DateFormatter()
    let ended = Date()
    return [
      "summary": summary.map { $0 as Any } ?? NSNull(),
      "encodeError": encodeError.map { $0 as Any } ?? NSNull(),
      "durationSeconds": max(0, ended.timeIntervalSince(startedAt)),
      "status": status,
      "capturedRoomJson": json,
      "usdzUri": usdz.map { $0 as Any } ?? NSNull(),
      "startedAt": iso.string(from: startedAt),
      "endedAt": iso.string(from: ended),
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
