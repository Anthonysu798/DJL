import CoreGraphics
import Foundation

// Active-operation, listen-only movement metadata. No keys, clicks, app content
// or history are read. A separate loop cannot be stalled by focus callbacks.
final class PointerMovementMonitor {
    private let human: HumanControlGuard
    private let failed: () -> Void
    private let lock = NSLock()
    private let ready = DispatchSemaphore(value: 0)
    private let ended = DispatchSemaphore(value: 0)
    private var stopped = false
    private var healthy = false
    private var loop: CFRunLoop?
    private var tap: CFMachPort?

    init(human: HumanControlGuard, failed: @escaping () -> Void) {
        self.human = human; self.failed = failed
        Thread { [self] in run() }.start()
    }
    func waitUntilReady(_ deadline: DispatchTime) -> Bool {
        ready.wait(timeout: deadline) == .success && isHealthy
    }
    var isHealthy: Bool {
        lock.withLock { healthy && !stopped && tap.map { CGEvent.tapIsEnabled(tap: $0) } == true }
    }
    func stop() {
        let resources = lock.withLock { () -> (CFMachPort?, CFRunLoop?) in
            stopped = true; healthy = false; return (tap, loop)
        }
        if let tap = resources.0 { CFMachPortInvalidate(tap) }
        if let loop = resources.1 { CFRunLoopWakeUp(loop) }
        human.invalidatePointerEvidence()
        if ended.wait(timeout: .now() + 1) == .success { ended.signal() }
    }
    private func run() {
        defer { ready.signal(); ended.signal() }
        guard !lock.withLock({ stopped }) else { return }
        let types = HumanControlSample.pointerTypes
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                options: .listenOnly, eventsOfInterest: mask, callback: Self.callback, userInfo: context) else { return }
        defer {
            CFMachPortInvalidate(port)
            lock.withLock { healthy = false; tap = nil; loop = nil }
        }
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0) else { return }
        let current = CFRunLoopGetCurrent()!
        let admitted = lock.withLock { () -> Bool in
            guard !stopped else { return false }
            tap = port; loop = current; return true
        }
        guard admitted else { return }
        CFRunLoopAddSource(current, source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        CFRunLoopPerformBlock(current, CFRunLoopMode.defaultMode.rawValue) { [self] in
            lock.withLock { healthy = !stopped && CGEvent.tapIsEnabled(tap: port) }
            ready.signal()
        }
        while !lock.withLock({ stopped }) { CFRunLoopRunInMode(.defaultMode, 0.05, false) }
    }
    private static let callback: CGEventTapCallBack = { _, type, event, context in
        guard let context = context else { return Unmanaged.passUnretained(event) }
        let monitor = Unmanaged<PointerMovementMonitor>.fromOpaque(context).takeUnretainedValue()
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            monitor.lock.withLock { monitor.healthy = false; monitor.stopped = true }
            monitor.human.invalidatePointerEvidence(); monitor.failed()
        } else if !monitor.lock.withLock({ monitor.stopped }) {
            monitor.human.recordPointerMovement(type: type, point: event.location,
                sourcePid: event.getIntegerValueField(.eventSourceUnixProcessID),
                sourceState: event.getIntegerValueField(.eventSourceStateID),
                eventTimeNs: event.timestamp, receivedTimeNs: DispatchTime.now().uptimeNanoseconds,
                counter: HumanControlSample.pointerCounter())
        }
        return Unmanaged.passUnretained(event)
    }
}
