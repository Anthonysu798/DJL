import AppKit
import CoreGraphics
import Darwin
let args = CommandLine.arguments
var phase = "identity"
func abort() -> Never { fputs("Owned history input guard denied: \(phase)\n", stderr); exit(2) }
guard args.count == 4, let pid = Int32(args[1]), let windowID = UInt32(args[2]),
      LiveForeground.pid() == pid, let application = NSRunningApplication(processIdentifier: pid),
      application.bundleIdentifier == "com.djl.history-fixture",
      application.executableURL?.resolvingSymlinksInPath() == URL(fileURLWithPath: "/private/tmp/djl-cua-history-fixture/History Fixture.app/Contents/MacOS/HistoryFixture").resolvingSymlinksInPath() else { abort() }
phase = "window"
let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
guard let row = rows.first(where: { $0[kCGWindowOwnerPID as String] as? Int32 == pid && $0[kCGWindowNumber as String] as? UInt32 == windowID }),
      let raw = row[kCGWindowBounds as String] as? NSDictionary, let bounds = CGRect(dictionaryRepresentation: raw) else { abort() }
typealias WindowSetter = @convention(c) (CGEvent, CGPoint) -> Void
guard let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW | RTLD_LOCAL),
      let address = dlsym(library, "CGEventSetWindowLocation") else { abort() }
let windowLocation = unsafeBitCast(address, to: WindowSetter.self)
let point = CGPoint(x: bounds.minX + 60, y: bounds.maxY - 25)
func post(_ event: CGEvent) {
    phase = "live-foreground-before-post"
    guard LiveForeground.pid() == pid else { abort() }
    event.flags = []
    event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(windowID))
    event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
    if event.type != .keyDown && event.type != .keyUp {
        let location = event.location
        windowLocation(event, CGPoint(x: location.x - bounds.minX, y: location.y - bounds.minY))
    }
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowID))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowID))
    event.postToPid(pid)
    Thread.sleep(forTimeInterval: 0.08)
}
if args[3] == "text" {
    for down in [true, false] {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 6, keyDown: down) else { abort() }
        let text: [UniChar] = [90]; event.keyboardSetUnicodeString(stringLength: 1, unicodeString: text); post(event)
    }
} else if args[3] == "key" || args[3] == "tab" {
    for down in [true, false] { guard let event = CGEvent(keyboardEventSource: nil, virtualKey: args[3] == "tab" ? 48 : 124, keyDown: down) else { abort() }; post(event) }
} else {
    let right = args[3] == "right", button: CGMouseButton = right ? .right : .left
    guard let down = CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseDown : .leftMouseDown, mouseCursorPosition: point, mouseButton: button),
          let up = CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: point, mouseButton: button) else { abort() }
    down.setIntegerValueField(.mouseEventClickState, value: 1); up.setIntegerValueField(.mouseEventClickState, value: 1)
    if args[3] == "scroll" {
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: 15, wheel2: 6, wheel3: 0) else { abort() }
        event.location = point; post(event)
    } else {
        post(down)
        if args[3] == "drag" {
            guard let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: point.x + 25, y: point.y), mouseButton: .left) else { abort() }
            post(drag); up.location = drag.location
        }
        post(up)
    }
}
let dispatch: [String: Any] = ["kind": args[3], "pid": pid, "windowId": windowID, "x": point.x, "y": point.y]
print(String(data: try! JSONSerialization.data(withJSONObject: dispatch), encoding: .utf8)!)
