import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

private typealias ReadFocusProcess = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> Int32
private typealias ResolveFocusPid = @convention(c) (UnsafePointer<ProcessSerialNumber>, UnsafeMutablePointer<pid_t>) -> Int32
private typealias ReleaseFocusToken = @convention(c) (UInt32) -> Int32
private final class FocusAPI {
    static let shared = FocusAPI()
    private let read: ReadFocusProcess?
    private let resolve: ResolveFocusPid?
    private let release: ReleaseFocusToken?
    private init() {
        let core = dlopen("/System/Library/Frameworks/CoreGraphics.framework/Versions/A/CoreGraphics", RTLD_NOW | RTLD_LOCAL)
        let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL)
        read = core.flatMap { dlsym($0, "CPSGetKeyFocusProcess") }.map { unsafeBitCast($0, to: ReadFocusProcess.self) }
        release = core.flatMap { dlsym($0, "CPSReleaseKeyFocusWithID") }.map { unsafeBitCast($0, to: ReleaseFocusToken.self) }
        resolve = services.flatMap { dlsym($0, "GetProcessPID") }.map { unsafeBitCast($0, to: ResolveFocusPid.self) }
    }
    var available: Bool { read != nil && resolve != nil && release != nil }
    func pid() -> pid_t? {
        guard let read = read, let resolve = resolve else { return nil }
        var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0), flag: UInt8 = 0, pid: pid_t = 0
        guard read(&psn, &flag) == 0, resolve(&psn, &pid) == 0, pid > 0 else { return nil }
        return pid // The flag's meaning is unknown; no policy relies on it.
    }
    func release(_ token: Int64) -> Bool {
        guard token >= 0, token <= Int64(UInt32.max), let release = release else { return false }
        return release(UInt32(token)) == 0
    }
}

// One lease covers AX effects, temporary local focus, paired input releases and
// deactivation. Only PID/notification metadata is inspected, never key contents.
final class FocusProtection {
    // Serialized operation worker only. Unsafe cleanup keeps both taps alive.
    private static var retained: [pid_t: FocusProtection] = [:]
    private let protectionID = UUID()
    private var announced = false
    private var finished = false
    private let session: Session
    private let targetWindow: Window
    private let victim: pid_t
    private let victimIdentity: ProcessIdentity
    private let api = FocusAPI.shared
    private let lock = NSLock()
    private let ready = DispatchSemaphore(value: 0)
    private let ended = DispatchSemaphore(value: 0)
    private var state: FocusRoutingState
    private var healthy = false
    private var metadataTrace: [Object] = []
    private var runLoopReadyNs: UInt64 = 0
    private var stopRequested = false
    private var humanTakeoverAccepted = false
    private var foregroundAuthority: ForegroundRestorationAuthority?
    private var activationResourcesHealthy: (() -> Bool)?
    private var loop: CFRunLoop?
    private var metadataTap: CFMachPort?
    private var keyboardTap: CFMachPort?
    private var pointerMonitor: PointerMovementMonitor?

    init(_ session: Session, _ human: HumanControlGuard, window: Window) throws {
        Self.reap()
        guard Self.retained.isEmpty else { try fail("unsupported", "Keyboard protection is retained after unsafe cleanup") }
        try requireCleanLocalFocus(session)
        guard FocusAPI.shared.available, let focus = FocusAPI.shared.pid(), focus != session.target.pid,
              focus == human.lastSample.foregroundPid else {
            try fail("unsupported", "Background keyboard ownership is unavailable or belongs to the target; hosted focus aliases are unsupported")
        }
        self.session = session; targetWindow = window; victim = focus; victimIdentity = try ProcessIdentity(focus)
        state = FocusRoutingState(target: session.target.pid, victim: focus)
        guard identitiesMatch() else { try fail("target-unavailable", "Keyboard protection process identity changed") }
        let startupDeadline = DispatchTime.now() + 2
        start()
        pointerMonitor = PointerMovementMonitor(human: human, failed: { [weak self] in
            if let self = self { stopped(self.session) }
        })
        guard ready.wait(timeout: startupDeadline) == .success,
              pointerMonitor?.waitUntilReady(startupDeadline) == true, isHealthy else {
            stop(); try fail("unsupported", "Required computer-control protection taps are unavailable")
        }
        NativeProtectionActivity.acquire(protectionID); announced = true
        do { try check(human) } catch { _ = finish(); throw error }
    }
    private func identitiesMatch() -> Bool {
        (try? ProcessIdentity(session.target.pid)) == session.identity && (try? ProcessIdentity(victim)) == victimIdentity
    }
    private var isHealthy: Bool {
        lock.withLock {
            guard healthy, !stopRequested, let metadata = metadataTap, let keyboard = keyboardTap else { return false }
            return CGEvent.tapIsEnabled(tap: metadata) && CGEvent.tapIsEnabled(tap: keyboard) && pointerMonitor?.isHealthy == true
        }
    }
    func attachForegroundAuthority(_ authority: ForegroundRestorationAuthority, healthy: @escaping () -> Bool) throws {
        try lock.withLock {
            guard foregroundAuthority == nil && authority.helper == getpid() && authority.target == session.target.pid && authority.victim == victim && authority.targetWindow == targetWindow.id else { try fail("unsupported", "Activation authority identity mismatch") }
            foregroundAuthority = authority; activationResourcesHealthy = healthy
        }
    }
    func detachForegroundAuthority(_ authority: ForegroundRestorationAuthority) {
        lock.withLock { if foregroundAuthority === authority { foregroundAuthority = nil; activationResourcesHealthy = nil } }
    }
    // Called only under this protection lock. Normal input never uses this view.
    private func activationForeground(_ foreground: pid_t?, cleanup: Bool = false) -> pid_t? {
        let now = DispatchTime.now().uptimeNanoseconds
        let phase = cleanup ? foregroundAuthority?.permitsManagedTargetForeground(foreground, at: now) == true :
            state.seedWaitEligible(nowNs: now) && foregroundAuthority?.permitsTargetForeground(foreground, at: now) == true
        if healthy && !stopRequested && state.ownSeedIssued && activationResourcesHealthy?() == true && phase { return victim }
        return foreground
    }
    var currentKeyboardOwner: pid_t? { api.pid() }
    var isKeyboardSteady: Bool { api.pid() == victim }
    var seedWaitEligible: Bool { lock.withLock { state.seedWaitEligible(nowNs: DispatchTime.now().uptimeNanoseconds) } }
    private func targetWindowMatches() -> Bool {
        guard let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, session.target.window) as? [Object] else { return false }
        return rows.contains { row in
            guard row[kCGWindowNumber as String] as? UInt32 == targetWindow.id,
                  row[kCGWindowOwnerPID as String] as? Int32 == targetWindow.pid,
                  row[kCGWindowLayer as String] as? Int == 0,
                  let bounds = row[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bounds) else { return false }
            return rect == targetWindow.rect
        }
    }
    // Session.dispatch already holds its cancellation lock. Releases bypass this
    // authorization so an earlier down always receives its matching up.
    func authorizeAgentInput() throws {
        guard identitiesMatch(), targetWindowMatches() else { try fail("target-unavailable", "Input process/window identity is unavailable or changed") }
        try lock.withLock {
            let foreground = LiveForeground.pid(), focus = api.pid()
            guard healthy, !stopRequested, let metadata = metadataTap, let keyboard = keyboardTap,
                  CGEvent.tapIsEnabled(tap: metadata), CGEvent.tapIsEnabled(tap: keyboard), pointerMonitor?.isHealthy == true,
                  foreground == victim, LiveForeground.pid() == victim, focus == victim else {
                try fail("unsupported", "Agent input lacks fresh verified victim keyboard ownership")
            }
        }
    }
    // Called inside Session.dispatch's cancellation lock. No session-lock reads
    // are allowed here: arming and issuing13/1 share that exact boundary.
    func issueOwnSeed(_ event: CGEvent) throws {
        guard identitiesMatch(), targetWindowMatches() else { try fail("target-unavailable", "Own-seed process/window identity is unavailable or changed") }
        try lock.withLock {
            let foreground = LiveForeground.pid(), focus = api.pid()
            guard healthy, !stopRequested, let metadata = metadataTap, let keyboard = keyboardTap,
                  CGEvent.tapIsEnabled(tap: metadata), CGEvent.tapIsEnabled(tap: keyboard), pointerMonitor?.isHealthy == true,
                  foreground == victim, LiveForeground.pid() == victim,
                  state.armOwnSeed(foregroundPid: foreground, focusPid: focus,
                                   nowNs: DispatchTime.now().uptimeNanoseconds, cancelled: false) else {
                try fail("unsupported", "Own-seed scope lacks verified victim ownership")
            }
            if let authority = foregroundAuthority, !authority.issueSeed(at: DispatchTime.now().uptimeNanoseconds) {
                state.retireProtection(); try fail("unsupported", "Own activation authority was revoked before dispatch")
            }
            refreshProcessEventTimestamp(event)
            event.postToPid(session.target.pid)
        }
    }
    // The caller holds Session.dispatch. Only this owned activation mouse pair
    // may use the bounded seed transition; ordinary input still requires victim focus.
    func issueActivationMouse(_ event: CGEvent) throws -> Bool {
        guard event.type == .leftMouseDown || event.type == .leftMouseUp,
              event.getIntegerValueField(.mouseEventWindowUnderMousePointer) == Int64(targetWindow.id),
              targetWindow.rect.contains(event.location) else { try fail("unsupported", "Invalid activation mouse packet") }
        guard (try? ProcessIdentity(session.target.pid)) == session.identity else {
            if event.type == .leftMouseUp { return true }
            try fail("target-unavailable", "Activation mouse process identity changed")
        }
        if event.type == .leftMouseDown {
            guard identitiesMatch(), targetWindowMatches() else { try fail("target-unavailable", "Activation mouse window identity changed") }
        }
        guard let setter = WindowLocationAPI.setter else { try fail("unsupported", "Window-local input is unavailable") }
        let point = event.location
        // A focus-notification callback may hold the protection lock while the
        // target tracks the down. Its matching up must not wait for that lock.
        if event.type == .leftMouseUp {
            setter(event, CGPoint(x: point.x - targetWindow.rect.minX, y: point.y - targetWindow.rect.minY))
            refreshProcessEventTimestamp(event)
            event.postToPid(session.target.pid)
            return true
        }
        return try lock.withLock {
            let foreground = LiveForeground.pid(), focus = api.pid()
            guard healthy, !stopRequested, let metadata = metadataTap, let keyboard = keyboardTap,
                  CGEvent.tapIsEnabled(tap: metadata), CGEvent.tapIsEnabled(tap: keyboard), pointerMonitor?.isHealthy == true else {
                try fail("unsupported", "Activation mouse protection is unavailable")
            }
            let second = LiveForeground.pid()
            let decision = state.activationMouseDecision(firstForegroundPid: foreground, secondForegroundPid: second,
                managedFirstForegroundPid: activationForeground(foreground), managedSecondForegroundPid: activationForeground(second),
                focusPid: focus, nowNs: DispatchTime.now().uptimeNanoseconds)
            if decision == .resample { return false }
            guard decision == .dispatch else { try fail("unsupported", "Activation mouse lacks fresh bounded seed authority") }
            setter(event, CGPoint(x: point.x - targetWindow.rect.minX, y: point.y - targetWindow.rect.minY))
            refreshProcessEventTimestamp(event)
            event.postToPid(session.target.pid)
            return true
        }
    }
    // Called inside the release-capable Session dispatch boundary. A final
    // observed takeover/unknown veto is never overridden by cancellation bypass.
    func dispatchDeactivation(_ event: CGEvent, veto: FocusRoutingState.CleanupDisposition?) throws -> FocusRoutingState.CleanupDisposition {
        guard identitiesMatch() else { try fail("target-unavailable", "Process identity changed before focus cleanup") }
        return lock.withLock {
            let decision = state.cleanupDisposition(foregroundPid: LiveForeground.pid(), veto: humanTakeoverAccepted ? .humanTakeover : veto)
            if decision == .deactivate {
                state.noteDeactivationIssued()
                refreshProcessEventTimestamp(event)
                event.postToPid(session.target.pid)
            }
            return decision
        }
    }
    func confirmOwnSeedCleanup() -> Bool {
        guard identitiesMatch(), appLocalFocusState(session.target.pid) == false else { return false }
        return lock.withLock {
            let foreground = LiveForeground.pid(), focus = api.pid()
            guard foreground == LiveForeground.pid() else { return false }
            return state.verifyOwnSeedCleanup(foregroundPid: foreground, focusPid: focus, targetInactive: true)
        }
    }
    func check(_ human: HumanControlGuard, allowSeedTransition: Bool = false) throws {
        try checkOwnership(human, allowSeedTransition: allowSeedTransition, cleanup: false)
    }
    func checkCleanup(_ human: HumanControlGuard) throws {
        try checkOwnership(human, allowSeedTransition: false, cleanup: true)
    }
    // Waiting grants no input or cleanup effect. Only the actual human-Stop
    // path can mark the session; both foreground reads must remain the victim.
    func humanStopControlFocusPending() -> Bool {
        guard session.humanStopWasRequested else { return false }
        let verified = identitiesMatch()
        return lock.withLock {
            let first = LiveForeground.pid(), focus = api.pid(), second = LiveForeground.pid()
            let health = healthy && !stopRequested && metadataTap.map { CGEvent.tapIsEnabled(tap: $0) } == true &&
                keyboardTap.map { CGEvent.tapIsEnabled(tap: $0) } == true && pointerMonitor?.isHealthy == true
            return state.permitsHumanStopControlWait(helperPid: getpid(), firstForegroundPid: first, secondForegroundPid: second,
                focusPid: focus, humanStopObserved: true, healthy: health, identitiesVerified: verified)
        }
    }
    func checkForegroundCleanup(_ human: HumanControlGuard) throws {
        try checkOwnership(human, allowSeedTransition: false, cleanup: false, foregroundCleanup: true)
    }
    private func checkOwnership(_ human: HumanControlGuard, allowSeedTransition: Bool, cleanup: Bool, foregroundCleanup: Bool = false) throws {
        // Blocking verification precedes the final ownership snapshot. Taken may
        // be processed during those reads; never cache its earlier absence.
        let identitiesNow = identitiesMatch()
        let decision = lock.withLock { () -> (pid_t?, UInt64, Bool, Bool, Bool) in
            let healthyNow: Bool
            if healthy, !stopRequested, let metadata = metadataTap, let keyboard = keyboardTap {
                healthyNow = CGEvent.tapIsEnabled(tap: metadata) && CGEvent.tapIsEnabled(tap: keyboard) && pointerMonitor?.isHealthy == true
            } else { healthyNow = false }
            let focus = api.pid()
            let rawForeground = LiveForeground.pid()
            let transition = allowSeedTransition && state.seedWaitEligible(nowNs: DispatchTime.now().uptimeNanoseconds)
            let foreground = foregroundCleanup ? activationForeground(rawForeground, cleanup: true) : (transition ? activationForeground(rawForeground) : rawForeground)
            let allowed = foregroundCleanup ? state.permitsCleanupOwnership(focusPid: focus, foregroundPid: foreground) : cleanup ? state.permitsCleanupOwnership(focusPid: focus, foregroundPid: foreground) :
                state.permitsOwnership(focusPid: focus, foregroundPid: foreground, allowSeedTransition: transition)
            return (focus, DispatchTime.now().uptimeNanoseconds, allowed, state.present, healthyNow)
        }
        let (focus, focusObservedNs, ownershipAllowed, recordAtDecision, healthyNow) = decision
        guard healthyNow, identitiesNow, ownershipAllowed else {
            let details: Object = lock.withLock {
                ["phase": "keyboard-protection-failure", "targetPid": session.target.pid, "victimPid": victim,
                 "observedFocusPid": focus ?? -1, "focusObservedNs": focusObservedNs, "failedCheckNs": DispatchTime.now().uptimeNanoseconds, "recordAtDecision": recordAtDecision, "foregroundPid": human.lastSample.foregroundPid,
                 "healthy": healthyNow, "identitiesVerified": identitiesNow, "allowSeedTransition": allowSeedTransition, "cleanup": cleanup,
                 "recordPresent": state.present, "released": state.released, "returned": state.returned, "ownSeedIssued": state.ownSeedIssued,
                 "metadata": metadataTrace, "runLoopReadyNs": runLoopReadyNs]
            }
            if let data = try? JSONSerialization.data(withJSONObject: details, options: [.sortedKeys]) {
                var frame = data; frame.append(10); try? FileHandle.standardError.write(contentsOf: frame)
            }
            stopped(session)
            try fail("unsupported", "Keyboard protection lost verified ownership; computer input stopped")
        }
    }
    private func start() {
        Thread { [self] in
            let context = Unmanaged.passUnretained(self).toOpaque()
            let metadata = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .tailAppendEventTap,
                options: .defaultTap, eventsOfInterest: CGEventMask(1) << 21, callback: Self.metadataCallback, userInfo: context)
            let keyboard = CGEvent.tapCreateForPid(pid: session.target.pid, place: .tailAppendEventTap, options: .defaultTap,
                eventsOfInterest: (CGEventMask(1) << 10) | (CGEventMask(1) << 11) | (CGEventMask(1) << 12),
                callback: Self.keyboardCallback, userInfo: context)
            guard let metadata = metadata, let keyboard = keyboard,
                  let metadataSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, metadata, 0),
                  let keyboardSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, keyboard, 0) else {
                if let tap = metadata { CFMachPortInvalidate(tap) }; if let tap = keyboard { CFMachPortInvalidate(tap) }
                ready.signal(); ended.signal(); return
            }
            let runLoop = CFRunLoopGetCurrent()
            CFRunLoopAddSource(runLoop, metadataSource, .commonModes); CFRunLoopAddSource(runLoop, keyboardSource, .commonModes)
            CGEvent.tapEnable(tap: metadata, enable: true); CGEvent.tapEnable(tap: keyboard, enable: true)
            lock.withLock {
                loop = runLoop; metadataTap = metadata; keyboardTap = keyboard
                healthy = !stopRequested && CGEvent.tapIsEnabled(tap: metadata) && CGEvent.tapIsEnabled(tap: keyboard)
            }
            // A healthy port alone is not a running callback loop. Acknowledge
            // from a block executed by this loop before permitting any seed.
            CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue) { [self] in
                lock.withLock { runLoopReadyNs = DispatchTime.now().uptimeNanoseconds }
                ready.signal()
            }
            while !lock.withLock({ stopRequested }) { CFRunLoopRunInMode(.defaultMode, 0.05, false) }
            CFMachPortInvalidate(metadata); CFMachPortInvalidate(keyboard)
            lock.withLock { healthy = false; loop = nil; metadataTap = nil; keyboardTap = nil }
            ended.signal()
        }.start()
    }
    private func stop() {
        pointerMonitor?.stop()
        let runLoop = lock.withLock { () -> CFRunLoop? in
            stopRequested = true; healthy = false; state.retireProtection(); return loop
        }
        if let runLoop = runLoop { CFRunLoopWakeUp(runLoop) }
        _ = ended.wait(timeout: .now() + 1)
    }
    private func safeToRetire() -> Bool {
        if processReplacedOrExited(session.target.pid, session.identity) { return true }
        guard (try? ProcessIdentity(session.target.pid)) == session.identity else { return false }
        // Deliberate human takeover belongs to the human; never restore an old victim.
        if LiveForeground.pid() == session.target.pid { return true }
        if lock.withLock({ state.ownSeedIssued }) && !confirmOwnSeedCleanup() { return false }
        return lock.withLock {
            let foreground = LiveForeground.pid(), focus = api.pid()
            guard foreground == LiveForeground.pid() else { return false }
            return state.permitsRetirement(foregroundPid: foreground, focusPid: focus, processGone: false)
        }
    }
    private func retiredSafely() {
        stop(); finished = true
        if announced {
            announced = false; NativeProtectionActivity.release(protectionID)
        }
    }
    @discardableResult func finish() -> Bool {
        if finished { return true }
        // Retained keyboard protection does not retain movement observation.
        pointerMonitor?.stop()
        // Raw scopes have already paired releases and attempted13/2 before here.
        if safeToRetire() { retiredSafely(); return true }
        focusQuarantine[session.target.pid] = session.identity
        Self.retained[session.target.pid] = self
        stopped(session)
        return false
    }
    static func reap() {
        for (pid, lease) in retained where lease.safeToRetire() { lease.retiredSafely(); retained.removeValue(forKey: pid) }
    }
    static func awaitSafeShutdown() {
        // EOF/Stop cannot discard protection over a still-owned keyboard theft.
        // The main AppKit loop remains responsive until ownership is safe.
        repeat { reap(); if !retained.isEmpty { Thread.sleep(forTimeInterval: 0.05) } } while !retained.isEmpty
    }
    private func disabled(_ type: CGEventType) -> Bool {
        guard type == .tapDisabledByTimeout || type == .tapDisabledByUserInput else { return false }
        lock.withLock { healthy = false } // Never auto-enable a user-disabled tap.
        stopped(session); return true
    }
    private static let metadataCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let lease = Unmanaged<FocusProtection>.fromOpaque(context).takeUnretainedValue()
        if lease.disabled(type) { return Unmanaged.passUnretained(event) }
        guard type.rawValue == 21 else { return Unmanaged.passUnretained(event) }
        let enteredNs = DispatchTime.now().uptimeNanoseconds
        let subtype = UInt16(truncatingIfNeeded: event.getIntegerValueField(CGEventField(rawValue: 64)!))
        let target = event.getIntegerValueField(.eventTargetUnixProcessID)
        let affected = event.getIntegerValueField(CGEventField(rawValue: 73)!)
        let owned = [Int64(lease.session.target.pid), Int64(lease.victim)].contains(target) || [Int64(lease.session.target.pid), Int64(lease.victim)].contains(affected)
        if owned { lease.lock.withLock {
            if lease.metadataTrace.count < 32 { lease.metadataTrace.append(["phase": "callback-entry", "enteredNs": enteredNs, "subtype": subtype, "targetPid": target, "affectedPid": affected]) }
        } }
        let verified = lease.identitiesMatch()
        if owned { lease.lock.withLock {
            if lease.metadataTrace.count < 32 { lease.metadataTrace.append(["phase": "callback-identity-check", "subtype": subtype, "verified": verified, "durationMs": Double(DispatchTime.now().uptimeNanoseconds - enteredNs) / 1_000_000]) }
        } }
        guard verified else {
            lease.lock.withLock {
                lease.healthy = false
                if processReplacedOrExited(lease.session.target.pid, lease.session.identity) || processReplacedOrExited(lease.victim, lease.victimIdentity) { lease.state.retire() }
            }
            stopped(lease.session); return Unmanaged.passUnretained(event)
        }
        // A new human foreground choice must not trigger restoration of the old victim.
        let rawForeground = LiveForeground.pid()
        let foreground = lease.lock.withLock { lease.activationForeground(rawForeground, cleanup: true) }
        if foreground != lease.victim {
            lease.lock.withLock {
                if foreground == lease.session.target.pid {
                    lease.humanTakeoverAccepted = true; lease.state.retireProtection()
                } else { lease.state.retire() }
                lease.healthy = false
            }
            stopped(lease.session); return Unmanaged.passUnretained(event)
        }
        let token = event.getIntegerValueField(CGEventField(rawValue: 71)!)
        var releaseFailed = false
        let effect = lease.lock.withLock { () -> FocusRoutingState.Effect in
            guard !lease.stopRequested else { return .pass }
            let effect = lease.state.notification(subtype, targetPid: target, affectedPid: affected)
            if effect == .release && !lease.api.release(token) { lease.healthy = false; releaseFailed = true }
            return effect
        }
        if releaseFailed { stopped(lease.session) }
        if effect == .suppress { return nil }
        return Unmanaged.passUnretained(event)
    }
    private static let keyboardCallback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let lease = Unmanaged<FocusProtection>.fromOpaque(context).takeUnretainedValue()
        if lease.disabled(type) { return Unmanaged.passUnretained(event) }
        let source = event.getIntegerValueField(.eventSourceUnixProcessID)
        let target = event.getIntegerValueField(.eventTargetUnixProcessID)
        // Identity and live ownership reads may block; no stale routing decision
        // survives those reads. Recheck the record under its lock at dispatch.
        guard source != Int64(getpid()) else { return Unmanaged.passUnretained(event) }
        let identities = lease.identitiesMatch()
        let decision = FocusRoutingState.withLockedOwnership(lease.lock, sample: {
            let first = LiveForeground.pid(), focus = lease.api.pid(), second = LiveForeground.pid()
            return (first == second ? second : nil, focus)
        }) { foreground, focus -> FocusRoutingState.KeyboardDisposition in
            let health = lease.healthy && !lease.stopRequested && lease.metadataTap.map { CGEvent.tapIsEnabled(tap: $0) } == true && lease.keyboardTap.map { CGEvent.tapIsEnabled(tap: $0) } == true
            let decision = lease.state.keyboardDisposition(sourcePid: source, targetPid: target, helperPid: getpid(),
                foregroundPid: lease.activationForeground(foreground, cleanup: true), focusPid: focus, healthy: health, identitiesVerified: identities)
            switch decision {
            case .forward:
                event.postToPid(lease.victim) // Opaque packet; no characters/keycodes.
            case .humanTakeover:
                lease.humanTakeoverAccepted = true; lease.state.retireProtection(); lease.healthy = false
            case .consume:
                lease.state.retire(); lease.healthy = false // Own-seed safety remains through cleanup.
            case .pass: break
            }
            return decision
        }
        if decision == .consume || decision == .humanTakeover { stopped(lease.session) }
        return decision == .forward || decision == .consume ? nil : Unmanaged.passUnretained(event)
    }
}
