import Flutter
import UIKit

@objc(DJLGlassViewFactory)
final class DJLGlassViewFactory: NSObject, FlutterPlatformViewFactory {
  func create(
    withFrame frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?
  ) -> FlutterPlatformView {
    DJLGlassPlatformView(frame: frame, arguments: args)
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}

private final class DJLGlassPlatformView: NSObject, FlutterPlatformView {
  private let surface: UIVisualEffectView

  init(frame: CGRect, arguments: Any?) {
    let values = arguments as? [String: Any] ?? [:]
    let enabled = values["enabled"] as? Bool ?? true
    let dark = values["dark"] as? Bool ?? false
    let radius = CGFloat((values["radius"] as? NSNumber)?.doubleValue ?? 26)
    let effect: UIVisualEffect
    let nativeGlass: Bool
    if #available(iOS 26.0, *), enabled {
      let glass = UIGlassEffect(style: .regular)
      glass.isInteractive = false
      effect = glass
      nativeGlass = true
    } else {
      effect = UIBlurEffect(style: .systemThinMaterial)
      nativeGlass = false
    }
    surface = DJLGlassEffectView(effect: effect)
    super.init()
    surface.frame = frame
    surface.overrideUserInterfaceStyle = dark ? .dark : .light
    surface.backgroundColor = .clear
    surface.layer.cornerRadius = radius
    surface.layer.cornerCurve = .continuous
    if #available(iOS 26.0, *) {
      surface.cornerConfiguration = .uniformCorners(radius: .fixed(radius))
    }
    surface.clipsToBounds = !nativeGlass
    surface.isUserInteractionEnabled = false
    surface.isAccessibilityElement = false
    surface.accessibilityElementsHidden = true
  }

  func view() -> UIView { surface }
}

private final class DJLGlassEffectView: UIVisualEffectView {
  override init(effect: UIVisualEffect?) {
    super.init(effect: effect)
    observeActivity()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    observeActivity()
  }

  private func observeActivity() {
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(hideForInactivity(_:)),
                       name: UIApplication.willResignActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(restoreOnActivation(_:)),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
    isHidden = UIApplication.shared.applicationState != .active
  }

  @objc private func hideForInactivity(_ notification: Notification) {
    isHidden = true
  }

  @objc private func restoreOnActivation(_ notification: Notification) {
    isHidden = false
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }
}
