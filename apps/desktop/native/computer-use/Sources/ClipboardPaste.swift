import AppKit

protocol ClipboardPasteboard: AnyObject {
    var changeCount: Int { get }
    var pasteboardItems: [NSPasteboardItem]? { get }
    func prepareForNewContents(with options: NSPasteboard.ContentsOptions) -> Int
    func writeObjects(_ objects: [NSPasteboardWriting]) -> Bool
}
extension NSPasteboard: ClipboardPasteboard {}

enum ClipboardPasteError: Error, Equatable {
    case snapshotUnavailable, tooLarge, writeFailed, restoreFailed, conflict, notRead, timeout
}

private final class ClipboardDataProvider: NSObject, NSPasteboardItemDataProvider {
    private let lock = NSLock()
    private var contents: [NSPasteboard.PasteboardType: Data]
    private var closed = false
    private var reads = 0, active = 0
    private var lastEnd: UInt64?
    private var failed = false
    init(_ contents: [NSPasteboard.PasteboardType: Data]) { self.contents = contents }
    func pasteboard(_ pasteboard: NSPasteboard?, item: NSPasteboardItem, provideDataForType type: NSPasteboard.PasteboardType) {
        let value: (Bool, Data?) = lock.withLock {
            guard !closed else { return (false, nil) }
            active += 1; return (true, contents[type])
        }
        guard value.0 else { return }
        let supplied = value.1.map { item.setData($0, forType: type) } ?? false
        lock.withLock {
            active -= 1; reads += 1; failed = failed || !supplied
            lastEnd = DispatchTime.now().uptimeNanoseconds
        }
    }
    func status() -> (reads: Int, active: Int, lastEnd: UInt64?, failed: Bool) {
        lock.withLock { (reads, active, lastEnd, failed) }
    }
    func invalidate() { lock.withLock { closed = true; contents.removeAll() } }
}

// The operation worker owns this transaction. Provider callbacks use a separate
// lock and never hold it while calling AppKit. No clipboard contents are logged.
final class ClipboardPasteTransaction {
    private let board: ClipboardPasteboard
    private let originalCount: Int
    private let provider: ClipboardDataProvider
    private let item = NSPasteboardItem()
    private let check: () throws -> Void
    private var backup: [[(NSPasteboard.PasteboardType, Data)]] = []
    private var ownedCount: Int?
    private var finished = false
    private var finishError: ClipboardPasteError?

    init(board: ClipboardPasteboard, contents: [NSPasteboard.PasteboardType: Data], check: @escaping () throws -> Void) throws {
        self.board = board; self.check = check
        originalCount = board.changeCount; provider = ClipboardDataProvider(contents)
        guard !contents.isEmpty, contents.count <= 64,
              contents.values.reduce(0, { $0 + $1.count }) <= 4_194_304 else { throw ClipboardPasteError.tooLarge }
        guard item.setDataProvider(provider, forTypes: contents.keys.sorted { $0.rawValue < $1.rawValue }) else { throw ClipboardPasteError.writeFailed }
        try check()
        let items = board.pasteboardItems ?? []
        guard items.count <= 16 else { throw ClipboardPasteError.tooLarge }
        var bytes = 0, types = 0
        for item in items {
            try check()
            let offered = item.types
            types += offered.count
            guard types <= 64, !offered.isEmpty else { throw ClipboardPasteError.tooLarge }
            var saved: [(NSPasteboard.PasteboardType, Data)] = []
            for type in offered {
                try check()
                guard let data = item.data(forType: type) else { throw ClipboardPasteError.snapshotUnavailable }
                try check()
                guard data.count <= 4_194_304 - bytes else { throw ClipboardPasteError.tooLarge }
                bytes += data.count; saved.append((type, data))
            }
            backup.append(saved)
        }
        guard board.changeCount == originalCount else { throw ClipboardPasteError.conflict }
        try check()
    }
    func install() throws {
        try check()
        guard !finished, ownedCount == nil else { throw ClipboardPasteError.writeFailed }
        guard board.changeCount == originalCount else { throw ClipboardPasteError.conflict }
        let token = board.prepareForNewContents(with: .currentHostOnly)
        ownedCount = token
        try check()
        guard board.changeCount == token else { throw ClipboardPasteError.conflict }
        guard board.writeObjects([item]) else { throw ClipboardPasteError.writeFailed }
        guard board.changeCount == token else { throw ClipboardPasteError.conflict }
    }
    func waitForConsumption(activity: (() throws -> Bool)? = nil) throws {
        guard let token = ownedCount, !finished else { throw ClipboardPasteError.writeFailed }
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        var lastActivity: UInt64 = 0
        while true {
            try check()
            guard board.changeCount == token else { throw ClipboardPasteError.conflict }
            if try activity?() == true { lastActivity = DispatchTime.now().uptimeNanoseconds }
            try check()
            let state = provider.status(), now = DispatchTime.now().uptimeNanoseconds
            guard !state.failed else { throw ClipboardPasteError.writeFailed }
            if state.reads > 0, state.active == 0, let end = state.lastEnd,
               now >= max(end, lastActivity), now - max(end, lastActivity) >= 100_000_000 { return }
            guard now < deadline else { throw state.reads == 0 ? ClipboardPasteError.notRead : ClipboardPasteError.timeout }
            Thread.sleep(forTimeInterval: 0.025)
        }
    }
    func finish() throws {
        if finished {
            if let error = finishError { throw error }
            return
        }
        finished = true
        defer { backup.removeAll(); provider.invalidate(); ownedCount = nil }
        do { try restoreOwned() }
        catch {
            let failure = (error as? ClipboardPasteError) ?? .restoreFailed
            finishError = failure; throw failure
        }
    }
    private func restoreOwned() throws {
        guard let token = ownedCount else { return }
        guard board.changeCount == token else { throw ClipboardPasteError.conflict }
        let restored = try backup.map { saved -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in saved {
                guard item.setData(data, forType: type) else { throw ClipboardPasteError.restoreFailed }
            }
            return item
        }
        // Public AppKit has no compare-and-swap. Preserve a newer owner at each
        // checkpoint, but do not claim atomic isolation between these calls.
        guard board.changeCount == token else { throw ClipboardPasteError.conflict }
        let restoredCount = board.prepareForNewContents(with: .currentHostOnly)
        guard board.changeCount == restoredCount else { throw ClipboardPasteError.conflict }
        if !restored.isEmpty, !board.writeObjects(restored) { throw ClipboardPasteError.restoreFailed }
        guard board.changeCount == restoredCount else { throw ClipboardPasteError.conflict }
    }
}
