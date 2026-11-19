import Foundation

// A single checked acquisition. A failed release retains ownership for retry.
final class ActivationUpdateLease {
    private let connection: Int32
    private let disable: (Int32) -> Int32
    private let reenable: (Int32) -> Int32
    private let lock = NSLock()
    private var held = false, ended = false
    init(connection: Int32, disable: @escaping (Int32) -> Int32, reenable: @escaping (Int32) -> Int32) {
        self.connection = connection; self.disable = disable; self.reenable = reenable
    }
    var isHeld: Bool { lock.withLock { held } }
    func begin() -> Bool {
        lock.withLock {
            guard !ended else { return false }
            if held { return true }
            guard connection > 0 && disable(connection) == 0 else { ended = true; return false }
            held = true; return true
        }
    }
    func finish() -> Bool {
        lock.withLock {
            guard held else { ended = true; return true }
            guard reenable(connection) == 0 else { return false }
            held = false; ended = true; return true
        }
    }
}
