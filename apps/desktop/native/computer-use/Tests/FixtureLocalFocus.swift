import AppKit
import ApplicationServices
let control = NSApplication.shared
control.setActivationPolicy(.prohibited)
// Test control restricted to the dedicated synthetic fixture; never activates OS foreground.
guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]),
      let subtype = Int16(CommandLine.arguments[2]), [1, 2].contains(subtype),
      let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.djl.computer-use.background-fixture",
      app.executableURL?.resolvingSymlinksInPath() == URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture").resolvingSymlinksInPath(),
      AXIsProcessTrusted(), let event = NSEvent.otherEvent(with: .appKitDefined, location: .zero,
         modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, subtype: subtype, data1: 0, data2: 0)?.cgEvent else {
    let probe = Int32(CommandLine.arguments.dropFirst().first ?? "").flatMap { NSRunningApplication(processIdentifier: $0) }
    let value: [String: Any] = ["pid": probe?.processIdentifier ?? -1, "bundle": probe?.bundleIdentifier ?? "", "path": probe?.executableURL?.resolvingSymlinksInPath().path ?? "", "trusted": AXIsProcessTrusted()]
    if let data = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardError.write(data) }
    exit(2)
}
event.postToPid(pid)
Thread.sleep(forTimeInterval: 0.3) // Keep the sender alive until the target can consume its notification.
