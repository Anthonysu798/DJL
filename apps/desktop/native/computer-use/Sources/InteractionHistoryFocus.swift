import Foundation

struct HistoryFocusNotice<Key: Equatable>: Equatable {
    let generation: UInt64, sequence: UInt64
    let subject: Key
}
struct HistoryFocusStamp<Key: Equatable>: Equatable {
    let sequence: UInt64, generation: UInt64
    let subject: Key?
    let overflow: UInt64, lost: Bool, windowGeneration: UInt64
    let previousNotice: HistoryFocusNotice<Key>?, latestNotice: HistoryFocusNotice<Key>?
    static func binding(before: Self, after: Self) -> Self? {
        guard before.sequence <= after.sequence, before.generation == after.generation,
              before.overflow == after.overflow, !before.lost, !after.lost,
              before.windowGeneration == after.windowGeneration, before.subject == after.subject,
              before.previousNotice == after.previousNotice, before.latestNotice == after.latestNotice else { return nil }
        return after
    }
}
struct HistoryTabPacket {
    let sequence: UInt64, window: UInt32, key: Int64, keyDown: Bool, modified: Bool, at: TimeInterval
}
// Identity/order facts only. Every live AX/security proof is performed by the caller.
final class HistoryTabRecovery<Key: Equatable> {
    let old: Key, new: Key, start: HistoryFocusStamp<Key>, end: HistoryFocusStamp<Key>
    let deadline: UInt64, visits: Int
    private enum State { case ready, proving, finished }
    private var state = State.ready
    init?(old: Key, new: Key, root: Key, start: HistoryFocusStamp<Key>, before: HistoryFocusStamp<Key>, end: HistoryFocusStamp<Key>,
          deadline: UInt64, now: UInt64, visits: Int, completedScan: Bool, titleAdmitted: Bool) {
        guard completedScan, titleAdmitted, old != new, now < deadline, (1...192).contains(visits),
              start.sequence <= before.sequence, before.sequence <= end.sequence,
              end.sequence > start.sequence, end.sequence - start.sequence == 1,
              before.generation == end.generation, before.subject == end.subject,
              before.previousNotice == end.previousNotice, before.latestNotice == end.latestNotice, before.overflow == end.overflow,
              start.overflow == end.overflow, !start.lost, !before.lost, !end.lost,
              start.windowGeneration == end.windowGeneration, before.windowGeneration == end.windowGeneration,
              start.generation <= end.generation else { return nil }
        let notifications = end.generation - start.generation
        if notifications == 2 {
            guard root != old, root != new, before.sequence == end.sequence,
                  let previous = end.previousNotice, let latest = end.latestNotice,
                  previous.generation == start.generation + 1, latest.generation == end.generation,
                  previous.sequence == end.sequence, latest.sequence == end.sequence,
                  previous.subject == root, latest.subject == new, end.subject == new else { return nil }
        } else {
            guard notifications <= 1, notifications == 0 || end.subject == new else { return nil }
        }
        self.old = old; self.new = new; self.start = start; self.end = end; self.deadline = deadline; self.visits = visits
    }
    func begin(now: UInt64, visits: Int) -> Bool {
        guard state == .ready else { return false }
        guard now < deadline, visits == self.visits else { state = .finished; return false }
        state = .proving; return true
    }
    func packet(_ packets: [HistoryTabPacket], stamp: HistoryFocusStamp<Key>, window: UInt32, now: TimeInterval, clock: UInt64, authorized: Bool) -> HistoryTabPacket? {
        guard state == .proving, authorized, clock < deadline, stamp == end, !stamp.lost,
              end.sequence > start.sequence, end.sequence - start.sequence == 1, packets.count <= 32,
              packets.allSatisfy({ $0.sequence <= end.sequence }) else { return nil }
        let eligible = packets.filter { $0.sequence > start.sequence && $0.sequence <= end.sequence }
        guard eligible.count == 1, let packet = eligible.first, packet.window == window,
              packet.keyDown, packet.key == 48, !packet.modified, HistoryInputIdentity.freshSample(age: now - packet.at) else { return nil }
        return packet
    }
    func commit(packets: [HistoryTabPacket], stamp: HistoryFocusStamp<Key>, window: UInt32, now: TimeInterval, clock: UInt64, authorized: Bool, accept: (HistoryTabPacket) -> Bool) -> Bool {
        let selected = packet(packets, stamp: stamp, window: window, now: now, clock: clock, authorized: authorized)
        state = .finished
        guard let selected = selected else { return false }
        return accept(selected)
    }
}
enum HistoryTabProof {
    static func authorize(policy: () -> Bool, oldPath: () -> Bool, newPath: () -> Bool, classifyAll: () -> Bool, final: () -> Bool) -> Bool {
        policy() && oldPath() && newPath() && classifyAll() && policy() && oldPath() && newPath() && final()
    }
}
