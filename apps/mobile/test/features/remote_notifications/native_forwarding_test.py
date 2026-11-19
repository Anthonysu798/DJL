"""Host-only Swift harness: execute the shipping AppDelegate wrappers against API stubs.

This verifies forwarding/completion composition, not UIKit linkage or APNs delivery.
Actual platform compilation and device acceptance remain separate checks.
"""
from pathlib import Path
import re
import subprocess
import tempfile

mobile = Path(__file__).resolve().parents[3]
source = (mobile / 'ios/Runner/AppDelegate.swift').read_text()
# Compile the five notification lifecycle wrappers verbatim. Scene-link and
# engine-registration APIs have their own native tests and require UIKit.
methods = []
for match in re.finditer(r'  override func (?:application|userNotificationCenter)\(', source):
    body = source.index('{', match.start())
    depth = 1
    end = body + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    methods.append(source[match.start():end])
assert len(methods) == 5, 'Update the explicit notification wrapper selection.'
for signature in ['didFinishLaunchingWithOptions', 'didRegisterForRemoteNotificationsWithDeviceToken',
                  'didFailToRegisterForRemoteNotificationsWithError', 'didReceive response:', 'willPresent notification:']:
    assert sum(signature in method for method in methods) == 1, signature
source = 'class AppDelegate: FlutterAppDelegate {\nprivate let remotePushBridge = RemotePushBridge()\n' + '\n'.join(methods) + '\n}'
stubs = r'''
import Foundation
typealias FlutterResult = (Any?) -> Void
let FlutterMethodNotImplemented = "unimplemented"
class FlutterMethodCall { var method = "" }
class Messenger {}
class Registrar { func messenger() -> Messenger { Messenger() } }
class FlutterMethodChannel {
  init(name: String, binaryMessenger: Messenger) {}
  func setMethodCallHandler(_ handler: @escaping (FlutterMethodCall, @escaping FlutterResult) -> Void) {}
}
class GeneratedPluginRegistrant { static func register(with: FlutterAppDelegate) {} }
class RunStatusBridge { init(messenger: Messenger) {} }
class RemotePushBridge {
  func attach(messenger: Messenger) {}
  func registered(_ data: Data) {}
  func registrationFailed() {}
  func receive(_ response: UNNotificationResponse) {}
}
class UIApplication { enum LaunchOptionsKey: Hashable { case notification } }
class UNNotification {}
class UNNotificationResponse {}
struct UNNotificationPresentationOptions: OptionSet {
  let rawValue: Int
  static let alert = UNNotificationPresentationOptions(rawValue: 1)
}
class UNUserNotificationCenter {
  static let instance = UNUserNotificationCenter()
  static func current() -> UNUserNotificationCenter { instance }
  var delegate: AnyObject?
}
class FlutterAppDelegate {
  var tokenForwards = 0, failureForwards = 0, responseForwards = 0, foregroundForwards = 0
  var pluginMode = 0
  var deferred: (() -> Void)?
  func registrar(forPlugin: String) -> Registrar? { Registrar() }
  func application(_ app: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool { true }
  func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) { tokenForwards += 1 }
  func application(_ app: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { failureForwards += 1 }
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    responseForwards += 1
    if pluginMode == 1 { done() }
    if pluginMode == 2 { done(); done() }
    if pluginMode == 3 { deferred = done }
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    foregroundForwards += 1
    if pluginMode == 1 { done([.alert]) }
    if pluginMode == 2 { done([.alert]); done([.alert]) }
    if pluginMode == 3 { deferred = { done([.alert]) } }
  }
}
'''
main = r'''
@main enum ForwardingTests {
  static func main() {
    let app = AppDelegate(), application = UIApplication(), center = UNUserNotificationCenter.current()
    precondition(app.application(application, didFinishLaunchingWithOptions: nil))
    precondition(center.delegate === app)
    app.application(application, didRegisterForRemoteNotificationsWithDeviceToken: Data(repeating: 1, count: 32))
    app.application(application, didFailToRegisterForRemoteNotificationsWithError: NSError(domain: "private", code: 1))
    precondition(app.tokenForwards == 1 && app.failureForwards == 1)
    for mode in 0...3 {
      app.pluginMode = mode
      var completions = 0
      app.userNotificationCenter(center, didReceive: UNNotificationResponse(), withCompletionHandler: { completions += 1 })
      precondition(completions == 1)
      app.deferred?(); app.deferred = nil
      precondition(completions == 1)
      var foreground = 0
      app.userNotificationCenter(center, willPresent: UNNotification(), withCompletionHandler: { options in
        precondition(options.isEmpty)
        foreground += 1
      })
      app.deferred?(); app.deferred = nil
      precondition(foreground == 1)
    }
    precondition(app.responseForwards == 4 && app.foregroundForwards == 4)
    print("PASS: actual AppDelegate delegate installation; token/failure/response/foreground forwarding; absent/single/multiple/delayed plugin completion exactly once; foreground privacy")
  }
}
'''
with tempfile.TemporaryDirectory(prefix='djl-push-forwarding-') as work:
    work = Path(work)
    harness = work / 'Harness.swift'
    harness.write_text(stubs + '\n' + source + '\n' + main)
    executable = work / 'forwarding'
    subprocess.run(['swiftc', '-module-cache-path', str(work / 'cache'), str(mobile / 'ios/Runner/RemotePushModel.swift'), str(harness), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True)
