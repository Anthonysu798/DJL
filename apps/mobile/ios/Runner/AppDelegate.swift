import Flutter
import UIKit
import QuickLook
import UserNotifications
import app_links

// app_links 6 forwards warm URLs through the application delegate, but cold
// scene connection URLs need to reach the same plugin before Dart subscribes.
final class DJLSceneLinks: NSObject, FlutterSceneLifeCycleDelegate {
  func route(_ urls: [URL]) -> Bool {
    let links = urls.filter { $0.scheme?.lowercased() == "djl" }
    for url in links { AppLinks.shared.handleLink(url: url) }
    return !links.isEmpty
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions?
  ) -> Bool {
    route(connectionOptions?.urlContexts.map { $0.url } ?? [])
  }
}

/// Shows an attachment with Quick Look, which previews PDFs, Office and iWork
/// files, images and text without leaving the app.
final class DJLFilePreview: NSObject, QLPreviewControllerDataSource {
  static let shared = DJLFilePreview()
  private var item: URL?

  func present(_ url: URL) -> Bool {
    guard QLPreviewController.canPreview(url as QLPreviewItem),
          var top = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow })
            .first?.rootViewController else { return false }
    while let presented = top.presentedViewController { top = presented }
    item = url
    let controller = QLPreviewController()
    controller.dataSource = self
    top.present(controller, animated: true)
    return true
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { item == nil ? 0 : 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    (item ?? URL(fileURLWithPath: "/")) as QLPreviewItem
  }
}

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let remotePushBridge = RemotePushBridge()
  private let sceneLinks = DJLSceneLinks()
  private var runStatusBridge: RunStatusBridge?
  private var socialConfigurationChannel: FlutterMethodChannel?
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    let registry = engineBridge.pluginRegistry
    GeneratedPluginRegistrant.register(with: registry)
    if let registrar = registry.registrar(forPlugin: "DJLSceneLinks") {
      registrar.addSceneDelegate(sceneLinks)
    }
    if let registrar = registry.registrar(forPlugin: "RemotePushBridge") {
      remotePushBridge.attach(messenger: registrar.messenger())
    }
    if let registrar = registry.registrar(forPlugin: "RunStatusBridge") {
      runStatusBridge = RunStatusBridge(messenger: registrar.messenger())
    }
    if let registrar = registry.registrar(forPlugin: "SocialSignInConfiguration") {
      let channel = FlutterMethodChannel(name: "djl.mobile/social-config", binaryMessenger: registrar.messenger())
      channel.setMethodCallHandler { call, result in
        guard call.method == "callbackSchemes" else {
          result(FlutterMethodNotImplemented)
          return
        }
        let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
        result(types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] })
      }
      socialConfigurationChannel = channel
    }
    if let registrar = registry.registrar(forPlugin: "AppInfo") {
      registrar.register(DJLGlassViewFactory(), withId: "djl.mobile/glass")
      let files = FlutterMethodChannel(name: "djl.mobile/files", binaryMessenger: registrar.messenger())
      files.setMethodCallHandler { call, result in
        guard call.method == "open" else {
          result(FlutterMethodNotImplemented)
          return
        }
        guard let path = (call.arguments as? [String: Any])?["path"] as? String else {
          result(FlutterError(code: "invalid_file", message: "Opening a file requires its path.", details: nil))
          return
        }
        result(DJLFilePreview.shared.present(URL(fileURLWithPath: path)))
      }
      let channel = FlutterMethodChannel(name: "djl.mobile/app-info", binaryMessenger: registrar.messenger())
      channel.setMethodCallHandler { call, result in
        switch call.method {
        case "version":
          result(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        case "searchMatches":
          guard let arguments = call.arguments as? [String: Any],
                let titles = arguments["titles"] as? [String],
                let query = arguments["query"] as? String else {
            result(FlutterError(code: "invalid_search", message: "Search requires titles and a query.", details: nil))
            return
          }
          result(titles.indices.filter { query.isEmpty || titles[$0].localizedCaseInsensitiveContains(query) })
        case "relativeDate":
          guard let arguments = call.arguments as? [String: Any],
                let date = (arguments["date"] as? NSNumber)?.doubleValue,
                let reference = (arguments["relativeTo"] as? NSNumber)?.doubleValue,
                date.isFinite, reference.isFinite,
                abs(date) <= 8_640_000_000_000_000,
                abs(reference) <= 8_640_000_000_000_000 else {
            result(FlutterError(code: "invalid_date", message: "Relative dates require UTC milliseconds.", details: nil))
            return
          }
          result(Self.formatRelativeDate(dateMilliseconds: date, relativeToMilliseconds: reference,
            elapsed: arguments["elapsed"] as? Bool == true))
        case "supportsLiquidGlass":
          if #available(iOS 26.0, *) { result(true) }
          else { result(false) }
        case "openNotificationSettings":
          let settingsURL: String
          if #available(iOS 16.0, *) {
            settingsURL = UIApplication.openNotificationSettingsURLString
          } else {
            settingsURL = UIApplication.openSettingsURLString
          }
          guard let url = URL(string: settingsURL) else {
            result(false)
            return
          }
          UIApplication.shared.open(url, options: [:], completionHandler: { result($0) })
        default:
          result(FlutterMethodNotImplemented)
        }
      }
    }
  }

  static func formatRelativeDate(
    dateMilliseconds: Double,
    relativeToMilliseconds: Double,
    locale: Locale = .current,
    elapsed: Bool = false
  ) -> String {
    if elapsed {
      let seconds = abs(relativeToMilliseconds - dateMilliseconds) / 1000
      let formatter = DateComponentsFormatter()
      var calendar = Calendar.current
      calendar.locale = locale
      formatter.calendar = calendar
      formatter.unitsStyle = .short
      formatter.maximumUnitCount = 2
      formatter.zeroFormattingBehavior = seconds < 86400 ? .pad : .default
      formatter.allowedUnits = seconds < 60 ? [.second]
        : seconds < 3600 ? [.minute, .second]
        : seconds < 86400 ? [.hour, .minute] : [.year, .month, .weekOfMonth, .day]
      return formatter.string(from: seconds) ?? ""
    }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    formatter.locale = locale
    return formatter.localizedString(
      for: Date(timeIntervalSince1970: dateMilliseconds / 1000),
      relativeTo: Date(timeIntervalSince1970: relativeToMilliseconds / 1000)
    )
  }

  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    remotePushBridge.registered(deviceToken)
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    remotePushBridge.registrationFailed()
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let once = RemotePushOnce<Void> { _ in completionHandler() }
    remotePushBridge.receive(response)
    super.userNotificationCenter(center, didReceive: response, withCompletionHandler: { once.call(()) })
    once.call(())
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    // Forward plugins while keeping foreground prompt/result content private.
    let once = RemotePushOnce<Void> { _ in completionHandler([]) }
    super.userNotificationCenter(center, willPresent: notification, withCompletionHandler: { _ in once.call(()) })
    once.call(())
  }
}
