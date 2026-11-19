import Foundation
import Dispatch
@main struct Tests {
    static func main() {
        var failures = 0, checks = 0
        func check(_ value: Bool, _ message: String) { checks += 1; if !value { failures += 1; print("FAIL: \(message)") } }
        let pending = ActivationLoopCompletion()
        check(!pending.wait(until: .now() + .milliseconds(2)), "A timeout must not acknowledge an unfinished event loop")
        check(!pending.wait(until: .now() + .milliseconds(2)), "A prior timeout fabricated completion for the next waiter")
        pending.markEnded(); pending.markEnded()
        check(pending.wait(until: .now()), "Actual completion was not latched")
        check(pending.wait(until: .now()), "Repeated completion wait blocked")
        let alreadyEnded = ActivationLoopCompletion(); alreadyEnded.markEnded()
        check(alreadyEnded.wait(until: .now()), "Completion before waiting was lost")
        print("Activation loop completion: \(checks) checks, \(failures) failures; no native API calls")
        if failures > 0 { exit(1) }
    }
}
