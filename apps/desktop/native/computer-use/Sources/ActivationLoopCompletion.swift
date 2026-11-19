import Foundation
import Dispatch

// Only the event-loop producer may publish completion. A timeout changes no state.
final class ActivationLoopCompletion {
    private let ended = DispatchGroup()
    private let lock = NSLock()
    private var completed = false
    init() { ended.enter() }
    func markEnded() {
        lock.withLock {
            guard !completed else { return }
            completed = true; ended.leave()
        }
    }
    func wait(until deadline: DispatchTime) -> Bool { ended.wait(timeout: deadline) == .success }
}
