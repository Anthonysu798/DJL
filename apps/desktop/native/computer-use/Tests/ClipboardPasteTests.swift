import AppKit

private final class FakeBoard: ClipboardPasteboard {
    var changeCount = 1
    var pasteboardItems: [NSPasteboardItem]?
    var prepares = 0, writes = 0, failWrite = 0
    init(_ items: [NSPasteboardItem] = []) { pasteboardItems = items }
    func prepareForNewContents(with options: NSPasteboard.ContentsOptions) -> Int {
        prepares += 1; changeCount += 1; pasteboardItems = []; return changeCount
    }
    func writeObjects(_ objects: [NSPasteboardWriting]) -> Bool {
        writes += 1
        if writes == failWrite { return false }
        pasteboardItems = objects.compactMap { $0 as? NSPasteboardItem }; return true
    }
}
private enum TestFailure: Error { case failed(String), cancelled }
private func expect(_ condition: Bool, _ message: String) throws {
    if !condition { throw TestFailure.failed(message) }
}
private func item(_ entries: [(NSPasteboard.PasteboardType, Data)]) -> NSPasteboardItem {
    let result = NSPasteboardItem()
    for (type, data) in entries { precondition(result.setData(data, forType: type)) }
    return result
}
private func denied(_ expected: ClipboardPasteError, _ operation: () throws -> Void) throws {
    do { try operation(); throw TestFailure.failed("Expected \(expected)") }
    catch let error as ClipboardPasteError { try expect(error == expected, "Wrong clipboard failure") }
}
private let payload = Data("Synthetic café ✓".utf8)
private let prior = Data([0, 1, 2, 255])
private let custom = NSPasteboard.PasteboardType("com.djl.synthetic.bytes")
private var cases = 0, failures = 0
private func run(_ name: String, _ body: () throws -> Void) {
    cases += 1
    do { try body(); print("PASS \(name)") }
    catch { failures += 1; print("FAIL \(name): \(error)") }
}
private func tests() {
    run("snapshot does not mutate and untouched finish is harmless") {
        let board = FakeBoard([item([(custom, prior)])])
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
        try tx.finish(); try tx.finish()
        try expect(board.prepares == 0 && board.writes == 0 && board.pasteboardItems?.first?.data(forType: custom) == prior, "Changed untouched board")
    }
    run("foreign writer before install prevents mutation") {
        let board = FakeBoard([item([(custom, prior)])])
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
        board.changeCount += 1
        try denied(.conflict) { try tx.install() }; try tx.finish()
        try expect(board.prepares == 0 && board.writes == 0, "Overwrote a newer writer")
    }
    run("foreign writer after install survives cleanup") {
        let board = FakeBoard([item([(custom, prior)])])
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
        try tx.install(); board.changeCount += 1; board.pasteboardItems = [item([(.string, Data("new writer".utf8))])]
        try denied(.conflict) { try tx.finish() }
        try expect(board.writes == 1 && board.pasteboardItems?.first?.string(forType: .string) == "new writer", "Clobbered foreign content")
    }
    run("failed install is restored and reported") {
        let board = FakeBoard([item([(custom, prior)])]); board.failWrite = 1
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
        try denied(.writeFailed) { try tx.install() }; try tx.finish()
        try expect(board.pasteboardItems?.first?.data(forType: custom) == prior, "Lost backup after write failure")
    }
    run("failed restoration cannot report success") {
        let board = FakeBoard([item([(custom, prior)])]); board.failWrite = 2
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
        try tx.install(); try denied(.restoreFailed) { try tx.finish() }
        try denied(.restoreFailed) { try tx.finish() }
    }
    run("cancellation after mutation still restores") {
        let board = FakeBoard([item([(custom, prior)])]); var cancelled = false
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: { if cancelled { throw TestFailure.cancelled } })
        try tx.install(); cancelled = true
        do { try tx.waitForConsumption(); throw TestFailure.failed("Ignored cancellation") }
        catch TestFailure.cancelled {}
        try tx.finish(); try expect(board.pasteboardItems?.first?.data(forType: custom) == prior, "Cancelled cleanup lost data")
    }
    run("unread payload times out then restores") {
        let board = FakeBoard([item([(custom, prior)])])
        let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
        try tx.install(); try denied(.notRead) { try tx.waitForConsumption() }; try tx.finish()
        try expect(board.pasteboardItems?.first?.data(forType: custom) == prior, "Timeout lost backup")
    }
    run("excessive item count is rejected before mutation") {
        let board = FakeBoard((0..<17).map { _ in item([(custom, prior)]) })
        try denied(.tooLarge) { _ = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {}) }
        try expect(board.prepares == 0, "Mutated oversized snapshot")
    }
    run("excessive retained bytes are rejected before mutation") {
        let board = FakeBoard([item([(custom, Data(repeating: 7, count: 4_194_305))])])
        try denied(.tooLarge) { _ = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {}) }
        try expect(board.prepares == 0, "Mutated oversized snapshot")
    }
    for empty in [false, true] {
        run("real named board lazy consumption and \(empty ? "empty" : "multi-item/type") restoration") {
            let name = NSPasteboard.Name("com.djl.computer-use.synthetic.\(UUID().uuidString)")
            let board = NSPasteboard(name: name)
            defer { board.releaseGlobally() }
            _ = board.prepareForNewContents(with: .currentHostOnly)
            if !empty { try expect(board.writeObjects([item([(custom, prior), (.string, Data("old".utf8))]), item([(.html, Data("<b>old</b>".utf8))])]), "Could not seed owned board") }
            let tx = try ClipboardPasteTransaction(board: board, contents: [.string: payload], check: {})
            try tx.install()
            let child = Process(), output = Pipe()
            child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]); child.arguments = ["--consume", name.rawValue]
            child.standardOutput = output; try child.run(); child.waitUntilExit()
            try expect(child.terminationStatus == 0 && output.fileHandleForReading.readDataToEndOfFile() == payload, "Lazy payload not supplied to owned consumer")
            let waitStart = DispatchTime.now().uptimeNanoseconds
            try tx.waitForConsumption(); try tx.finish()
            try expect(DispatchTime.now().uptimeNanoseconds - waitStart >= 75_000_000, "Skipped quiet interval")
            let items = board.pasteboardItems ?? []
            if empty { try expect(items.isEmpty, "Empty backup not restored") }
            else {
                try expect(items.count == 2 && items[0].data(forType: custom) == prior && items[0].string(forType: .string) == "old" && items[1].string(forType: .html) == "<b>old</b>", "Item bytes/order/type lost")
            }
        }
    }
}
@main struct ClipboardPasteTests {
    static func main() {
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--consume" {
            let board = NSPasteboard(name: .init(CommandLine.arguments[2]))
            guard let data = board.data(forType: .string) else { exit(2) }
            FileHandle.standardOutput.write(data); return
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { tests(); done.signal() }
        while done.wait(timeout: .now()) == .timedOut { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        print("Clipboard paste: \(cases) cases / \(failures) failures; named synthetic boards only")
        exit(failures == 0 ? 0 : 1)
    }
}
