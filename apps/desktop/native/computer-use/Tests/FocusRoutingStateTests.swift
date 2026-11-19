import Foundation

// Deterministic inert handoff at lock acquisition; no threads or native input.
final class InterleavingLock: NSLocking {
    let onLock: () -> Void
    init(_ onLock: @escaping () -> Void) { self.onLock = onLock }
    func lock() { onLock() }
    func unlock() {}
}

@main struct FocusRoutingStateTests {
    static func main() {
        var checks = 0, failures = 0
        func verify(_ value: @autoclosure () -> Bool, line: Int = #line) {
            checks += 1
            if !value() { failures += 1; print("FAIL FocusRoutingState at line \(line)") }
        }
        var state = FocusRoutingState(target: 10, victim: 20)
        verify(!state.routes(sourcePid: 30, targetPid: 10, helperPid: 40))
        verify(!state.canForward(foregroundPid: 20, focusPid: 10))
        verify(state.notification(0x4000, targetPid: 20, affectedPid: 10) == .suppress)
        verify(state.present && !state.released && !state.returned)
        verify(state.canForward(foregroundPid: 20, focusPid: 10)) // Taken, before Changed/release.
        verify(!state.canForward(foregroundPid: 30, focusPid: 10))
        verify(!state.canForward(foregroundPid: 20, focusPid: nil))
        verify(!state.routes(sourcePid: 40, targetPid: 10, helperPid: 40))
        verify(state.routes(sourcePid: 30, targetPid: 10, helperPid: 40))
        verify(!state.routes(sourcePid: 30, targetPid: 11, helperPid: 40))
        verify(state.notification(0xf102, targetPid: 1, affectedPid: 10) == .release)
        verify(state.canForward(foregroundPid: 20, focusPid: 20))
        verify(state.notification(0xf102, targetPid: 1, affectedPid: 10) == .pass)
        verify(state.notification(0xf102, targetPid: 1, affectedPid: 20) == .pass && state.present)
        verify(state.notification(0x8000, targetPid: 20, affectedPid: 20) == .suppress)
        verify(state.notification(0x8000, targetPid: 20, affectedPid: 20) == .pass)
        verify(state.routes(sourcePid: 30, targetPid: 10, helperPid: 40))
        verify(state.notification(0xf102, targetPid: 1, affectedPid: 30) == .pass && !state.present)
        _ = state.notification(0x4000, targetPid: 20, affectedPid: 10)
        _ = state.notification(2, targetPid: 1, affectedPid: 10)
        verify(!state.present)
        _ = state.notification(0x4000, targetPid: 20, affectedPid: 10)
        _ = state.notification(0x4000, targetPid: 20, affectedPid: 30)
        verify(!state.present)
        _ = state.notification(0x4000, targetPid: 20, affectedPid: 10)
        _ = state.notification(0x8000, targetPid: 99, affectedPid: 20)
        verify(state.present && !state.returned)
        state.retire()
        verify(!state.present && !state.released && !state.returned)
        // An inert validator models Taken completing during blocking identity
        // work. Classification must read the post-validation state, not cache it.
        var evolving = FocusRoutingState(target: 10, victim: 20)
        let stale = evolving.permitsOwnership(focusPid: 10, foregroundPid: 20, allowSeedTransition: true)
        func validateIdentity() { _ = evolving.notification(0x4000, targetPid: 20, affectedPid: 10) }
        validateIdentity()
        verify(!stale)
        verify(evolving.permitsOwnership(focusPid: 10, foregroundPid: 20, allowSeedTransition: true))
        verify(!evolving.permitsOwnership(focusPid: 10, foregroundPid: 20, allowSeedTransition: false))
        var pending = FocusRoutingState(target: 10, victim: 20)
        verify(!pending.armOwnSeed(foregroundPid: 20, focusPid: 20, nowNs: 100, cancelled: true))
        verify(!pending.ownSeedIssued) // Stop before dispatch cannot leave authority.
        verify(!pending.armOwnSeed(foregroundPid: 20, focusPid: 10, nowNs: 100, cancelled: false))
        verify(!pending.armOwnSeed(foregroundPid: nil, focusPid: 20, nowNs: 100, cancelled: false))
        verify(pending.armOwnSeed(foregroundPid: 20, focusPid: 20, nowNs: 100, cancelled: false))
        verify(pending.ownSeedIssued && !pending.present && !pending.released && !pending.returned)
        verify(pending.routes(sourcePid: 30, targetPid: 10, helperPid: 40))
        verify(pending.canForward(foregroundPid: 20, focusPid: 10)) // No Taken, CPS thief.
        verify(pending.canForward(foregroundPid: 20, focusPid: 20)) // Queued packet, CPS already victim.
        verify(!pending.canForward(foregroundPid: 10, focusPid: 10)) // Actual human target takeover.
        verify(!pending.canForward(foregroundPid: 30, focusPid: 20))
        verify(!pending.canForward(foregroundPid: nil, focusPid: 20))
        verify(!pending.canForward(foregroundPid: 20, focusPid: nil))
        verify(!pending.canForward(foregroundPid: 20, focusPid: 30))
        verify(pending.seedWaitEligible(nowNs: 499_999_999))
        verify(pending.seedWaitEligible(nowNs: 500_000_100)) // Longer bounded acquisition is waiting only.
        verify(!pending.seedWaitEligible(nowNs: 2_000_000_100))
        verify(pending.ownSeedIssued && pending.canForward(foregroundPid: 20, focusPid: 10)) // Expiry retains protection.
        verify(!pending.permitsOwnership(focusPid: 10, foregroundPid: 20, allowSeedTransition: false))
        verify(!pending.routes(sourcePid: 40, targetPid: 10, helperPid: 40))
        verify(pending.notification(0xf102, targetPid: 1, affectedPid: 10) == .pass && !pending.released)
        verify(pending.notification(0x8000, targetPid: 20, affectedPid: 20) == .pass && !pending.returned)
        verify(pending.notification(0x4000, targetPid: 20, affectedPid: 10) == .suppress && pending.present)
        verify(pending.notification(0xf102, targetPid: 1, affectedPid: 10) == .release)
        verify(pending.notification(0x8000, targetPid: 20, affectedPid: 20) == .suppress)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 20, focusPid: 20, healthy: true, identitiesVerified: true) == .forward)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 20, focusPid: 10, healthy: true, identitiesVerified: true) == .forward)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: nil, focusPid: 10, healthy: true, identitiesVerified: true) == .consume)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 20, focusPid: nil, healthy: true, identitiesVerified: true) == .consume)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 30, focusPid: 20, healthy: true, identitiesVerified: true) == .consume)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 10, focusPid: 10, healthy: false, identitiesVerified: true) == .humanTakeover)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 20, focusPid: 20, healthy: true, identitiesVerified: false) == .consume)
        verify(pending.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40, foregroundPid: 20, focusPid: 20, healthy: false, identitiesVerified: true) == .consume)
        pending.retireProtection()
        verify(!pending.ownSeedIssued && !pending.present)
        verify(!pending.routes(sourcePid: 30, targetPid: 10, helperPid: 40))
        var unresolved = FocusRoutingState(target: 10, victim: 20)
        _ = unresolved.armOwnSeed(foregroundPid: 20, focusPid: 20, nowNs: 0, cancelled: false)
        verify(!unresolved.permitsRetirement(foregroundPid: 20, focusPid: 20, processGone: false))
        verify(!unresolved.permitsRetirement(foregroundPid: nil, focusPid: 20, processGone: false))
        verify(!unresolved.verifyOwnSeedCleanup(foregroundPid: 20, focusPid: 20, targetInactive: true)) // No13/2 issued.
        unresolved.noteDeactivationIssued()
        verify(!unresolved.verifyOwnSeedCleanup(foregroundPid: 20, focusPid: 20, targetInactive: false))
        verify(!unresolved.permitsRetirement(foregroundPid: 20, focusPid: 20, processGone: false)) // Failed13/2 cannot reap.
        verify(!unresolved.verifyOwnSeedCleanup(foregroundPid: nil, focusPid: 20, targetInactive: true))
        verify(!unresolved.verifyOwnSeedCleanup(foregroundPid: 20, focusPid: 30, targetInactive: true))
        verify(unresolved.permitsRetirement(foregroundPid: 10, focusPid: 10, processGone: false))
        verify(unresolved.permitsRetirement(foregroundPid: nil, focusPid: nil, processGone: true))
        verify(unresolved.verifyOwnSeedCleanup(foregroundPid: 20, focusPid: 20, targetInactive: true))
        verify(unresolved.permitsRetirement(foregroundPid: 20, focusPid: 20, processGone: false))
        verify(!unresolved.permitsRetirement(foregroundPid: nil, focusPid: 20, processGone: false))
        verify(unresolved.cleanupDisposition(foregroundPid: 20) == .deactivate)
        verify(unresolved.cleanupDisposition(foregroundPid: 10) == .humanTakeover)
        verify(unresolved.cleanupDisposition(foregroundPid: nil) == .retain)
        verify(unresolved.cleanupDisposition(foregroundPid: 20, veto: .humanTakeover) == .humanTakeover)
        verify(unresolved.cleanupDisposition(foregroundPid: 20, veto: .retain) == .retain)
        for finalOwner: Int32? in [10, nil, 30] {
            var liveOwner: Int32? = 20
            let delayed = InterleavingLock { liveOwner = finalOwner }
            let disposition = FocusRoutingState.withLockedOwnership(delayed, sample: { (liveOwner, 20) }) { front, focus in
                unresolved.keyboardDisposition(sourcePid: 30, targetPid: 10, helperPid: 40,
                    foregroundPid: front, focusPid: focus, healthy: true, identitiesVerified: true)
            }
            verify(disposition == (finalOwner == 10 ? .humanTakeover : .consume))
        }
        var activationMouse = FocusRoutingState(target: 10, victim: 20)
        verify(!activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: 20, nowNs: 100))
        verify(activationMouse.armOwnSeed(foregroundPid: 20, focusPid: 20, nowNs: 100, cancelled: false))
        verify(activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: 20, nowNs: 101))
        verify(activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: 10, nowNs: 101))
        verify(!activationMouse.permitsActivationMouse(foregroundPid: 10, focusPid: 10, nowNs: 101))
        verify(!activationMouse.permitsActivationMouse(foregroundPid: nil, focusPid: 20, nowNs: 101))
        verify(!activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: nil, nowNs: 101))
        verify(!activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: 30, nowNs: 101))
        verify(!activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: 10, nowNs: 2_000_000_100))
        activationMouse.retireProtection()
        verify(!activationMouse.permitsActivationMouse(foregroundPid: 20, focusPid: 20, nowNs: 102))
        var cleanup = FocusRoutingState(target: 10, victim: 20)
        verify(cleanup.permitsCleanupOwnership(focusPid: 20, foregroundPid: 20))
        verify(!cleanup.permitsCleanupOwnership(focusPid: 10, foregroundPid: 20))
        verify(cleanup.armOwnSeed(foregroundPid: 20, focusPid: 20, nowNs: 0, cancelled: false))
        verify(cleanup.permitsCleanupOwnership(focusPid: 10, foregroundPid: 20))
        verify(!cleanup.permitsOwnership(focusPid: 10, foregroundPid: 20, allowSeedTransition: false))
        verify(!cleanup.permitsActivationMouse(foregroundPid: 20, focusPid: 10, nowNs: 2_000_000_000))
        for foreground: Int32? in [nil, 10, 30] {
            verify(!cleanup.permitsCleanupOwnership(focusPid: 10, foregroundPid: foreground))
        }
        for focus: Int32? in [nil, 30] {
            verify(!cleanup.permitsCleanupOwnership(focusPid: focus, foregroundPid: 20))
        }
        cleanup.retireProtection()
        verify(!cleanup.permitsCleanupOwnership(focusPid: 10, foregroundPid: 20))
        print("FocusRoutingState: \(checks - failures)/\(checks) checks passed")
        exit(failures == 0 ? 0 : 1)
    }
}
