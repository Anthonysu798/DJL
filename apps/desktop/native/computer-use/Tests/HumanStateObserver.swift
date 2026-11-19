import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import Darwin

// Read-only evidence collector. Capture is restricted to the dedicated helper/fixture processes.
let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
func output(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) {
        print(String(decoding: data, as: UTF8.self))
    }
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func identity(_ name: String, bundle: String) -> NSRunningApplication? {
    guard let value = argument(name), let pid = Int32(value), let app = NSRunningApplication(processIdentifier: pid),
          app.bundleIdentifier == bundle, !app.isTerminated else { return nil }
    let path = app.executableURL?.resolvingSymlinksInPath().path ?? ""
    let expected = bundle == "com.djl.computer-use" ? "/apps/desktop/native/computer-use/.build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse" : "/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture"
    guard path.hasSuffix(expected) else { return nil }
    return app
}
let pointerTypes: [CGEventType] = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
let inputTypes = pointerTypes + [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .keyDown, .keyUp, .flagsChanged, .scrollWheel]
func hardwareCounter(_ types: [CGEventType]) -> UInt64 {
    types.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.hidSystemState, eventType: $1)) }
}
// Single-shot, read-only real keyboard ownership metadata; no key contents.
typealias ReadFocusMetadata = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> Int32
typealias ResolveFocusMetadata = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
func keyboardFocusMetadata() -> [String: Any] {
    guard let core = dlopen("/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics", RTLD_NOW | RTLD_LOCAL),
          let readAddress = dlsym(core, "CPSGetKeyFocusProcess"),
          let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL),
          let resolveAddress = dlsym(services, "GetProcessPID") else { return ["available": false] }
    let read = unsafeBitCast(readAddress, to: ReadFocusMetadata.self), resolve = unsafeBitCast(resolveAddress, to: ResolveFocusMetadata.self)
    var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), flag: UInt8 = 0, pid: pid_t = 0
    let status = read(&psn, &flag), pidStatus = status == 0 ? resolve(&psn, &pid) : Int32(-1)
    return ["available": true, "cpsStatus": status, "pidStatus": pidStatus, "pid": pid, "psnHigh": psn.highLongOfPSN, "psnLow": psn.lowLongOfPSN, "rawFlag": flag]
}
let observerApplication = NSApplication.shared
observerApplication.setActivationPolicy(.prohibited)
let human = NSWorkspace.shared.frontmostApplication
let cursor = CGEvent(source: nil)?.location ?? .zero
var result: [String: Any] = ["human": ["foregroundPid": human?.processIdentifier ?? -1,
    "foregroundBundle": human?.bundleIdentifier ?? "unknown", "mouseX": cursor.x, "mouseY": cursor.y,
    "hardwareModifierFlags": CGEventSource.flagsState(.hidSystemState).rawValue & UInt64(NSEvent.ModifierFlags.deviceIndependentFlagsMask.rawValue),
    "hardwarePointerCount": hardwareCounter(pointerTypes), "hardwareInputCount": hardwareCounter(inputTypes), "keyboardFocus": keyboardFocusMetadata()],
    "permissions": ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]]
let helper = identity("--helper-pid", bundle: "com.djl.computer-use")
let fixture = identity("--fixture-pid", bundle: "com.djl.computer-use.background-fixture")
result["processIdentity"] = ["helper": helper.map { ["pid": $0.processIdentifier, "executable": $0.executableURL?.resolvingSymlinksInPath().path ?? "", "launchDate": $0.launchDate?.description ?? "unavailable"] } ?? [:],
    "fixture": fixture.map { ["pid": $0.processIdentifier, "executable": $0.executableURL?.resolvingSymlinksInPath().path ?? "", "launchDate": $0.launchDate?.description ?? "unavailable"] } ?? [:]]
let allowedPids = [helper?.processIdentifier, fixture?.processIdentifier].compactMap { $0 }
let rows = allowedPids.isEmpty ? [] : CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let selected = rows.filter { row in
    guard let pid = row[kCGWindowOwnerPID as String] as? Int32 else { return false }
    return allowedPids.contains(pid)
}
result["windows"] = selected.map { row -> [String: Any] in
    ["pid": row[kCGWindowOwnerPID as String] ?? 0, "windowId": row[kCGWindowNumber as String] ?? 0,
     "title": row[kCGWindowName as String] ?? "", "layer": row[kCGWindowLayer as String] ?? -1,
     "onscreen": row[kCGWindowIsOnscreen as String] ?? false, "bounds": row[kCGWindowBounds as String] ?? [:]]
}
if let helper = helper, AXIsProcessTrusted() {
    var queue = [AXUIElementCreateApplication(helper.processIdentifier)]
    var tree: [[String: Any]] = []
    while !queue.isEmpty && tree.count < 100 {
        let element = queue.removeFirst()
        AXUIElementSetMessagingTimeout(element, 0.2)
        tree.append(["role": attribute(element, kAXRoleAttribute) as? String ?? "",
                     "title": attribute(element, kAXTitleAttribute) as? String ?? "",
                     "description": attribute(element, kAXDescriptionAttribute) as? String ?? ""])
        queue += (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(100 - tree.count)
    }
    result["helperAccessibility"] = tree
}
if let rawWindow = argument("--capture-window"), let windowId = UInt32(rawWindow),
   let destination = argument("--output"), destination.hasPrefix("/private/tmp/djl-cua-helper-e2e/"),
   let row = selected.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == windowId }),
   let expectedPid = row[kCGWindowOwnerPID as String] as? Int32, CGPreflightScreenCaptureAccess() {
    let gate = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var capture: [String: Any] = [:]
    Task.detached {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            guard let selectedWindow = content.windows.first(where: { $0.windowID == windowId && $0.owningApplication?.processID == expectedPid }) else { throw NSError(domain: "observer-window-unavailable", code: 1) }
            let configuration = SCStreamConfiguration()
            configuration.width = max(1, Int(selectedWindow.frame.width * 2)); configuration.height = max(1, Int(selectedWindow.frame.height * 2))
            configuration.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: selectedWindow), configuration: configuration)
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw NSError(domain: "observer-image", code: 1) }
            try data.write(to: URL(fileURLWithPath: destination), options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination)
            lock.withLock { capture = ["path": destination, "windowId": windowId, "pid": expectedPid, "width": image.width, "height": image.height] }
        } catch { lock.withLock { capture = ["error": String(describing: error)] } }
        gate.signal()
    }
    if gate.wait(timeout: .now() + 5) != .success { result["capture"] = ["error": "timeout"] }
    else { result["capture"] = lock.withLock { capture } }
}
output(result)
