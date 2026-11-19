import AppKit
import ApplicationServices

// A dedicated control test for our helper only. No general UI action surface.
let controlTitle = CommandLine.arguments.count == 3 ? CommandLine.arguments[2] : "Stop"
guard [2, 3].contains(CommandLine.arguments.count), ["Stop", "Open chat"].contains(controlTitle), let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == "com.djl.computer-use",
      app.executableURL?.resolvingSymlinksInPath().path.hasSuffix("/apps/desktop/native/computer-use/.build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse") == true,
      AXIsProcessTrusted() else { exit(2) }
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
let root = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(root, 0.3)
var queue = [root], matches: [AXUIElement] = [], count = 0
while !queue.isEmpty && count < 100 {
    let element = queue.removeFirst(); count += 1
    if attribute(element, kAXRoleAttribute) as? String == "AXButton", attribute(element, kAXTitleAttribute) as? String == controlTitle {
        if let owner = attribute(element, kAXWindowAttribute), CFGetTypeID(owner) == AXUIElementGetTypeID(),
           attribute(unsafeBitCast(owner, to: AXUIElement.self), kAXTitleAttribute) as? String == "DJL Computer Use" { matches.append(element) }
    }
    queue += (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(100 - count)
}
guard matches.count == 1 else { exit(3) }
let error = AXUIElementPerformAction(matches[0], kAXPressAction as CFString)
print("{\"axError\":\(error.rawValue),\"helperPid\":\(pid)}")
exit(error == .success ? 0 : 4)
