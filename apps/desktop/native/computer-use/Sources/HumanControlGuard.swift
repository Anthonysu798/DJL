import AppKit
import CoreGraphics
import Dispatch

// Public HID-state counts only: no key contents, event hooks, cursor writes or prompts.
struct HumanControlSample: Equatable {
    static let pointerTypes: [CGEventType] = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
    let foregroundPid: pid_t
    let cursor: CGPoint
    let pointerCount: UInt64
    let inputCount: UInt64
    let observedAtNs: UInt64

    init(foregroundPid: pid_t, cursor: CGPoint, pointerCount: UInt64, inputCount: UInt64, observedAtNs: UInt64 = 0) {
        self.foregroundPid = foregroundPid; self.cursor = cursor
        self.pointerCount = pointerCount; self.inputCount = inputCount; self.observedAtNs = observedAtNs
    }

    static func capture() throws -> HumanControlSample {
        let pointer = pointerTypes
        let input = pointer + [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                               .otherMouseDown, .otherMouseUp, .keyDown, .keyUp, .flagsChanged, .scrollWheel]
        func counts() -> (UInt64, UInt64) {
            func total(_ types: [CGEventType]) -> UInt64 {
                types.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.hidSystemState, eventType: $1)) }
            }
            return (total(pointer), total(input))
        }
        // Retry torn reads. A stable HID counter can still precede its cursor
        // update; the guard attributes that ordering using movement destinations.
        for _ in 0..<4 {
            let before = counts()
            guard let foreground = LiveForeground.pid(),
                  let cursor = CGEvent(source: nil)?.location else { throw HumanControlViolation.unavailableSample }
            let observedAtNs = DispatchTime.now().uptimeNanoseconds
            let after = counts()
            if before == after && LiveForeground.pid() == foreground {
                return HumanControlSample(foregroundPid: foreground, cursor: cursor,
                                          pointerCount: after.0, inputCount: after.1, observedAtNs: observedAtNs)
            }
        }
        throw HumanControlViolation.unstableSample
    }
    static func pointerCounter() -> UInt64 {
        pointerTypes.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.hidSystemState, eventType: $1)) }
    }
}

enum HumanControlViolation: Error, Equatable {
    case targetForeground
    case unattributedPointerChange
    case unattributedForegroundChange
    case unstableSample
    case unavailableSample

    var message: String {
        switch self {
        case .targetForeground: return "Target became the human foreground app; computer input stopped"
        case .unattributedPointerChange: return "Cursor change could not be attributed to verified HID movement; computer input stopped"
        case .unattributedForegroundChange: return "Foreground changed without new HID input; computer input stopped"
        case .unstableSample: return "Could not obtain a stable human-control sample; computer input stopped"
        case .unavailableSample: return "Human-control state is unavailable; computer input stopped"
        }
    }
}

// This pure policy is exercised with synthetic samples in unit tests. The shared
// instance belongs to one serialized operation and updates even when only counters
// changed, so earlier input cannot authorize a later unrelated warp or focus steal.
final class HumanControlGuard {
    let targetPid: pid_t
    private(set) var lastSample: HumanControlSample
    private struct Movement { let point: CGPoint; let time: UInt64; let requiredCounter: UInt64 }
    private struct Observation { let point: CGPoint; let time: UInt64 }
    private let pointerLock = NSLock()
    private let scopeStartNs: UInt64
    private let scopePointerCount: UInt64
    private var pending: [Movement] = []
    private var observations: [Observation]
    private var lastEventNs: UInt64 = 0
    private var consumedEventNs: UInt64 = 0
    private var historyFloorNs: UInt64 = 0
    private var evidenceValid = true

    init(targetPid: pid_t, initial: HumanControlSample) {
        self.targetPid = targetPid; self.lastSample = initial
        scopeStartNs = initial.observedAtNs
        scopePointerCount = initial.pointerCount
        observations = [Observation(point: initial.cursor, time: initial.observedAtNs)]
        pending.reserveCapacity(64); observations.reserveCapacity(64)
    }
    func recordPointerMovement(type: CGEventType, point: CGPoint, sourcePid: Int64, sourceState: Int64,
                               eventTimeNs: UInt64, receivedTimeNs: UInt64, counter: UInt64) {
        guard HumanControlSample.pointerTypes.contains(type),
              sourcePid == 0, sourceState == 1, point.x.isFinite, point.y.isFinite,
              eventTimeNs > 0, eventTimeNs >= scopeStartNs, eventTimeNs <= receivedTimeNs else { return }
        pointerLock.withLock {
            guard evidenceValid, eventTimeNs > lastEventNs, eventTimeNs > consumedEventNs,
                  eventTimeNs > historyFloorNs else { return }
            guard counter >= scopePointerCount, scopePointerCount < UInt64.max else {
                evidenceValid = false; pending.removeAll(); return
            }
            lastEventNs = eventTimeNs
            if observations.contains(where: { $0.point == point && $0.time >= eventTimeNs }) {
                consumedEventNs = max(consumedEventNs, eventTimeNs)
                pending.removeAll { $0.time <= consumedEventNs }
                return
            }
            guard pending.count < 64 else { evidenceValid = false; pending.removeAll(); return }
            pending.append(Movement(point: point, time: eventTimeNs,
                requiredCounter: max(scopePointerCount + 1, counter)))
        }
    }
    func invalidatePointerEvidence() {
        pointerLock.withLock { evidenceValid = false; pending.removeAll(); observations.removeAll() }
    }
    func accept(_ current: HumanControlSample) throws {
        pointerLock.lock(); defer { pointerLock.unlock() }
        if current.foregroundPid == targetPid { throw HumanControlViolation.targetForeground }
        let matching = evidenceValid ? pending.lastIndex(where: {
            $0.point == current.cursor && $0.time <= current.observedAtNs
        }) : nil
        if current.cursor != lastSample.cursor && current.pointerCount <= lastSample.pointerCount {
            guard current.pointerCount == lastSample.pointerCount, let matching = matching,
                  pending[matching].requiredCounter <= current.pointerCount else {
                throw HumanControlViolation.unattributedPointerChange
            }
        }
        if current.foregroundPid != lastSample.foregroundPid && current.inputCount <= lastSample.inputCount {
            throw HumanControlViolation.unattributedForegroundChange
        }
        if current.pointerCount < lastSample.pointerCount {
            evidenceValid = false; pending.removeAll(); observations.removeAll()
        } else if current.cursor != lastSample.cursor {
            if let matching = matching {
                consumedEventNs = max(consumedEventNs, pending[matching].time)
                pending.removeAll { $0.time <= consumedEventNs }
            }
            observations.append(Observation(point: current.cursor, time: current.observedAtNs))
            if observations.count > 64 {
                historyFloorNs = max(historyFloorNs, observations.removeFirst().time)
                pending.removeAll { $0.time <= historyFloorNs }
            }
        }
        lastSample = current
    }
    func acceptActivation(_ sample: HumanControlSample, _ authority: ForegroundRestorationAuthority) throws { try acceptScopedForeground(sample, authority, cleanup: false) }
    func acceptForegroundCleanup(_ sample: HumanControlSample, _ authority: ForegroundRestorationAuthority) throws { try acceptScopedForeground(sample, authority, cleanup: true) }
    func checkForegroundCleanup(_ authority: ForegroundRestorationAuthority) throws { try acceptForegroundCleanup(HumanControlSample.capture(), authority) }
    private func acceptScopedForeground(_ sample: HumanControlSample, _ authority: ForegroundRestorationAuthority, cleanup: Bool) throws {
        let permitted = cleanup ? authority.permitsCleanupTargetForeground(sample.foregroundPid, at: sample.observedAtNs) : authority.permitsTargetForeground(sample.foregroundPid, at: sample.observedAtNs)
        if authority.target == targetPid && authority.victim == lastSample.foregroundPid && permitted {
            try accept(HumanControlSample(foregroundPid: authority.victim, cursor: sample.cursor,
                pointerCount: sample.pointerCount, inputCount: sample.inputCount, observedAtNs: sample.observedAtNs))
        } else { try accept(sample) }
    }
    func checkActivation(_ authority: ForegroundRestorationAuthority) throws { try acceptActivation(HumanControlSample.capture(), authority) }
    func check() throws { try accept(HumanControlSample.capture()) }
}
