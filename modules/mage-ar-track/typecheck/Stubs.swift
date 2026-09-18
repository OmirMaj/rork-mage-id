// Stubs.swift — just enough of ExpoModulesCore, UIKit and ARKit for `swiftc
// -typecheck` to check ARTrackSession.swift + ARTrackTypes.swift on a Mac with
// only the Command Line Tools (no Xcode, no iOS SDK, no simulator).
//
// WHY THIS EXISTS. `modules/` autolinks into EVERY iOS prebuild. A Swift
// compile error in this module therefore breaks every iOS EAS build — AR or not
// — and nothing else in the repo compiles Swift before EAS does. The first
// draft of this module shipped exactly that (an internal func whose signature
// named a private type). scripts/validate-ar-spike.ts copies the two real files
// next to this one with their iOS-only imports removed and typechecks BOTH
// slices (device, and simulator via `#if false`) whenever a swiftc and a macOS
// SDK are present.
//
// NOT COMPILED INTO THE APP: this folder sits beside ios/, and the podspec's
// `source_files` glob is relative to ios/. Keep it that way.
//
// A stub is a claim about Apple's / Expo's API. Each one below mirrors the real
// signature the module calls; if a call site stops matching the real API, EAS
// is still the final word — this catches the class of error that does not
// depend on the SDK at all (access control, typos, optionality, missing cases).

import Foundation
import simd
import CoreImage
import AVFoundation

// Per-file imports do not cross files; these make CoreImage visible to the
// session file the way UIKit's umbrella does on iOS.
typealias CIImage = CoreImage.CIImage
typealias CIContext = CoreImage.CIContext

// ── ExpoModulesCore (node_modules/expo-modules-core/ios/Core/Exceptions) ────
open class Exception: Error {
  public init() {}
  open var code: String { "ERR" }
  open var reason: String { "" }
}
open class GenericException<ParamType>: Exception {
  public let param: ParamType
  public init(_ param: ParamType) { self.param = param; super.init() }
}
public struct Exceptions {}
public protocol Record { init() }
@propertyWrapper public struct Field<T> {
  public var wrappedValue: T
  public init(wrappedValue: T) { self.wrappedValue = wrappedValue }
}

// ── UIKit ───────────────────────────────────────────────────────────────────
final class UIDevice {
  static let current = UIDevice()
  var systemVersion = "17.0"
  var model = "iPhone"
}
final class UIImage {
  init(cgImage: CGImage) {}
  func jpegData(compressionQuality: CGFloat) -> Data? { nil }
}

// ── ARKit ───────────────────────────────────────────────────────────────────
class ARConfiguration {
  class VideoFormat {}
  struct FrameSemantics: OptionSet {
    let rawValue: Int
    static let sceneDepth = FrameSemantics(rawValue: 1)
  }
  enum WorldAlignment { case gravity, gravityAndHeading, camera }
  class var isSupported: Bool { true }
  class func supportsFrameSemantics(_ f: FrameSemantics) -> Bool { true }
  var frameSemantics: FrameSemantics = []
  var worldAlignment: WorldAlignment = .gravity
  var videoFormat = VideoFormat()
}
class ARWorldTrackingConfiguration: ARConfiguration {
  struct PlaneDetection: OptionSet {
    let rawValue: Int
    static let horizontal = PlaneDetection(rawValue: 1)
    static let vertical = PlaneDetection(rawValue: 2)
  }
  enum EnvironmentTexturing { case none, manual, automatic }
  var planeDetection: PlaneDetection = []
  var environmentTexturing: EnvironmentTexturing = .none
  @available(macOS 13.0, iOS 16.0, *)
  class var recommendedVideoFormatForHighResolutionFrameCapturing: VideoFormat? { nil }
}
struct ARPointCloud { var points: [SIMD3<Float>] }
struct ARLightEstimate { var ambientIntensity: CGFloat }
class ARCamera {
  enum TrackingState {
    case notAvailable, limited(Reason), normal
    enum Reason { case initializing, excessiveMotion, insufficientFeatures, relocalizing }
  }
  var trackingState: TrackingState = .normal
  var transform = simd_float4x4()
}
struct ARRaycastQuery {
  enum Target { case existingPlaneGeometry, existingPlaneInfinite, estimatedPlane }
  enum TargetAlignment { case horizontal, vertical, any }
}
class ARRaycastResult {
  var worldTransform = simd_float4x4()
  var targetAlignment: ARRaycastQuery.TargetAlignment = .any
}
class ARFrame {
  enum WorldMappingStatus { case notAvailable, limited, extending, mapped }
  var camera = ARCamera()
  var timestamp: TimeInterval = 0
  var rawFeaturePoints: ARPointCloud?
  var worldMappingStatus: WorldMappingStatus = .mapped
  var lightEstimate: ARLightEstimate?
  var capturedImage: CVPixelBuffer { fatalError("stub") }
  func raycastQuery(from: CGPoint, allowing: ARRaycastQuery.Target, alignment: ARRaycastQuery.TargetAlignment) -> ARRaycastQuery { ARRaycastQuery() }
}
protocol ARSessionDelegate: AnyObject {}
class ARSession {
  struct RunOptions: OptionSet {
    let rawValue: Int
    static let resetTracking = RunOptions(rawValue: 1)
    static let removeExistingAnchors = RunOptions(rawValue: 2)
  }
  weak var delegate: ARSessionDelegate?
  var delegateQueue: DispatchQueue?
  var currentFrame: ARFrame?
  func run(_ c: ARConfiguration, options: RunOptions) {}
  func pause() {}
  func raycast(_ q: ARRaycastQuery) -> [ARRaycastResult] { [] }
  @available(macOS 13.0, iOS 16.0, *)
  func captureHighResolutionFrame(completion: @escaping (ARFrame?, Error?) -> Void) {}
}
