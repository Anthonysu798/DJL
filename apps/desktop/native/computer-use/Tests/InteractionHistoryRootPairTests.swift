import Foundation

@main struct InteractionHistoryRootPairTests {
    static var count = 0
    static func check(_ value: Bool, _ name: String) { guard value else { fatalError("FAIL: \(name)") }; count += 1 }
    static func fact(_ generation: UInt64, _ sequence: UInt64, _ subject: String) -> HistoryFocusNotice<String> { HistoryFocusNotice(generation: generation, sequence: sequence, subject: subject) }
    static func stamp(_ generation: UInt64, _ subject: String?, previous: HistoryFocusNotice<String>? = nil, latest: HistoryFocusNotice<String>? = nil, sequence: UInt64 = 5, overflow: UInt64 = 0, lost: Bool = false, window: UInt64 = 0) -> HistoryFocusStamp<String> {
        HistoryFocusStamp(sequence: sequence, generation: generation, subject: subject, overflow: overflow, lost: lost, windowGeneration: window, previousNotice: previous, latestNotice: latest)
    }
    static func main() {
        // Nonzero watermark and irrelevant older facts must neither qualify nor disqualify the new interval.
        let start = stamp(9, "A", previous: fact(8, 3, "old-C"), latest: fact(9, 4, "A"), sequence: 4)
        let end = stamp(11, "B", previous: fact(10, 5, "root"), latest: fact(11, 5, "B"))
        func token(_ value: HistoryFocusStamp<String> = end, before: HistoryFocusStamp<String>? = nil, root: String = "root", old: String = "A", new: String = "B") -> HistoryTabRecovery<String>? {
            HistoryTabRecovery(old: old, new: new, root: root, start: start, before: before ?? value, end: value, deadline: 750, now: 100, visits: 4, completedScan: true, titleAdmitted: true)
        }
        check(token() != nil, "exact two real root-B facts after nonzero A watermark")
        let zero = stamp(9, "A", previous: start.previousNotice, latest: start.latestNotice)
        let one = stamp(10, "B", previous: start.latestNotice, latest: fact(10, 5, "B"))
        check(token(zero) != nil && token(one) != nil, "zero and one B preserve stale pre-A history")
        check(token(one, root: "A") != nil && token(one, root: "B") != nil, "pair root restrictions do not extend to one-B")
        for (name, value) in [
            ("root only", stamp(10, "root", previous: start.latestNotice, latest: fact(10, 5, "root"))),
            ("B-root", stamp(11, "root", previous: fact(10, 5, "B"), latest: fact(11, 5, "root"))),
            ("duplicate B", stamp(11, "B", previous: fact(10, 5, "B"), latest: fact(11, 5, "B"))),
            ("A-B", stamp(11, "B", previous: fact(10, 5, "A"), latest: fact(11, 5, "B"))),
            ("C-B", stamp(11, "B", previous: fact(10, 5, "C"), latest: fact(11, 5, "B"))),
            ("application-B", stamp(11, "B", previous: fact(10, 5, "application"), latest: fact(11, 5, "B"))),
            ("unknown-B", stamp(11, "B", previous: fact(10, 5, "unknown"), latest: fact(11, 5, "B"))),
            ("wrong opaque root", stamp(11, "B", previous: fact(10, 5, "other-root"), latest: fact(11, 5, "B"))),
            ("root-C", stamp(11, "C", previous: fact(10, 5, "root"), latest: fact(11, 5, "C"))),
            ("missing previous", stamp(11, "B", latest: fact(11, 5, "B"))),
            ("missing latest", stamp(11, "B", previous: fact(10, 5, "root"))),
            ("gapped first generation", stamp(11, "B", previous: fact(9, 5, "root"), latest: fact(11, 5, "B"))),
            ("gapped last generation", stamp(11, "B", previous: fact(10, 5, "root"), latest: fact(12, 5, "B"))),
            ("reversed generations", stamp(11, "B", previous: fact(11, 5, "root"), latest: fact(10, 5, "B"))),
            ("pre-A history", stamp(11, "B", previous: fact(8, 4, "root"), latest: fact(9, 4, "B"))),
            ("root before Tab receipt", stamp(11, "B", previous: fact(10, 4, "root"), latest: fact(11, 5, "B"))),
            ("B before Tab receipt", stamp(11, "B", previous: fact(10, 5, "root"), latest: fact(11, 4, "B"))),
            ("other receipt sequence", stamp(11, "B", previous: fact(10, 6, "root"), latest: fact(11, 6, "B"))),
            ("extra input", stamp(11, "B", previous: fact(10, 6, "root"), latest: fact(11, 6, "B"), sequence: 6)),
            ("third callback with legal-looking tail", stamp(12, "B", previous: fact(11, 5, "root"), latest: fact(12, 5, "B"))),
            ("fourth callback with legal-looking tail", stamp(13, "B", previous: fact(12, 5, "root"), latest: fact(13, 5, "B"))),
            ("overflow", stamp(11, "B", previous: end.previousNotice, latest: end.latestNotice, overflow: 1)),
            ("lost", stamp(11, "B", previous: end.previousNotice, latest: end.latestNotice, lost: true)),
            ("window", stamp(11, "B", previous: end.previousNotice, latest: end.latestNotice, window: 1))
        ] { check(token(value) == nil, name) }
        check(token(root: "A") == nil && token(root: "B") == nil, "pair bound root differs from endpoints")
        let changedPrevious = stamp(11, "B", previous: fact(10, 4, "root"), latest: end.latestNotice)
        let changedLatest = stamp(11, "B", previous: end.previousNotice, latest: fact(11, 4, "B"))
        check(end != changedPrevious && end != changedLatest, "immutable equality includes both actual facts")
        check(token(before: changedPrevious) == nil && token(before: changedLatest) == nil, "fact changes during B observation deny")
        check(HistoryFocusStamp.binding(before: end, after: changedPrevious) == nil && HistoryFocusStamp.binding(before: end, after: changedLatest) == nil, "fact changes cannot hide inside A binding")
        let tab = HistoryTabPacket(sequence: 5, window: 8, key: 48, keyDown: true, modified: false, at: 10)
        for changed in [changedPrevious, changedLatest, stamp(12, "B", previous: end.latestNotice, latest: fact(12, 5, "B")), stamp(12, "root", previous: end.latestNotice, latest: fact(12, 5, "root"))] {
            let value = token()!; check(value.begin(now: 200, visits: 4), "pair begins within original budget")
            check(!value.commit(packets: [tab], stamp: changed, window: 8, now: 10.2, clock: 300, authorized: true, accept: { _ in fatalError("late fact accepted") }), "exact late stamp denies")
        }
        let accepted = token()!; _ = accepted.begin(now: 200, visits: 4)
        var writes = 0
        check(accepted.commit(packets: [tab], stamp: end, window: 8, now: 10.2, clock: 300, authorized: true, accept: { _ in writes += 1; return true }), "pair accepts once")
        check(!accepted.commit(packets: [tab], stamp: changedLatest, window: 8, now: 10.3, clock: 301, authorized: true, accept: { _ in writes += 1; return true }) && writes == 1, "post-admission change cannot create second recovery")
        print("InteractionHistoryRootPair: \(count) assertions passed")
    }
}
