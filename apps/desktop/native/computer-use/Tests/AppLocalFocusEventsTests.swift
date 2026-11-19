import AppKit
import CoreGraphics

private enum TestFailure: Error { case failed(String) }
private var checks = 0
private func expect(_ condition: Bool, _ message: String) throws {
    checks += 1
    if !condition { throw TestFailure.failed(message) }
}

@main struct AppLocalFocusEventsTests {
    static func main() throws {
        for windowID: CGWindowID in [0, 12345, UInt32.max] {
            guard let events = AppLocalFocusEvents(windowID: windowID),
                  let activate = NSEvent(cgEvent: events.activate),
                  let deactivate = NSEvent(cgEvent: events.deactivate) else {
                throw TestFailure.failed("App-local events could not be constructed")
            }
            try expect(activate.type == .appKitDefined && activate.subtype.rawValue == 1,
                       "Activation must remain an app-local notification")
            try expect(activate.windowNumber == Int(windowID), "Activation lost its bound window")
            let flags: NSEvent.ModifierFlags = windowID == 0 ? [] : [.control, .option]
            try expect(activate.modifierFlags == flags, "Incorrect window-activation metadata flags")
            try expect(deactivate.type == .appKitDefined && deactivate.subtype.rawValue == 2,
                       "Cleanup must remain app-local deactivation")
            try expect(deactivate.windowNumber == 0 && deactivate.modifierFlags.isEmpty,
                       "Cleanup must not inherit activation-window or modifier metadata")
            try expect(activate.locationInWindow == .zero && deactivate.locationInWindow == .zero,
                       "Notifications must not introduce pointer coordinates")
        }
        let bounds = CGRect(x: 80, y: 100, width: 520, height: 480)
        guard let unsupported = AppLocalFocusEvents(windowID: 12345, bounds: bounds, activationPoint: .unsupported),
              let fallback = NSEvent(cgEvent: unsupported.activate) else { throw TestFailure.failed("No fallback") }
        try expect(fallback.windowNumber == 0 && fallback.modifierFlags.isEmpty,
                   "Unsupported activation-point metadata must select the original window-zero fallback")
        let point = CGPoint(x: 110, y: 113)
        guard let events = AppLocalFocusEvents(windowID: 12345, bounds: bounds, activationPoint: .point(point)),
              let pair = events.activationMouse else { throw TestFailure.failed("Missing activation mouse pair") }
        for (index, event) in [pair.down, pair.up].enumerated() {
            try expect(event.type == (index == 0 ? .leftMouseDown : .leftMouseUp), "Incorrect pair order")
            try expect(event.location == point && event.flags.isEmpty, "Incorrect point or inherited modifiers")
            try expect(event.getIntegerValueField(.mouseEventSubtype) == 3 && event.getIntegerValueField(.mouseEventButtonNumber) == 0,
                       "Incorrect window-targeted mouse metadata")
            try expect(event.getIntegerValueField(.mouseEventWindowUnderMousePointer) == 12345 && event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent) == 12345,
                       "Activation mouse event lost its window identity")
        }
        for point in [CGPoint(x: 79, y: 113), CGPoint(x: CGFloat.nan, y: 113)] {
            try expect(AppLocalFocusEvents(windowID: 12345, bounds: bounds, activationPoint: .point(point)) == nil,
                       "Untrusted activation point escaped the selected window")
        }
        try expect(AppLocalFocusEvents(windowID: 12345, activationPoint: .point(point))?.activationMouse == nil,
                   "No click is permitted without window bounds")
        print("AppLocalFocusEvents: \(checks) construction checks passed; no input dispatched")
    }
}
