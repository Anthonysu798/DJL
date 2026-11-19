import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

// Owned-app restoration experiment. This adapter is not in production.
final class ActivationScope {
    private static let retentionLock = NSLock()
    private static var retained: [UUID: ActivationScope] = [:]
    private let resourceID = UUID()
    static func awaitSafeShutdown() {
        while true {
            let scopes = retentionLock.withLock { Array(retained.values) }
            if scopes.isEmpty { return }
            scopes.forEach { _ = $0.finish() }
            Thread.sleep(forTimeInterval: 0.05)
        }
    }
    private typealias Connection = @convention(c) () -> Int32
    private typealias Update = @convention(c) (Int32) -> Int32
    private enum Role { case victim, target, choice }
    private final class Context {
        unowned let scope: ActivationScope
        let role: Role
        init(_ scope: ActivationScope, role: Role) { self.scope = scope; self.role = role }
    }
    private let session: Session
    private let victim: pid_t
    let authority: ForegroundRestorationAuthority
    private let human: HumanControlGuard
    private let victimIdentity: ProcessIdentity
    private let savedWindow: (element: AXUIElement, id: UInt32)?
    private let lock = NSLock()
    private let finishLock = NSLock()
    private var releasedForegroundResult: Bool?
    private var callbacksRetiring = false
    private let ready = DispatchSemaphore(value: 0)
    private var completion: ActivationLoopCompletion?
    private var stopRequested = false, healthy = false, armed = false, closing = false
    private var ports: [CFMachPort] = []
    private var contexts: [Context] = []
    private var loop: CFRunLoop?
    private var lastEventNs = DispatchTime.now().uptimeNanoseconds
    private var victimEvents = 0, targetEvents = 0, targetDeactivationsSuppressed = 0, raises = 0
    private var lastRaiseNs: UInt64 = 0
    private var lastRestoreNs: UInt64 = 0
    private var foregroundRequests = 0
    private var awaitingForegroundAck = false, victimActivated = false, targetDeactivated = false
    private let updates: ActivationUpdateLease
    private var watchdog: DispatchSourceTimer?
    init(session: Session, victim: pid_t, human: HumanControlGuard, validate: () throws -> Void) throws {
        self.session = session; self.victim = victim; self.human = human; victimIdentity = try ProcessIdentity(victim)
        guard ApplicationScopePolicy.permitsBackgroundPair(helperPID: getpid(), targetPID: session.target.pid, foregroundPID: victim,
              userID: geteuid(), targetUserID: session.identity.ownerUserID, foregroundUserID: victimIdentity.ownerUserID),
              try ProcessIdentity(session.target.pid) == session.identity,
              let priorApp = NSRunningApplication(processIdentifier: victim), !priorApp.isTerminated,
              let priorExecutable = priorApp.executableURL,
              priorExecutable.resolvingSymlinksInPath().standardizedFileURL == victimIdentity.executable,
              let targetExecutable = session.app.executableURL,
              targetExecutable.resolvingSymlinksInPath().standardizedFileURL == session.identity.executable,
              LiveForeground.pid() == victim else {
            try fail("unsupported", "Background activation lacks fresh same-user process bindings")
        }
        savedWindow = ActivationWindowMetadata.focusedWindow(victim)
        guard let savedWindow = savedWindow, ActivationWindowMetadata.belongs(session.target.window, to: session.target.pid),
              try ProcessIdentity(victim) == victimIdentity, LiveForeground.pid() == victim else {
            try fail("unsupported", "Foreground or target window ownership is unavailable")
        }
        authority = ForegroundRestorationAuthority(helper: getpid(), victim: victim, target: session.target.pid, targetWindow: session.target.window, priorWindow: savedWindow.id, createdAtNs: DispatchTime.now().uptimeNanoseconds)
        guard let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/SkyLight", RTLD_NOW | RTLD_LOCAL),
              let readPointer = dlsym(library, "CGSMainConnectionID"), let disablePointer = dlsym(library, "SLSDisableUpdate"), let enablePointer = dlsym(library, "SLSReenableUpdate") else {
            try fail("unsupported", "Activation update bindings are unavailable")
        }
        let connection = unsafeBitCast(readPointer, to: Connection.self)()
        guard connection > 0 else { try fail("unsupported", "Activation connection is unavailable") }
        let disable = unsafeBitCast(disablePointer, to: Update.self), reenable = unsafeBitCast(enablePointer, to: Update.self)
        updates = ActivationUpdateLease(connection: connection, disable: disable, reenable: reenable)
        start()
        guard ready.wait(timeout: .now() + 1) == .success, isHealthy else {
            _ = stopTaps(); try fail("unsupported", "All activation/handoff callback loops must be ready")
        }
        do { try validate() } catch { _ = stopTaps(); throw error }
        guard updates.begin() else {
            _ = stopTaps(); try fail("unsupported", "Cannot acquire activation update lease")
        }
        Self.retentionLock.withLock { Self.retained[resourceID] = self }
        NativeProtectionActivity.acquire(resourceID)
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInteractive))
        timer.schedule(deadline: .now() + 2, repeating: .milliseconds(50))
        timer.setEventHandler { [self] in trace("activation-watchdog-fired"); stopped(session); _ = finish() }
        watchdog = timer; timer.resume()
        trace("scope-started", ["savedVictimWindow": savedWindow.id])
    }
    private func identitiesMatch() -> Bool {
        (try? ProcessIdentity(session.target.pid)) == session.identity && (try? ProcessIdentity(victim)) == victimIdentity
    }
    var isHealthy: Bool { lock.withLock { healthy && !stopRequested && !closing && ports.count == 3 && ports.allSatisfy { CGEvent.tapIsEnabled(tap: $0) } } }
    var hasActiveResources: Bool { lock.withLock { healthy && !stopRequested && !callbacksRetiring && ports.count == 3 && ports.allSatisfy { CGEvent.tapIsEnabled(tap: $0) } } }
    var settled: Bool { lock.withLock { let now = DispatchTime.now().uptimeNanoseconds; return healthy && armed && !stopRequested && !closing && (!awaitingForegroundAck || (victimActivated && targetDeactivated)) && now >= lastEventNs && now - lastEventNs >= 100_000_000 } }
    func arm() throws {
        try lock.withLock {
            guard healthy && !stopRequested && !closing && ports.count == 3 && ports.allSatisfy({ CGEvent.tapIsEnabled(tap: $0) }) else { try fail("unsupported", "Activation scope cannot arm") }
            guard authority.arm(at: DispatchTime.now().uptimeNanoseconds) else { try fail("unsupported", "Human input revoked activation before arming") }
            armed = true; lastEventNs = DispatchTime.now().uptimeNanoseconds
        }
    }
    func noteEnforcerEvent(_ event: CGEvent) { lock.withLock { lastEventNs = DispatchTime.now().uptimeNanoseconds } }
    func repairVictimWindow(cleanup: Bool = false) throws -> Bool {
        if LiveForeground.pid() != victim { _ = try restoreForegroundIfNeeded(cleanup: cleanup); return false }
        guard let saved = savedWindow else { return true }
        let current = ActivationWindowMetadata.focusedWindow(victim)
        let order = ActivationWindowMetadata.orderedIDs()
        let decision = windowRepairDecision(victim: victim, foreground: LiveForeground.pid(), saved: saved.id, current: current?.id,
            targetIndex: order?.firstIndex(of: session.target.window), savedIndex: order?.firstIndex(of: saved.id), identitiesValid: identitiesMatch())
        switch decision {
        case .none: return true
        case .wait: return false
        case .handoff: try fail("unsupported", "Human foreground/window choice changed; window repair stopped")
        case .raiseSaved:
            let now = DispatchTime.now().uptimeNanoseconds
            guard lock.withLock({ now >= lastRaiseNs && now - lastRaiseNs >= 50_000_000 }) else { return false }
            if cleanup {
                guard authority.beginCleanup(at: DispatchTime.now().uptimeNanoseconds) else { try fail("unsupported", "Saved-window cleanup authority expired") }
                try human.checkForegroundCleanup(authority)
            }
            try session.dispatch(release: cleanup) {
                guard (cleanup ? hasActiveResources : isHealthy) && identitiesMatch() && LiveForeground.pid() == victim,
                      ActivationWindowMetadata.focusedWindow(victim)?.id == saved.id,
                      ActivationWindowMetadata.belongs(saved.id, to: victim), LiveForeground.pid() == victim else {
                    try fail("unsupported", "Prior window lacks fresh restoration authority")
                }
                guard AXUIElementPerformAction(saved.element, kAXRaiseAction as CFString) == .success else { try fail("unsupported", "Owned prior window rejected AXRaise") }
            }
            lock.withLock { raises += 1; lastEventNs = DispatchTime.now().uptimeNanoseconds; lastRaiseNs = lastEventNs }
            trace("saved-window-raised", ["savedVictimWindow": saved.id]); return false
        }
    }
    private func restoreForegroundIfNeeded(cleanup: Bool = false) throws -> Bool {
        let foreground = LiveForeground.pid()
        if foreground == victim { return true }
        func permitted(_ pid: pid_t?) -> Bool {
            let now = DispatchTime.now().uptimeNanoseconds
            return cleanup ? authority.permitsCleanupTargetForeground(pid, at: now) : authority.permitsTargetForeground(pid, at: now)
        }
        guard (cleanup ? hasActiveResources : isHealthy) && identitiesMatch() && permitted(foreground) else {
            try fail("unsupported", "Foreground is not an owned activation transition")
        }
        if cleanup { try human.checkForegroundCleanup(authority); try session.focusProtection?.checkForegroundCleanup(human) }
        else { try human.checkActivation(authority); try session.focusProtection?.check(human, allowSeedTransition: true) }
        let focus = session.focusProtection?.currentKeyboardOwner
        guard focus == victim || focus == session.target.pid else { try fail("unsupported", "Unknown keyboard owner prevents foreground restoration") }
        let now = DispatchTime.now().uptimeNanoseconds
        let issue = lock.withLock { () -> Bool in
            guard now >= lastRestoreNs && now - lastRestoreNs >= 50_000_000 else { return false }
            lastRestoreNs = now; lastEventNs = now; foregroundRequests += 1
            awaitingForegroundAck = true; victimActivated = false; targetDeactivated = false; return true
        }
        guard issue else { return false }
        try session.dispatch(release: true) {
            if cleanup { try human.checkForegroundCleanup(authority) } else { try human.checkActivation(authority) }
            guard (cleanup ? hasActiveResources : isHealthy) && identitiesMatch(),
                  permitted(LiveForeground.pid()),
                  let prior = NSRunningApplication(processIdentifier: victim),
                  savedWindow.map({ ActivationWindowMetadata.belongs($0.id, to: victim) }) == true else {
                try fail("unsupported", "Prior app lost fresh restoration authority")
            }
            guard prior.activate(options: []) else { try fail("unsupported", "Prior app activation request was rejected") }
        }
        trace("foreground-restore-requested")
        return false
    }
    private func settleReleasedForeground() -> Bool {
        while true {
            if authority.handoff { return true }
            do {
                if LiveForeground.pid() == session.target.pid { _ = try restoreForegroundIfNeeded(cleanup: true) }
                if LiveForeground.pid() == victim, session.focusProtection?.currentKeyboardOwner == victim {
                    let repaired = try repairVictimWindow(cleanup: true)
                    let quiet = lock.withLock { () -> Bool in
                        let now = DispatchTime.now().uptimeNanoseconds
                        return healthy && (!awaitingForegroundAck || (victimActivated && targetDeactivated)) && now >= lastEventNs && now - lastEventNs >= 100_000_000
                    }
                    if repaired && quiet { return true }
                }
            } catch { trace("released-foreground-cleanup-error"); return false }
            guard authority.beginCleanup(at: DispatchTime.now().uptimeNanoseconds) else { return false }
            Thread.sleep(forTimeInterval: 0.005)
        }
    }
    @discardableResult func finish() -> Bool {
        // Worker, watchdog and EOF may all close the same scope. One caller owns
        // release/settlement; later callers only wait for producer completion.
        finishLock.lock(); defer { finishLock.unlock() }
        if releasedForegroundResult == nil {
            _ = authority.beginCleanup(at: DispatchTime.now().uptimeNanoseconds)
            do {
                while LiveForeground.pid() == session.target.pid && authority.permitsCleanupTargetForeground(session.target.pid, at: DispatchTime.now().uptimeNanoseconds) {
                    _ = try restoreForegroundIfNeeded(cleanup: true); Thread.sleep(forTimeInterval: 0.005)
                }
            } catch { trace("foreground-cleanup-incomplete") }
            lock.withLock { closing = true }
            // Filtering and cleanup authority survive the release call and any
            // notifications it flushes. No ordinary input is authorized here.
            guard updates.finish() else { trace("update-lease-retained", ["held": updates.isHeld]); return false }
            releasedForegroundResult = settleReleasedForeground()
            lock.withLock { armed = false; callbacksRetiring = true; healthy = false }
            authority.end()
        }
        let ended = stopTaps()
        if ended {
            lock.withLock { watchdog?.cancel(); watchdog = nil }
            _ = Self.retentionLock.withLock { Self.retained.removeValue(forKey: resourceID) }
            NativeProtectionActivity.release(resourceID); trace("update-lease-released")
        }
        let foregroundClean = releasedForegroundResult == true
        trace("scope-restored", lock.withLock { ["loopEnded": ended, "foregroundClean": foregroundClean, "victimEvents": victimEvents, "targetEvents": targetEvents, "targetDeactivationsSuppressed": targetDeactivationsSuppressed, "raises": raises, "foregroundRequests": foregroundRequests, "victimActivationAck": victimActivated, "targetDeactivationAck": targetDeactivated] })
        return ended && foregroundClean
    }
    private func start() {
        let completion = ActivationLoopCompletion()
        self.completion = completion
        Thread { [self, completion] in
            contexts = [Context(self, role: .victim), Context(self, role: .target), Context(self, role: .choice)]
            var created: [CFMachPort] = [], sources: [CFRunLoopSource] = []
            for context in contexts {
                let pointer = Unmanaged.passUnretained(context).toOpaque()
                let candidate: CFMachPort?
                if context.role == .choice {
                    candidate = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                        eventsOfInterest: CGEventMask(1) << CGEventType.leftMouseDown.rawValue, callback: Self.callback, userInfo: pointer)
                } else {
                    candidate = CGEvent.tapCreateForPid(pid: context.role == .victim ? victim : session.target.pid, place: .tailAppendEventTap, options: .defaultTap,
                        eventsOfInterest: (CGEventMask(1) << 13) | (CGEventMask(1) << 19) | (CGEventMask(1) << 20), callback: Self.callback, userInfo: pointer)
                }
                guard let port = candidate else { break }
                created.append(port)
                guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0) else { break }
                sources.append(source)
            }
            guard created.count == 3 && sources.count == 3 else {
                created.forEach { CFMachPortInvalidate($0) }; completion.markEnded(); ready.signal(); return
            }
            let runLoop = CFRunLoopGetCurrent()
            for (port, source) in zip(created, sources) { CFRunLoopAddSource(runLoop, source, .commonModes); CGEvent.tapEnable(tap: port, enable: true) }
            lock.withLock { ports = created; loop = runLoop; healthy = !stopRequested && created.allSatisfy { CGEvent.tapIsEnabled(tap: $0) } }
            CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue) { [self] in ready.signal() }
            while !lock.withLock({ stopRequested }) { CFRunLoopRunInMode(.defaultMode, 0.05, false) }
            created.forEach { CFMachPortInvalidate($0) }
            lock.withLock { healthy = false; ports = []; loop = nil }
            completion.markEnded()
        }.start()
    }
    private func stopTaps() -> Bool {
        authority.end()
        let state = lock.withLock { () -> ([CFMachPort], CFRunLoop?) in stopRequested = true; armed = false; healthy = false; return (ports, loop) }
        state.0.forEach { CFMachPortInvalidate($0) }
        if let loop = state.1 { CFRunLoopStop(loop); CFRunLoopWakeUp(loop) }
        return completion?.wait(until: .now() + 1) ?? false
    }
    private static let callback: CGEventTapCallBack = { _, type, event, pointer in
        guard let pointer = pointer else { return Unmanaged.passUnretained(event) }
        let context = Unmanaged<Context>.fromOpaque(pointer).takeUnretainedValue(); let scope = context.scope
        guard !scope.lock.withLock({ scope.stopRequested || scope.callbacksRetiring }) else { return Unmanaged.passUnretained(event) }
        if scope.authority.handoff { return Unmanaged.passUnretained(event) }
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            scope.lock.withLock { scope.healthy = false }; scope.authority.end(); stopped(scope.session)
            return Unmanaged.passUnretained(event)
        }
        if context.role == .choice {
            if type == .leftMouseDown && scope.authority.outsideClick(source: event.getIntegerValueField(.eventSourceUnixProcessID),
                receiver: event.getIntegerValueField(.eventTargetUnixProcessID), window: event.getIntegerValueField(.mouseEventWindowUnderMousePointer), at: event.timestamp) {
                scope.trace("outside-choice-revoked-restoration"); humanStopped(scope.session)
            }
            return Unmanaged.passUnretained(event)
        }
        let foreground = LiveForeground.pid()
        guard scope.identitiesMatch(), foreground == scope.victim || scope.authority.permitsManagedTargetForeground(foreground, at: DispatchTime.now().uptimeNanoseconds) else {
            scope.lock.withLock { scope.healthy = false }; scope.authority.end(); stopped(scope.session); return Unmanaged.passUnretained(event)
        }
        let suppress = scope.lock.withLock { () -> Bool in
            guard !scope.stopRequested && scope.armed else { return false }
            let subtype = event.getIntegerValueField(CGEventField(rawValue: 83)!)
            scope.lastEventNs = DispatchTime.now().uptimeNanoseconds
            if context.role == .victim {
                scope.victimEvents += 1
                if type.rawValue == 20 || (type.rawValue == 13 && subtype == 1) { scope.victimActivated = true }
                return type.rawValue == 19 || type.rawValue == 20 || (type.rawValue == 13 && [1, 2, 22, 23].contains(subtype))
            }
            scope.targetEvents += 1
            let deactivation = type.rawValue == 19 || (type.rawValue == 13 && subtype == 2)
            if deactivation { scope.targetDeactivationsSuppressed += 1; scope.targetDeactivated = true }
            return deactivation || (type.rawValue == 13 && [22, 23].contains(subtype))
        }
        return suppress ? nil : Unmanaged.passUnretained(event)
    }
    private func trace(_ phase: String, _ fields: Object = [:]) {
        var row = fields; row["phase"] = phase; row["timeNs"] = DispatchTime.now().uptimeNanoseconds
        if var data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) { data.append(10); try? FileHandle.standardError.write(contentsOf: data) }
    }
}
