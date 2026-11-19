import Foundation
import CoreGraphics

@main
struct HumanControlGuardTests {
    static func sample(_ pid: pid_t = 10, x: CGFloat = 100, y: CGFloat = 100,
                       pointer: UInt64 = 20, input: UInt64 = 40, at: UInt64 = 0) -> HumanControlSample {
        HumanControlSample(foregroundPid: pid, cursor: CGPoint(x: x, y: y), pointerCount: pointer, inputCount: input, observedAtNs: at)
    }
    static func guardState(_ initial: HumanControlSample = sample()) -> HumanControlGuard {
        HumanControlGuard(targetPid: 99, initial: initial)
    }
    static func main() {
        var passed = 0
        var failures: [String] = []
        func run(_ name: String, _ body: () throws -> Void) {
            do { try body(); passed += 1 }
            catch { failures.append("\(name): \(error)") }
        }
        func expect(_ violation: HumanControlViolation, _ body: () throws -> Void) throws {
            do { try body(); throw NSError(domain: "missing-violation", code: 1) }
            catch let actual as HumanControlViolation { if actual != violation { throw actual } }
        }
        run("unchanged state") { try guardState().accept(sample()) }
        run("real pointer movement") {
            let state = guardState(); try state.accept(sample(x: 130, pointer: 21, input: 41))
            assert(state.lastSample.cursor.x == 130)
        }
        run("real other-app focus change") { try guardState().accept(sample(11, input: 41)) }
        run("simultaneous legitimate activity") { try guardState().accept(sample(11, x: 200, y: 130, pointer: 22, input: 44)) }
        run("unattributed pointer warp") { try expect(.unattributedPointerChange) { try guardState().accept(sample(x: 130)) } }
        run("key input does not authorize cursor warp") { try expect(.unattributedPointerChange) { try guardState().accept(sample(x: 130, input: 41)) } }
        run("unattributed other-app focus change") { try expect(.unattributedForegroundChange) { try guardState().accept(sample(11)) } }
        run("target foreground always stops") { try expect(.targetForeground) { try guardState().accept(sample(99, x: 130, pointer: 100, input: 200)) } }
        run("target already foreground stops") { try expect(.targetForeground) { try guardState(sample(99)).accept(sample(99)) } }
        run("earlier key does not authorize later focus") {
            let state = guardState(); try state.accept(sample(input: 41))
            try expect(.unattributedForegroundChange) { try state.accept(sample(11, input: 41)) }
        }
        run("earlier pointer event does not authorize later warp") {
            let state = guardState(); try state.accept(sample(pointer: 21, input: 41))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41)) }
        }
        run("baseline follows each accepted user move") {
            let state = guardState()
            try state.accept(sample(x: 130, pointer: 21, input: 41))
            try state.accept(sample(x: 150, pointer: 22, input: 42))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 170, pointer: 22, input: 42)) }
        }
        run("counter reset cannot authorize movement") {
            try expect(.unattributedPointerChange) { try guardState().accept(sample(x: 130, pointer: 0, input: 0)) }
        }
        run("stationary reset permits fresh later input") {
            let state = guardState(); try state.accept(sample(pointer: 0, input: 0))
            try state.accept(sample(x: 130, pointer: 1, input: 1))
        }
        run("rejection retains prior baseline") {
            let state = guardState(); try expect(.unattributedForegroundChange) { try state.accept(sample(11)) }
            assert(state.lastSample == sample())
        }
        func movement(_ state: HumanControlGuard, x: CGFloat = 130, at: UInt64 = 110,
                      received: UInt64 = 111, source: Int64 = 0, sourceState: Int64 = 1,
                      type: CGEventType = .mouseMoved) {
            state.recordPointerMovement(type: type, point: CGPoint(x: x, y: 100), sourcePid: source,
                sourceState: sourceState, eventTimeNs: at, receivedTimeNs: received, counter: 21)
        }
        run("retained counterexample: event precedes counter-only sample and late cursor") {
            let initial = HumanControlSample(foregroundPid: 10, cursor: CGPoint(x: 347.39453125, y: -402.65625), pointerCount: 7554041, inputCount: 7554041, observedAtNs: 4153833798528416)
            let state = guardState(HumanControlSample(foregroundPid: 10, cursor: initial.cursor, pointerCount: 7554040, inputCount: 7554040, observedAtNs: 4153833797000000))
            state.recordPointerMovement(type: .mouseMoved, point: CGPoint(x: 347.39453125, y: -396.75390625), sourcePid: 0, sourceState: 1,
                eventTimeNs: 4153833797952750, receivedTimeNs: 4153833798006916, counter: 7554041)
            try state.accept(initial)
            try state.accept(HumanControlSample(foregroundPid: 10, cursor: CGPoint(x: 347.39453125, y: -396.75390625), pointerCount: 7554041, inputCount: 7554041, observedAtNs: 4153833802248875))
        }
        run("matching evidence cannot authorize an unrelated destination") {
            let state = guardState(sample(at: 100)); movement(state)
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 140, pointer: 21, input: 41, at: 120)) }
        }
        run("consumed movement cannot authorize a later return") {
            let state = guardState(sample(at: 100)); movement(state)
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120)); try state.accept(sample(x: 140, pointer: 22, input: 42, at: 130))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 22, input: 42, at: 140)) }
        }
        run("late delivery of an already-observed movement cannot be reused") {
            let state = guardState(sample(at: 100)); try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120))
            movement(state, at: 110, received: 130); try state.accept(sample(x: 140, pointer: 22, input: 42, at: 140))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 22, input: 42, at: 150)) }
        }
        run("future event cannot explain an earlier sample") {
            let state = guardState(sample(at: 100)); movement(state, at: 200, received: 201)
            try state.accept(sample(pointer: 21, input: 41, at: 120))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 150)) }
        }
        run("pre-scope event cannot grant attribution") {
            let state = guardState(sample(at: 100)); movement(state, at: 99, received: 101)
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120)) }
        }
        for (source, sourceState, type) in [(Int64(55), Int64(1), CGEventType.mouseMoved), (0, 0, .mouseMoved), (0, 1, .leftMouseDown)] {
            run("non-HID or nonmovement packet cannot grant attribution \(source)/\(sourceState)/\(type.rawValue)") {
                let state = guardState(sample(at: 100)); movement(state, source: source, sourceState: sourceState, type: type)
                try state.accept(sample(pointer: 21, input: 41, at: 115))
                try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120)) }
            }
        }
        run("invalidated evidence cannot grant attribution") {
            let state = guardState(sample(at: 100)); movement(state); state.invalidatePointerEvidence()
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120)) }
        }
        run("bounded evidence overflow loses credit rather than widening it") {
            let state = guardState(sample(at: 100))
            for index in 0..<65 { movement(state, x: 130 + CGFloat(index), at: 110 + UInt64(index), received: 111 + UInt64(index)) }
            try state.accept(sample(pointer: 21, input: 41, at: 190))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 200)) }
        }
        run("evidence does not override foreground ownership") {
            let state = guardState(sample(at: 100)); movement(state)
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try expect(.targetForeground) { try state.accept(sample(99, x: 130, pointer: 21, input: 41, at: 120)) }
            try expect(.unattributedForegroundChange) { try state.accept(sample(11, x: 130, pointer: 21, input: 41, at: 120)) }
            try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120))
        }
        run("a movement record without a scope HID counter advance cannot grant credit") {
            let state = guardState(sample(at: 100))
            state.recordPointerMovement(type: .mouseMoved, point: CGPoint(x: 130, y: 100), sourcePid: 0, sourceState: 1,
                eventTimeNs: 110, receivedTimeNs: 111, counter: 21)
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, at: 120)) }
        }
        run("receipt counter cannot grant credit before the sample reaches it") {
            let state = guardState(sample(at: 100))
            state.recordPointerMovement(type: .mouseMoved, point: CGPoint(x: 130, y: 100), sourcePid: 0, sourceState: 1,
                eventTimeNs: 110, receivedTimeNs: 111, counter: 30)
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120)) }
            try state.accept(sample(pointer: 30, input: 50, at: 125))
            try state.accept(sample(x: 130, pointer: 30, input: 50, at: 130))
        }
        run("counter reset cannot use pending evidence") {
            let state = guardState(sample(at: 100)); movement(state)
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 0, input: 0, at: 120)) }
        }
        for (point, eventTime, receivedTime, counter) in [
            (CGPoint(x: CGFloat.nan, y: 100), UInt64(110), UInt64(111), UInt64(21)),
            (CGPoint(x: 130, y: 100), 112, 111, 21),
            (CGPoint(x: 130, y: 100), 0, 111, 21),
            (CGPoint(x: 130, y: 100), 110, 111, 0),
        ] {
            run("malformed movement does not grant attribution \(eventTime)/\(counter)/\(point.x)") {
                let state = guardState(sample(at: 100))
                state.recordPointerMovement(type: .mouseMoved, point: point, sourcePid: 0, sourceState: 1,
                    eventTimeNs: eventTime, receivedTimeNs: receivedTime, counter: counter)
                try state.accept(sample(pointer: 21, input: 41, at: 115))
                try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120)) }
            }
        }
        run("a genuinely new event permits a return without replaying an old event") {
            let state = guardState(sample(at: 100)); movement(state)
            try state.accept(sample(pointer: 21, input: 41, at: 115))
            try state.accept(sample(x: 130, pointer: 21, input: 41, at: 120))
            state.recordPointerMovement(type: .mouseMoved, point: CGPoint(x: 100, y: 100), sourcePid: 0, sourceState: 1,
                eventTimeNs: 125, receivedTimeNs: 126, counter: 22)
            try state.accept(sample(x: 130, pointer: 22, input: 42, at: 130))
            try state.accept(sample(pointer: 22, input: 42, at: 135))
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 22, input: 42, at: 140)) }
            state.recordPointerMovement(type: .mouseMoved, point: CGPoint(x: 130, y: 100), sourcePid: 0, sourceState: 1,
                eventTimeNs: 145, receivedTimeNs: 146, counter: 23)
            try state.accept(sample(pointer: 23, input: 43, at: 147))
            try state.accept(sample(x: 130, pointer: 23, input: 43, at: 150))
        }
        run("evicted observation history cannot revive old evidence") {
            let state = guardState(sample(at: 100))
            for index in 0..<65 { try state.accept(sample(x: 130 + CGFloat(index), pointer: 21 + UInt64(index), input: 41 + UInt64(index), at: 200 + UInt64(index))) }
            state.recordPointerMovement(type: .mouseMoved, point: CGPoint(x: 130, y: 100), sourcePid: 0, sourceState: 1,
                eventTimeNs: 199, receivedTimeNs: 500, counter: 85)
            try expect(.unattributedPointerChange) { try state.accept(sample(x: 130, pointer: 85, input: 105, at: 501)) }
        }
        if failures.isEmpty { print("HumanControlGuard: \(passed) synthetic cases passed; no system input generated") }
        else { failures.forEach { print($0) }; exit(1) }
    }
}
