import CoreGraphics
import Dispatch

func refreshProcessEventTimestamp(_ event: CGEvent) {
    event.timestamp = DispatchTime.now().uptimeNanoseconds
}
