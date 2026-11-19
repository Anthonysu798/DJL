import Darwin

@main struct ApplicationScopePolicyTests {
    static func main() {
        var checked = 0, failed = 0
        func check(_ result: Bool, _ message: String) {
            checked += 1
            if !result { failed += 1; print("FAIL: \(message)") }
        }
        func owned(_ helper: Int32, _ process: Int32, _ user: UInt32, _ owner: UInt32) -> Bool {
            ApplicationScopePolicy.ownsProcess(helperPID: helper, processPID: process, userID: user, processUserID: owner)
        }
        func pair(_ helper: Int32, _ target: Int32, _ foreground: Int32, _ user: UInt32, _ targetOwner: UInt32, _ foregroundOwner: UInt32) -> Bool {
            ApplicationScopePolicy.permitsBackgroundPair(helperPID: helper, targetPID: target, foregroundPID: foreground, userID: user, targetUserID: targetOwner, foregroundUserID: foregroundOwner)
        }
        check(owned(10, 20, 501, 501), "same-user application is admitted without a fixture name")
        check(owned(10, 2000, 502, 502), "other local user sessions work under their own helper")
        check(owned(10, 20, 0, 0), "policy compares ownership rather than hardcoding a user number")
        check(!owned(10, 20, 501, 0), "cross-user system process is denied")
        check(!owned(10, 20, 501, 502), "another user's process is denied")
        check(!owned(10, 10, 501, 501), "helper cannot target itself")
        check(!owned(0, 20, 501, 501), "missing helper PID is denied")
        check(!owned(10, 0, 501, 501), "missing process PID is denied")
        check(!owned(10, -1, 501, 501), "negative process PID is denied")
        check(pair(10, 20, 30, 501, 501, 501), "distinct same-user background and foreground apps are admitted")
        check(pair(99, 42, 77, 502, 502, 502), "pair is independent of app names and fixed PIDs")
        check(!pair(10, 20, 20, 501, 501, 501), "background scope cannot treat its target as the foreground victim")
        check(!pair(10, 10, 30, 501, 501, 501), "target helper is denied")
        check(!pair(10, 20, 10, 501, 501, 501), "foreground helper is denied")
        check(!pair(10, 20, 30, 501, 0, 501), "cross-user target pair is denied")
        check(!pair(10, 20, 30, 501, 501, 0), "cross-user foreground pair is denied")
        check(!pair(10, 20, 0, 501, 501, 501), "unknown foreground is denied")
        print("ApplicationScopePolicy: \(checked-failed)/\(checked) checks passed")
        if failed > 0 { exit(1) }
    }
}
