import Foundation
@main struct Tests {
    static func main() {
        var checks = 0, failures = 0
        func check(_ result: WindowRepairDecision, _ expected: WindowRepairDecision, _ message: String) {
            checks += 1; if result != expected { failures += 1; print("FAIL: \(message)") }
        }
        func decision(foreground: Int32? = 20, saved: UInt32? = 100, current: UInt32? = 100, targetIndex: Int? = 0, savedIndex: Int? = 1, valid: Bool = true) -> WindowRepairDecision {
            windowRepairDecision(victim: 20, foreground: foreground, saved: saved, current: current, targetIndex: targetIndex, savedIndex: savedIndex, identitiesValid: valid)
        }
        check(decision(), .raiseSaved, "Restore prior window above our background target")
        check(decision(targetIndex: 2), .none, "Already-correct ordering needs no raise")
        check(decision(current: 101), .handoff, "Do not undo the human's new window choice")
        check(decision(current: nil), .wait, "Unknown focused window grants no raise")
        check(decision(targetIndex: nil), .wait, "Missing target grants no raise")
        check(decision(savedIndex: nil), .wait, "Missing prior window grants no raise")
        check(decision(valid: false), .handoff, "Changed process identity grants no raise")
        check(decision(foreground: nil), .handoff, "Unknown human foreground grants no raise")
        check(decision(foreground: 10), .handoff, "Target foreground needs its separate restoration authority")
        check(decision(foreground: 30), .handoff, "A new human foreground choice must be preserved")
        check(decision(saved: nil, current: nil), .none, "Original no-saved-window branch skips repair")
        check(decision(targetIndex: -1), .wait, "Invalid ordering grants no raise")
        check(decision(savedIndex: 0), .wait, "A shared ordering index grants no raise")
        print("Window repair: \(checks) cases, \(failures) failures; no native API calls")
        if failures > 0 { exit(1) }
    }
}
