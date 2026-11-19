import Foundation
import Dispatch

@main struct ActivationUpdateLeaseTests {
    static func main() {
        var checks = 0, failures = 0
        func check(_ value: Bool, _ message: String) {
            checks += 1
            if !value { failures += 1; print("FAIL: \(message)") }
        }
        var disables = 0, releases = 0
        let lease = ActivationUpdateLease(connection: 7, disable: { id in
            check(id == 7, "acquisition uses the attested connection")
            disables += 1; return 0
        }, reenable: { id in
            check(id == 7, "release uses the same connection")
            releases += 1; return releases == 1 ? -1 : 0
        })
        check(lease.begin() && lease.isHeld, "successful acquisition is owned")
        check(lease.begin() && disables == 1, "repeated begin does not duplicate acquisition")
        check(!lease.finish() && lease.isHeld, "failed release must retain ownership")
        check(lease.finish() && !lease.isHeld && releases == 2, "release retry actually re-enables updates")
        check(lease.finish() && releases == 2, "completed release is idempotent")
        check(!lease.begin() && disables == 1, "finished transaction cannot reacquire")
        var invalidCalls = 0
        let invalid = ActivationUpdateLease(connection: 0, disable: { _ in invalidCalls += 1; return 0 }, reenable: { _ in invalidCalls += 1; return 0 })
        check(!invalid.begin() && invalidCalls == 0, "invalid connection is rejected before native calls")
        check(invalid.finish() && !invalid.isHeld, "unacquired cleanup is harmless")
        var failedDisable = 0, unexpectedRelease = 0
        let denied = ActivationUpdateLease(connection: 8, disable: { _ in failedDisable += 1; return -1 }, reenable: { _ in unexpectedRelease += 1; return 0 })
        check(!denied.begin() && !denied.begin() && failedDisable == 1, "failed acquisition is terminal")
        check(denied.finish() && unexpectedRelease == 0, "failed acquisition cannot release an unowned resource")
        let countLock = NSLock()
        var concurrentReleases = 0
        let concurrent = ActivationUpdateLease(connection: 9, disable: { _ in 0 }, reenable: { _ in
            countLock.withLock { concurrentReleases += 1 }; Thread.sleep(forTimeInterval: 0.002); return 0
        })
        check(concurrent.begin(), "concurrent cleanup has an acquired resource")
        DispatchQueue.concurrentPerform(iterations: 16) { _ in _ = concurrent.finish() }
        check(concurrentReleases == 1 && !concurrent.isHeld, "worker/watchdog/EOF cleanup releases exactly once")
        print("Activation update lease: \(checks - failures)/\(checks) checks passed; no native API calls")
        exit(failures == 0 ? 0 : 1)
    }
}
