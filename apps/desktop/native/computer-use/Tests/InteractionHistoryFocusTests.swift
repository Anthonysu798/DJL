import Foundation

@main struct InteractionHistoryFocusTests {
    static var count = 0
    static func check(_ value: Bool, _ name: String) { guard value else { fatalError("FAIL: \(name)") }; count += 1 }
    static func stamp(_ sequence: UInt64, _ generation: UInt64 = 0, _ subject: String? = nil, overflow: UInt64 = 0, lost: Bool = false, window: UInt64 = 0) -> HistoryFocusStamp<String> {
        HistoryFocusStamp(sequence: sequence, generation: generation, subject: subject, overflow: overflow, lost: lost, windowGeneration: window, previousNotice: nil, latestNotice: nil)
    }
    static func main() {
        let a = stamp(4), b = stamp(5, 1, "B")
        let tab = HistoryTabPacket(sequence: 5, window: 8, key: 48, keyDown: true, modified: false, at: 10)
        func token(_ old: String = "A", _ new: String = "B", _ start: HistoryFocusStamp<String> = a, _ before: HistoryFocusStamp<String> = b, _ end: HistoryFocusStamp<String> = b, completed: Bool = true, title: Bool = true, visits: Int = 4) -> HistoryTabRecovery<String>? {
            HistoryTabRecovery(old: old, new: new, root: "root", start: start, before: before, end: end, deadline: 750, now: 100, visits: visits, completedScan: completed, titleAdmitted: title)
        }
        check(HistoryFocusStamp.binding(before: stamp(3), after: a) == a, "watermark after completed A binding")
        check(HistoryFocusStamp.binding(before: a, after: stamp(5, 1, "B")) == nil, "focus callback during A read denies binding")
        check(HistoryFocusStamp.binding(before: a, after: stamp(5, overflow: 1)) == nil, "overflow during A binding denies")
        check(token(completed: false) == nil && token(title: false) == nil, "scan and raw-title milestone required")
        check(token("A", "A") == nil, "identical focus is no typed transition")
        check(token("A", "B", a, stamp(4), stamp(4)) == nil, "no packet interval cannot arm continuation")
        check(token("A", "B", a, stamp(6), stamp(6)) == nil, "ambiguous multiple input interval denied before proof")
        check(token(visits: 193) == nil, "no new structural allowance")
        check(token("A", "B", a, stamp(5), b) == nil, "notification during live B observation denies")
        check(token("A", "B", a, stamp(5, 1, "C"), stamp(5, 1, "C")) == nil, "wrong callback subject denies")
        check(token("A", "B", a, stamp(5, 2, "B"), stamp(5, 2, "B")) == nil, "duplicate B notifications not merged")
        check(token("A", "B", a, stamp(5, 1, "A"), stamp(5, 1, "A")) == nil, "A callback subject denies")
        check(token("A", "B", a, stamp(5, 1, "application"), stamp(5, 1, "application")) == nil, "no-focus application subject denies")
        check(token("A", "B", a, stamp(5, overflow: 1), stamp(5, overflow: 1)) == nil, "overflow discontinuity denies")
        check(token("A", "B", stamp(4, lost: true), b, b) == nil, "existing overflow flag cannot be hidden by token")
        check(token("A", "B", a, stamp(5, window: 1), stamp(5, window: 1)) == nil, "window callback invalidates same-window candidate")
        let zero = token("A", "B", a, stamp(5), stamp(5))!
        check(zero.begin(now: 200, visits: 4), "zero notifications permits live-proof attempt only")
        check(!zero.commit(packets: [tab], stamp: stamp(5), window: 8, now: 10.2, clock: 250, authorized: false, accept: { _ in fatalError("no live proof") }), "zero callbacks do not replace live authority")
        let good = token()!
        check(good.begin(now: 200, visits: 4) && !good.begin(now: 201, visits: 4), "exactly one continuation begin")
        var admitted = 0
        check(good.commit(packets: [tab], stamp: b, window: 8, now: 10.2, clock: 300, authorized: true, accept: { packet in admitted += 1; return packet.sequence == 5 }), "plain Tab admitted once")
        check(!good.commit(packets: [tab], stamp: b, window: 8, now: 10.3, clock: 301, authorized: true, accept: { _ in admitted += 1; return true }) && admitted == 1, "no second commit")
        for changed in [stamp(6, 1, "B"), stamp(5, 2, "B"), stamp(5, 2, "C"), stamp(5, 1, "B", overflow: 1), stamp(5, 1, "B", lost: true), stamp(5, 1, "B", window: 1)] {
            let value = token()!;_ = value.begin(now: 200, visits: 4)
            check(!value.commit(packets: [tab], stamp: changed, window: 8, now: 10.2, clock: 300, authorized: true, accept: { _ in fatalError("invalid fence") }), "callback/input/overflow before writer admission denies")
        }
        for packet in [
            HistoryTabPacket(sequence: 4, window: 8, key: 48, keyDown: true, modified: false, at: 10),
            HistoryTabPacket(sequence: 5, window: 9, key: 48, keyDown: true, modified: false, at: 10),
            HistoryTabPacket(sequence: 5, window: 8, key: 48, keyDown: true, modified: true, at: 10),
            HistoryTabPacket(sequence: 5, window: 8, key: 6, keyDown: true, modified: false, at: 10),
            HistoryTabPacket(sequence: 5, window: 8, key: 48, keyDown: false, modified: false, at: 10)
        ] {
            let value=token()!;_ = value.begin(now: 200, visits: 4)
            check(!value.commit(packets: [packet], stamp: b, window: 8, now: 10.2, clock: 300, authorized: true, accept: { _ in fatalError("not plain Tab") }), "pre-watermark/wrong-window/modified/other input denied")
        }
        for age in [-0.1, 1.0, 2.0] {
            let value=token()!;_ = value.begin(now: 200, visits: 4)
            check(!value.commit(packets: [tab], stamp: b, window: 8, now: 10+age, clock: 300, authorized: true, accept: { _ in fatalError("expired") }), "unchanged one-second packet gate")
        }
        let mixed=token()!;_ = mixed.begin(now: 200, visits: 4)
        check(!mixed.commit(packets: [tab,tab], stamp: b, window: 8, now: 10.2, clock: 300, authorized: true, accept: { _ in fatalError("mixed") }), "exactly one eligible packet")
        let expired=token()!;check(!expired.begin(now: 750, visits: 4), "original deadline cannot reset at begin")
        let budget=token()!;check(!budget.begin(now: 200, visits: 5), "continuation cannot claim a new structural traversal")
        let deadline=token()!;_ = deadline.begin(now: 200, visits: 4)
        check(!deadline.commit(packets: [tab], stamp: b, window: 8, now: 10.2, clock: 750, authorized: true, accept: { _ in fatalError("deadline") }), "original deadline at enqueue")
        var order: [String] = []
        let proof=HistoryTabProof.authorize(policy: { order.append("policy");return true }, oldPath: { order.append("old");return true }, newPath: { order.append("new");return true }, classifyAll: { order.append("all");return true }, final: { order.append("final");return true })
        check(proof && order == ["policy","old","new","all","policy","old","new","final"], "fresh ordered endpoint/all-node/final proof")
        for denied in ["policy","old","new","all","final"] {
            var visited: [String] = []
            func step(_ name: String) -> Bool { visited.append(name);return name != denied }
            check(!HistoryTabProof.authorize(policy: {step("policy")}, oldPath: {step("old")}, newPath: {step("new")}, classifyAll: {step("all")}, final: {step("final")}), "unsafe origin/new/sibling/final gate denies")
            check(visited.last == denied, "denial is terminal without later proof or editable read")
        }
        print("InteractionHistoryFocus: \(count) assertions passed")
    }
}
