import Foundation

// Pure metadata transitions. A routing record exists only after a real Taken event.
struct FocusRoutingState {
    let target: Int32
    let victim: Int32
    private(set) var present = false
    private(set) var released = false
    private(set) var returned = false
    private var ownSeedDeadlineNs: UInt64?
    private var deactivationIssued = false
    private var ownSeedCleanupVerified = false
    // Explicit: older Swift makes the memberwise init private because of the private fields above.
    init(target: Int32, victim: Int32) {
        self.target = target
        self.victim = victim
    }
    var ownSeedIssued: Bool { ownSeedDeadlineNs != nil }
    enum Effect: Equatable { case pass, suppress, release }
    enum KeyboardDisposition: Equatable { case pass, forward, consume, humanTakeover }
    enum CleanupDisposition: Equatable { case deactivate, humanTakeover, retain }
    mutating func armOwnSeed(foregroundPid: Int32?, focusPid: Int32?, nowNs: UInt64, cancelled: Bool) -> Bool {
        guard !cancelled, !ownSeedIssued, foregroundPid == victim, focusPid == victim else { return false }
        ownSeedDeadlineNs = nowNs + 2_000_000_000
        return true
    }
    func seedWaitEligible(nowNs: UInt64) -> Bool { ownSeedDeadlineNs.map { nowNs < $0 } ?? false }
    func permitsActivationMouse(foregroundPid: Int32?, focusPid: Int32?, nowNs: UInt64) -> Bool {
        ownSeedIssued && seedWaitEligible(nowNs: nowNs) && foregroundPid == victim &&
            (focusPid == victim || focusPid == target)
    }
    enum ActivationMouseDecision: Equatable { case dispatch, resample, reject }
    func activationMouseDecision(firstForegroundPid: Int32?, secondForegroundPid: Int32?,
                                 managedFirstForegroundPid: Int32?, managedSecondForegroundPid: Int32?,
                                 focusPid: Int32?, nowNs: UInt64) -> ActivationMouseDecision {
        guard let first = firstForegroundPid, let second = secondForegroundPid,
              [victim, target].contains(first), [victim, target].contains(second),
              permitsActivationMouse(foregroundPid: managedFirstForegroundPid, focusPid: focusPid, nowNs: nowNs),
              permitsActivationMouse(foregroundPid: managedSecondForegroundPid, focusPid: focusPid, nowNs: nowNs) else { return .reject }
        return first == second ? .dispatch : .resample
    }
    func permitsHumanStopControlWait(helperPid: Int32, firstForegroundPid: Int32?, secondForegroundPid: Int32?,
                                     focusPid: Int32?, humanStopObserved: Bool, healthy: Bool, identitiesVerified: Bool) -> Bool {
        humanStopObserved && healthy && identitiesVerified && ownSeedIssued && helperPid != target && helperPid != victim &&
            firstForegroundPid == victim && secondForegroundPid == victim && focusPid == helperPid
    }
    mutating func retireProtection() { retire(); ownSeedDeadlineNs = nil; deactivationIssued = false; ownSeedCleanupVerified = false }
    mutating func noteDeactivationIssued() { if ownSeedIssued { deactivationIssued = true } }
    mutating func verifyOwnSeedCleanup(foregroundPid: Int32?, focusPid: Int32?, targetInactive: Bool) -> Bool {
        guard ownSeedIssued, deactivationIssued, targetInactive, let foreground = foregroundPid,
              foreground > 0, foreground != target, focusPid == foreground else { return false }
        ownSeedCleanupVerified = true; return true
    }
    func permitsRetirement(foregroundPid: Int32?, focusPid: Int32?, processGone: Bool) -> Bool {
        if processGone { return true }
        guard let foreground = foregroundPid, foreground > 0 else { return false }
        if foreground == target { return true }
        guard !ownSeedIssued || ownSeedCleanupVerified else { return false }
        return focusPid == foreground
    }
    func cleanupDisposition(foregroundPid: Int32?, veto: CleanupDisposition? = nil) -> CleanupDisposition {
        if let veto = veto, veto != .deactivate { return veto }
        guard let foreground = foregroundPid, foreground > 0 else { return .retain }
        return foreground == target ? .humanTakeover : .deactivate
    }
    // The sampler belongs inside this lock boundary; tests inject an inert
    // handoff at lock acquisition to reject pre-lock ownership snapshots.
    static func withLockedOwnership<T>(_ lock: NSLocking, sample: () -> (Int32?, Int32?), decide: (Int32?, Int32?) -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        let ownership = sample()
        return decide(ownership.0, ownership.1)
    }
    mutating func retire() { present = false; released = false; returned = false }
    mutating func notification(_ subtype: UInt16, targetPid: Int64, affectedPid: Int64) -> Effect {
        switch subtype {
        case 0x4000:
            retire()
            if targetPid == Int64(victim) && affectedPid == Int64(target) {
                present = true; return .suppress
            }
        case 0x8000:
            if present && !returned && targetPid == Int64(victim) { returned = true; return .suppress }
        case 0xf102:
            if present && affectedPid == Int64(target) && !released { released = true; return .release }
            if affectedPid != Int64(target) && affectedPid != Int64(victim) { retire() }
        case 2:
            if affectedPid == Int64(target) { retire() }
        default: break
        }
        return .pass
    }
    func permitsOwnership(focusPid: Int32?, foregroundPid: Int32?, allowSeedTransition: Bool) -> Bool {
        foregroundPid == victim && (focusPid == victim || (allowSeedTransition && (present || ownSeedIssued) && focusPid == target))
    }
    // Deactivating our own seed must remain possible while its keyboard-focus
    // release is in flight. This never grants permission to send ordinary input.
    func permitsCleanupOwnership(focusPid: Int32?, foregroundPid: Int32?) -> Bool {
        foregroundPid == victim && (focusPid == victim || (ownSeedIssued && focusPid == target))
    }
    func canForward(foregroundPid: Int32?, focusPid: Int32?) -> Bool {
        (present || ownSeedIssued) && foregroundPid == victim && (focusPid == victim || focusPid == target)
    }
    func routes(sourcePid: Int64, targetPid: Int64, helperPid: Int32) -> Bool {
        (present || ownSeedIssued) && sourcePid != Int64(helperPid) && targetPid == Int64(target)
    }
    func keyboardDisposition(sourcePid: Int64, targetPid: Int64, helperPid: Int32, foregroundPid: Int32?, focusPid: Int32?, healthy: Bool, identitiesVerified: Bool) -> KeyboardDisposition {
        guard routes(sourcePid: sourcePid, targetPid: targetPid, helperPid: helperPid) else { return .pass }
        guard identitiesVerified else { return .consume }
        if foregroundPid == target { return .humanTakeover }
        guard healthy, canForward(foregroundPid: foregroundPid, focusPid: focusPid) else { return .consume }
        return .forward
    }
}
