import Foundation

// One activation transaction; no app access, event generation, or key contents.
final class ForegroundRestorationAuthority {
    let helper: Int32, victim: Int32, target: Int32
    let targetWindow: UInt32
    private let priorWindow: UInt32?
    private let created: UInt64
    private let lock = NSLock()
    private var deadline: UInt64?
    private var issued: UInt64?
    private var cleanupDeadline: UInt64?
    private var revoked = false, ended = false
    var handoff: Bool { lock.withLock { revoked } }
    init(helper: Int32, victim: Int32, target: Int32, targetWindow: UInt32, priorWindow: UInt32?, createdAtNs: UInt64) {
        self.helper = helper; self.victim = victim; self.target = target; self.targetWindow = targetWindow
        self.priorWindow = priorWindow; created = createdAtNs
    }
    func arm(at now: UInt64) -> Bool {
        lock.withLock {
            guard !revoked && !ended && deadline == nil && now >= created && now <= UInt64.max - 3_000_000_000 else { return false }
            deadline = now + 2_000_000_000; return true
        }
    }
    func issueSeed(at now: UInt64) -> Bool {
        lock.withLock {
            guard !revoked && !ended && issued == nil, let deadline = deadline, now >= created && now < deadline else { return false }
            issued = now; return true
        }
    }
    func permitsTargetForeground(_ pid: Int32?, at now: UInt64) -> Bool {
        lock.withLock {
            guard !revoked && !ended && cleanupDeadline == nil && pid == target, let issued = issued, let deadline = deadline else { return false }
            return now >= issued && now < deadline
        }
    }
    func beginCleanup(at now: UInt64) -> Bool {
        lock.withLock {
            guard !ended && !revoked, let issued = issued, let activationDeadline = deadline, now >= issued else { return false }
            if let deadline = cleanupDeadline { return now < deadline }
            guard now < activationDeadline + 1_000_000_000 else { return false }
            guard now <= UInt64.max - 1_000_000_000 else { return false }
            cleanupDeadline = now + 1_000_000_000; return true
        }
    }
    func permitsCleanupTargetForeground(_ pid: Int32?, at now: UInt64) -> Bool {
        lock.withLock {
            guard !ended && !revoked && pid == target, let issued = issued, let deadline = cleanupDeadline else { return false }
            return now >= issued && now < deadline
        }
    }
    // Routing remains protective while cleanup starts. This grants no input or
    // activation request; effects require their specific phase authority.
    func permitsManagedTargetForeground(_ pid: Int32?, at now: UInt64) -> Bool {
        lock.withLock {
            guard !ended && !revoked && pid == target, let issued = issued, let activationDeadline = deadline else { return false }
            let limit = cleanupDeadline ?? activationDeadline + 1_000_000_000
            return now >= issued && now < limit
        }
    }
    func outsideClick(source: Int64, receiver: Int64, window: Int64, at time: UInt64) -> Bool {
        lock.withLock {
            guard !ended && !revoked && time >= created && source != Int64(helper) else { return false }
            // A helper-owned Stop/Open Chat control does not choose the target.
            if receiver == Int64(helper) && window != Int64(targetWindow) { return false }
            if receiver == Int64(victim), let priorWindow = priorWindow, window == Int64(priorWindow) { return false }
            revoked = true; return true
        }
    }
    func end() { lock.withLock { ended = true } }
}
