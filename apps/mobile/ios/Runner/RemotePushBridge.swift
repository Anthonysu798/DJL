import Flutter
import UIKit
import UserNotifications

final class RemotePushBridge {
  private let inbox = RemotePushInbox()
  private var channel: FlutterMethodChannel?
  private var token: String?
  private var failed = false
  private var acceptingToken = false
  private var generation = 0

  func attach(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "djl.mobile/remote-push", binaryMessenger: messenger)
    self.channel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else { result(nil); return }
      switch call.method {
      case "status": self.status(result)
      case "initialTap": result(self.inbox.initial())
      case "ack":
        if let id = call.arguments as? String { self.inbox.acknowledge(id) }
        result(nil)
      case "clearToken":
        self.generation += 1
        self.acceptingToken = false
        self.token = nil
        self.failed = false
        result(nil)
      case "enable": self.enable(result)
      case "register": self.register(result)
      default: result(FlutterMethodNotImplemented)
      }
    }
  }
  private var environment: String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: "DJLAPNsEnvironment") as? String,
      ["development", "production"].contains(value) else { return nil }
    return value
  }
  private var availability: String {
    #if targetEnvironment(simulator)
    return "simulator"
    #else
    guard Bundle.main.object(forInfoDictionaryKey: "DJLRemotePushEnabled") as? String == "YES" else { return "disabled" }
    guard environment != nil else { return "unconfigured" }
    return failed ? "failed" : "ready"
    #endif
  }
  private func permission(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .provisional: return "provisional"
    case .ephemeral: return "ephemeral"
    case .denied: return "denied"
    default: return "notDetermined"
    }
  }
  private func status(_ result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      DispatchQueue.main.async {
        guard let self else { result(nil); return }
        var value: [String: Any] = ["availability": self.availability, "permission": self.permission(settings.authorizationStatus)]
        if let environment = self.environment { value["environment"] = environment }
        if let token = self.token, self.availability == "ready" { value["token"] = token }
        result(value)
      }
    }
  }
  private func enable(_ result: @escaping FlutterResult) {
    guard availability == "ready" else { status(result); return }
    let captured = generation
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] _, error in
      DispatchQueue.main.async {
        guard let self else { result(nil); return }
        guard self.generation == captured else { self.status(result); return }
        if error != nil { self.failed = true; self.status(result); return }
        self.register(result)
      }
    }
  }
  private func register(_ result: @escaping FlutterResult) {
    // Explicit retry may recover a previous OS failure; flags remain authoritative.
    failed = false
    guard availability == "ready" else { status(result); return }
    let captured = generation
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      DispatchQueue.main.async {
        guard let self else { result(nil); return }
        guard captured == self.generation, ["authorized", "provisional", "ephemeral"].contains(self.permission(settings.authorizationStatus)) else { self.status(result); return }
        self.acceptingToken = true
        UIApplication.shared.registerForRemoteNotifications()
        self.status(result)
      }
    }
  }
  func registered(_ data: Data) {
    guard acceptingToken, availability == "ready", (16...100).contains(data.count) else { return }
    token = data.map { String(format: "%02x", $0) }.joined()
    failed = false
    emitState()
  }
  func registrationFailed() {
    guard acceptingToken else { return }
    acceptingToken = false
    token = nil
    failed = true
    emitState()
  }
  private func emitState() {
    status { [weak self] value in self?.channel?.invokeMethod("state", arguments: value) }
  }
  func receive(_ response: UNNotificationResponse) {
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let value = inbox.receive(response.notification.request.content.userInfo) else { return }
    channel?.invokeMethod("tap", arguments: value)
  }
}
