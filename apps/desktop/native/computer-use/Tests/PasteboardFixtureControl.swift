import AppKit

// Only this test's named pasteboards. Never select NSPasteboard.general.
let args = CommandLine.arguments
guard args.count == 3, args[2].hasPrefix("com.djl.computer-use.synthetic.") else { exit(2) }
NSApplication.shared.setActivationPolicy(.prohibited)
let board = NSPasteboard(name: .init(args[2]))
func item(_ values: [(NSPasteboard.PasteboardType, Data)]) -> NSPasteboardItem {
    let result = NSPasteboardItem()
    for (type, data) in values { precondition(result.setData(data, forType: type)) }
    return result
}
switch args[1] {
case "seed":
    _ = board.prepareForNewContents(with: .currentHostOnly)
    guard board.writeObjects([
        item([(.string, Data("restore-sentinel".utf8)), (.init("com.djl.synthetic.bytes"), Data([0, 1, 2, 255]))]),
        item([(.html, Data("<b>restore</b>".utf8))])
    ]) else { exit(3) }
case "foreign":
    _ = board.prepareForNewContents(with: .currentHostOnly)
    guard board.writeObjects([item([(.string, Data("foreign-sentinel".utf8))])]) else { exit(3) }
case "read", "state":
    let items = (board.pasteboardItems ?? []).map { item in
        Dictionary(uniqueKeysWithValues: item.types.map { ($0.rawValue, item.data(forType: $0)?.base64EncodedString() ?? "missing") })
    }
    let value: Any = args[1] == "state" ? ["changeCount": board.changeCount, "items": items] : items
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
case "release": board.releaseGlobally()
default: exit(2)
}
