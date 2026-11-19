import AppKit
import ApplicationServices
import Darwin
// Fake keyboard packets go only to the dedicated owned fixture PID, never globally.
let critical = CommandLine.arguments.count == 5 && CommandLine.arguments.last == "--critical-window"
guard (CommandLine.arguments.count == 4 || critical), let pid = Int32(CommandLine.arguments[1]),
      let window = UInt32(CommandLine.arguments[2]), let tag = Int64(CommandLine.arguments[3]), tag > 0,
      AXIsProcessTrusted(), let app = NSRunningApplication(processIdentifier: pid),
      app.bundleIdentifier == "com.djl.computer-use.background-fixture",
      app.executableURL?.resolvingSymlinksInPath() == URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture").resolvingSymlinksInPath() else { exit(2) }
func writeCritical(_ phase: String, _ fields: [String: Any] = [:]) {
    var row = fields; row["phase"] = phase; row["controllerPid"] = getpid(); row["observedNs"] = DispatchTime.now().uptimeNanoseconds
    let url = URL(fileURLWithPath: "/private/tmp/djl-cua-keyboard-protection/controller-\(getpid())-\(phase).json")
    if let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) {
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
let units = Array("DJL_FOREIGN_960002".utf16)
var packets: [CGEvent] = []
for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { exit(3) }
    event.flags = []
    event.setIntegerValueField(.eventSourceUserData, value: tag)
    event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
    event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(window))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window))
    units.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress) }
    packets.append(event)
}
var criticalMetadata: [String: Any] = [:]
var focusObservedNs: UInt64 = 0
if critical {
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    typealias Read = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> Int32
    typealias Resolve = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
    guard let core = dlopen("/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics", RTLD_NOW | RTLD_LOCAL),
          let readSymbol = dlsym(core, "CPSGetKeyFocusProcess"),
          let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL),
          let resolveSymbol = dlsym(services, "GetProcessPID") else { writeCritical("missed", ["reason": "focus-api-unavailable"]); exit(0) }
    let read = unsafeBitCast(readSymbol, to: Read.self), resolve = unsafeBitCast(resolveSymbol, to: Resolve.self)
    var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), flag: UInt8 = 0, focusPid: pid_t = 0
    // Warm the connection before declaring readiness. Event construction and
    // symbol loading must not consume the measured posting interval.
    _ = read(&psn, &flag)
    writeCritical("armed")
    guard readLine() == "post" else { exit(4) }
    let status = read(&psn, &flag), pidStatus = status == 0 ? resolve(&psn, &focusPid) : Int32(-1)
    focusObservedNs = DispatchTime.now().uptimeNanoseconds
    guard status == 0, pidStatus == 0, focusPid == pid else {
        writeCritical("missed", ["beforePostNs": focusObservedNs, "cpsStatus": status,
                                "pidStatus": pidStatus, "keyFocusPid": focusPid, "targetPid": pid, "rawFlag": flag]); exit(0)
    }
}
let firstPostCallNs = DispatchTime.now().uptimeNanoseconds
packets[0].postToPid(pid)
let firstPostReturnedNs = DispatchTime.now().uptimeNanoseconds
packets[1].postToPid(pid) // Matching release remains unconditional after down.
if critical {
    criticalMetadata = ["beforePostNs": focusObservedNs, "cpsStatus": 0, "pidStatus": 0,
                        "keyFocusPid": pid, "targetPid": pid, "firstPostCallNs": firstPostCallNs,
                        "firstPostReturnedNs": firstPostReturnedNs, "postedNs": DispatchTime.now().uptimeNanoseconds]
    writeCritical("posted", criticalMetadata)
}
Thread.sleep(forTimeInterval: critical ? 0.4 : 0.2)
print("{\"controllerPid\":\(getpid()),\"targetPid\":\(pid),\"tag\":\(tag)}")
