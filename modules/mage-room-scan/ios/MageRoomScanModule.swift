// MageRoomScanModule.swift — the JS surface of Scan The Room. Two calls.
//
//   getCapabilities()  synchronous. Says whether THIS phone can scan and, when
//                      it cannot, which of the reasons applies. Never touches
//                      RoomPlan on iOS 15 or on the simulator.
//   startScan(options) presents Apple's own scanner full screen and resolves
//                      when the person finishes or cancels.
//
// WHAT COMES BACK IS APPLE'S JSON, UNTOUCHED. CapturedRoom is Codable; it is
// encoded with JSONEncoder and handed over as a string. Nothing is mapped or
// rounded in Swift. All geometry lives in TypeScript (utils/roomScan), where
// it is tested without a phone and can be fixed over the air.
//
// NO CAMERA PROMPT HERE. Like modules/mage-ar-track, the module reads the
// permission and refuses with a typed error; JS raises the prompt through
// expo-image-picker, which already owns this app's camera permission story.
//
// NOT IN THIS MODULE (the build plan lists them for the same native build;
// they are not written yet): joining rooms (StructureBuilder, iOS 17), drawing
// a plan image, Quick Look preview of the USDZ, saving an ARWorldMap.

import ExpoModulesCore
import AVFoundation
import UIKit

public class MageRoomScanModule: Module {
  /// True while the scanner is on screen. Main queue only.
  private var scanning = false

  public func definition() -> ModuleDefinition {
    Name("MageRoomScan")

    /// { linked, supported, reason, multiRoom, osVersion, deviceModel }
    /// `reason` is "ok" | "simulator" | "osTooOld" | "noLidar" |
    /// "cameraDenied" | "cameraUndetermined".
    Function("getCapabilities") { () -> [String: Any] in
      RoomScanSupport.capabilities()
    }

    AsyncFunction("startScan") { (options: RoomScanStartOptions, promise: Promise) in
      #if targetEnvironment(simulator)
      promise.reject(Exceptions.RoomScanSimulator())
      #else
      guard #available(iOS 16.0, *) else {
        promise.reject(Exceptions.RoomScanOsTooOld())
        return
      }
      guard RoomScanSupport.isSupported() else {
        promise.reject(Exceptions.RoomScanUnsupportedDevice())
        return
      }
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: break
      case .notDetermined:
        promise.reject(Exceptions.RoomScanCameraUndetermined())
        return
      default:
        promise.reject(Exceptions.RoomScanCameraDenied())
        return
      }
      if self.scanning {
        promise.reject(Exceptions.RoomScanAlreadyRunning())
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(Exceptions.RoomScanNoPresenter())
        return
      }
      self.scanning = true
      // The module lives as long as the app does, so the strong `self` the
      // outer closure already holds is used here too.
      // The promise settles exactly once: `present` promises one call, and
      // this guard holds even if a future change breaks that promise.
      var settled = false
      RoomScanSupport.present(from: presenter, options: options) { result in
        if settled { return }
        settled = true
        self.scanning = false
        switch result {
        case .success(let payload): promise.resolve(payload)
        case .failure(let error): promise.reject(error)
        }
      }
      #endif
    }
    .runOnQueue(.main)
  }
}
