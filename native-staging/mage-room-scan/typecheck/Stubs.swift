// Stubs.swift — just enough of ExpoModulesCore, UIKit and RoomPlan for
// `swiftc -typecheck` to check the three files in ../ios on a Mac with only
// the Command Line Tools (no Xcode, no iOS SDK). Same trick, and the same
// reason, as modules/mage-ar-track/typecheck/Stubs.swift: `modules/` autolinks
// into EVERY iOS build, so a Swift error here breaks every build, and nothing
// else in the repo compiles Swift before EAS does.
//
// scripts/validate-scan-room.ts copies the real files next to this one with
// their iOS-only imports removed, and typechecks the device slice and the
// "RoomPlan is not there" slice.
//
// A STUB IS A CLAIM ABOUT APPLE'S API, NOT A CHECK OF IT. Each one mirrors the
// signature the module calls as Apple documents it. It catches typos, access
// control and optionality. It cannot catch a RoomPlan signature this file has
// wrong. EAS and a real phone are the final word.
//
// NOT COMPILED INTO THE APP: this folder sits beside ios/, and the podspec's
// source_files glob is relative to ios/.

import Foundation
import AVFoundation

// ── ExpoModulesCore ─────────────────────────────────────────────────────────
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
public final class Promise {
  public func resolve(_ value: Any?) {}
  public func reject(_ error: Exception) {}
}
public final class AppUtilities {
  public func currentViewController() -> UIViewController? { nil }
}
public final class AppContext { public var utilities: AppUtilities? }
public protocol AnyDefinition {}
public struct ModuleDefinition {}
public struct NameDefinition: AnyDefinition {}
public final class FunctionDefinition: AnyDefinition {
  public enum Queue { case main }
  @discardableResult public func runOnQueue(_ q: Queue) -> FunctionDefinition { self }
}
@resultBuilder public struct DefinitionBuilder {
  public static func buildBlock(_ parts: AnyDefinition...) -> ModuleDefinition { ModuleDefinition() }
}
public func Name(_ name: String) -> AnyDefinition { NameDefinition() }
public func Function<R>(_ name: String, _ body: @escaping () -> R) -> AnyDefinition { FunctionDefinition() }
public func AsyncFunction<A>(_ name: String, _ body: @escaping (A, Promise) -> Void) -> FunctionDefinition { FunctionDefinition() }
open class Module {
  public init() {}
  public var appContext: AppContext?
}
public extension Module {
  typealias Definition = ModuleDefinition
}

// ── UIKit ───────────────────────────────────────────────────────────────────
public final class UIDevice {
  public static let current = UIDevice()
  public var systemVersion = "17.0"
  public var model = "iPhone"
}
public struct UIColor { public static let black = UIColor() }
public struct UIViewAutoresizing: OptionSet {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }
  public static let flexibleWidth = UIViewAutoresizing(rawValue: 1)
  public static let flexibleHeight = UIViewAutoresizing(rawValue: 2)
}
open class UIView: NSObject {
  public var bounds = CGRect.zero
  public var backgroundColor: UIColor?
  public var autoresizingMask: UIViewAutoresizing = []
  public init(frame: CGRect) { super.init() }
  public func addSubview(_ v: UIView) {}
  public var window: UIView? { nil }
}
public final class UIBarButtonItem: NSObject {
  public enum SystemItem { case done, cancel }
  public var isEnabled = true
  public init(barButtonSystemItem: SystemItem, target: Any?, action: Selector?) { super.init() }
}
public final class UINavigationItem {
  public var leftBarButtonItem: UIBarButtonItem?
  public var rightBarButtonItem: UIBarButtonItem?
}
public enum UIModalPresentationStyle { case fullScreen }
open class UIViewController: NSObject, NSCoding {
  public var view = UIView(frame: .zero)
  public let navigationItem = UINavigationItem()
  public var navigationController: UINavigationController? { nil }
  public var presentedViewController: UIViewController? { nil }
  public var presentingViewController: UIViewController? { nil }
  public var viewIfLoaded: UIView? { nil }
  public var isBeingDismissed: Bool { false }
  public var modalPresentationStyle: UIModalPresentationStyle = .fullScreen
  public init(nibName: String?, bundle: Bundle?) { super.init() }
  public required init?(coder: NSCoder) { super.init() }
  public func encode(with coder: NSCoder) {}
  open func viewDidLoad() {}
  open func viewDidAppear(_ animated: Bool) {}
  open func viewWillDisappear(_ animated: Bool) {}
  public func present(_ vc: UIViewController, animated: Bool, completion: (() -> Void)? = nil) {}
  public func dismiss(animated: Bool, completion: (() -> Void)? = nil) {}
}
open class UINavigationController: UIViewController {
  public init(rootViewController: UIViewController) { super.init(nibName: nil, bundle: nil) }
  public required init?(coder: NSCoder) { super.init(coder: coder) }
}
public final class UIApplication {
  public static let shared = UIApplication()
  public var isIdleTimerDisabled = false
}

// ── RoomPlan (iOS 16) ───────────────────────────────────────────────────────
@available(macOS 13.0, iOS 16.0, *)
public struct CapturedRoomData {}
@available(macOS 13.0, iOS 16.0, *)
public struct CapturedRoom: Encodable {
  public struct USDExportOptions: OptionSet {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let mesh = USDExportOptions(rawValue: 1)
    public static let parametric = USDExportOptions(rawValue: 2)
  }
  public func export(to url: URL, exportOptions: USDExportOptions = .mesh) throws {}
}
@available(macOS 13.0, iOS 16.0, *)
public protocol RoomCaptureSessionDelegate: AnyObject {
  func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction)
  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?)
}
@available(macOS 13.0, iOS 16.0, *)
public final class RoomCaptureSession {
  public struct Configuration { public init() {} }
  public enum Instruction { case moveCloseToWall, moveAwayFromWall, slowDown, turnOnLight, normal, lowTexture }
  public static var isSupported: Bool { false }
  public weak var delegate: RoomCaptureSessionDelegate?
  public func run(configuration: Configuration) {}
  public func stop() {}
}
@available(macOS 13.0, iOS 16.0, *)
public protocol RoomCaptureViewDelegate: NSCoding {
  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool
  func captureView(didPresent processedResult: CapturedRoom, error: Error?)
}
@available(macOS 13.0, iOS 16.0, *)
public final class RoomCaptureView: UIView {
  public let captureSession = RoomCaptureSession()
  public weak var delegate: RoomCaptureViewDelegate?
}
