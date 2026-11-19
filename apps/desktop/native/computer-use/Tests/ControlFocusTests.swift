import Foundation
@main struct ControlFocusTests {
    static func main() {
        var state = FocusRoutingState(target: 20, victim: 10)
        precondition(state.armOwnSeed(foregroundPid: 10, focusPid: 10, nowNs: 0, cancelled: false))
        let cases: [(String, Int32, Int32?, Int32?, Int32?, Bool, Bool, Bool, Bool)] = [
            ("verified human Stop panel", 30, 10, 10, 30, true, true, true, true),
            ("no human Stop", 30, 10, 10, 30, false, true, true, false),
            ("unhealthy", 30, 10, 10, 30, true, false, true, false),
            ("identity unknown", 30, 10, 10, 30, true, true, false, false),
            ("unknown focus", 30, 10, 10, 40, true, true, true, false),
            ("missing focus", 30, 10, 10, nil, true, true, true, false),
            ("foreground changed", 30, 10, 40, 30, true, true, true, false),
            ("target foreground", 30, 20, 20, 30, true, true, true, false),
            ("missing foreground", 30, nil, 10, 30, true, true, true, false),
            ("helper confused with target", 20, 10, 10, 20, true, true, true, false),
            ("helper confused with victim", 10, 10, 10, 10, true, true, true, false),
        ]
        var failed = 0
        for (name, helper, first, second, focus, stop, healthy, identity, want) in cases {
            let actual = state.permitsHumanStopControlWait(helperPid: helper, firstForegroundPid: first,
                secondForegroundPid: second, focusPid: focus, humanStopObserved: stop, healthy: healthy, identitiesVerified: identity)
            if actual != want { failed += 1; print("FAIL \(name)") }
        }
        state.retireProtection()
        if state.permitsHumanStopControlWait(helperPid: 30, firstForegroundPid: 10, secondForegroundPid: 10,
            focusPid: 30, humanStopObserved: true, healthy: true, identitiesVerified: true) { failed += 1; print("FAIL retired seed") }
        print("ControlFocus: \(cases.count + 1) checks, \(failed) failures")
        if failed != 0 { exit(1) }
    }
}
