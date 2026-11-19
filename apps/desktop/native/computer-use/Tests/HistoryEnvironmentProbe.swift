import AppKit
import CoreGraphics
let pid = LiveForeground.pid()
let front = pid.flatMap { NSRunningApplication(processIdentifier: $0) }
let bundle = front?.bundleIdentifier ?? "unknown"
let prohibited = ["com.apple.loginwindow", "com.apple.securityagent", "com.apple.systempreferences", "com.apple.systemuiserver", "com.apple.controlcenter", "com.apple.notificationcenterui", "com.apple.keychainaccess", "com.apple.passwords"].contains(bundle.lowercased())
let point = CGEvent(source: nil)?.location ?? CGPoint(x: -1, y: -1)
let result: [String: Any] = ["pid": pid ?? -1, "bundle": bundle, "prohibited": prohibited || pid == nil, "cursorX": point.x, "cursorY": point.y]
if let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) { print(String(decoding: data, as: UTF8.self)) }
