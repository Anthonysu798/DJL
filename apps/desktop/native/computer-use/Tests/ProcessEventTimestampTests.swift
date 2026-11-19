import CoreGraphics
import Dispatch
import Foundation

@main struct ProcessEventTimestampTests {
    static func main() {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true)!
        event.flags = [.maskCommand]
        event.setIntegerValueField(.eventSourceUserData, value: 31415)
        for stale: UInt64 in [0, 1] {
            event.timestamp = stale
            let before = DispatchTime.now().uptimeNanoseconds
            refreshProcessEventTimestamp(event)
            let after = DispatchTime.now().uptimeNanoseconds
            precondition(event.timestamp >= before && event.timestamp <= after,
                         "A synthesized event must be stamped at dispatch, not construction")
        }
        let first = event.timestamp
        Thread.sleep(forTimeInterval: 0.002)
        refreshProcessEventTimestamp(event)
        precondition(event.timestamp > first, "Reused packets need a fresh dispatch timestamp")
        precondition(event.type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode) == 9)
        precondition(event.flags == [.maskCommand])
        precondition(event.getIntegerValueField(.eventSourceUserData) == 31415)
        print("ProcessEventTimestamp: zero/stale/reused event checks passed; packet contents preserved; no event posted")
    }
}
