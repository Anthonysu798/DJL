import AppKit
import CoreGraphics

// A deliberately synthetic target. Nothing in this application reads user documents.
let root = URL(fileURLWithPath: "/private/tmp/djl-cua-background-probe")
func testArgument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}
let stateURL: URL = {
    if let path = testArgument("--state-file") {
        let value = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
        let allowed = URL(fileURLWithPath: "/private/tmp/djl-cua-keyboard-protection").resolvingSymlinksInPath().standardizedFileURL
        if value.path.hasPrefix(allowed.path + "/") { return value }
    }
    return root.appendingPathComponent("fixture-state.json")
}()
let expectedTestTags = Set((testArgument("--test-key-tags") ?? "").split(separator: ",").compactMap { Int64($0) }.filter { $0 >= 0 })
var taggedKeyEvents: [[String: Int64]] = []
var buttonCount = 0
var scrollCount = 0
var dragCount = 0
var keyCount = 0
var eventCount = 0
var lastEvent = "none"
var activationCount = 0
var deactivationCount = 0
var stateRevision = 0
var leftDownCount = 0
var leftUpCount = 0
var leftMouseHeld = false

// Opt-in matrix metadata is restricted to the explicitly supplied helper PID.
var matrixInputMetadata: [[String: Any]] = []
var matrixPointerDowns = ["left": 0, "right": 0, "middle": 0]
var matrixPointerUps = ["left": 0, "right": 0, "middle": 0]
var matrixClickCounts: [String: [Int]] = ["left": [], "right": [], "middle": []]
var matrixCommands: [String] = []
var matrixCancelCount = 0
var matrixPasteAttempts = 0
var matrixPastes = 0
func recordMatrixInput(_ event: NSEvent) {
    guard let expected = testArgument("--test-source-pid").flatMap(Int64.init), let raw = event.cgEvent,
          raw.getIntegerValueField(.eventSourceUnixProcessID) == expected, matrixInputMetadata.count < 200 else { return }
    var row: [String: Any] = ["type": event.type.rawValue, "sourcePid": expected, "flags": event.modifierFlags.rawValue]
    if event.type == .keyDown || event.type == .keyUp || event.type == .flagsChanged {
        row["keyCode"] = event.keyCode
        if event.keyCode == 0 {
            row["charactersPresent"] = !(event.characters ?? "").isEmpty
            row["unmodifiedCharactersPresent"] = !(event.charactersIgnoringModifiers ?? "").isEmpty
            row["knownPhysicalACharacterMatches"] = event.charactersIgnoringModifiers == "a"
        }
    }
    else { row["button"] = event.buttonNumber; row["clickCount"] = event.clickCount }
    matrixInputMetadata.append(row)
}
final class MatrixTextView: NSTextView {
    private var knownSource = false
    var boldCharacterCount: Int {
        guard let storage = textStorage else { return 0 }
        var count = 0
        storage.enumerateAttribute(.font, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            if let font = value as? NSFont, NSFontManager.shared.traits(of: font).contains(.boldFontMask) { count += range.length }
        }
        return count
    }
    override func paste(_ sender: Any?) {
        guard let name = testArgument("--pasteboard-name") else { super.paste(sender); return }
        guard name.hasPrefix("com.djl.computer-use.synthetic.") else { return }
        matrixPasteAttempts += 1
        if CommandLine.arguments.contains("--paste-no-read") { return }
        let board = NSPasteboard(name: .init(name))
        if CommandLine.arguments.contains("--paste-rich"), let data = board.data(forType: .html),
           let value = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) {
            let selection = selectedRange()
            textStorage?.replaceCharacters(in: selection, with: value)
            setSelectedRange(NSRange(location: selection.location + value.length, length: 0)); didChangeText()
        } else if let value = board.string(forType: .string) {
            insertText(value, replacementRange: selectedRange())
        } else { return }
        matrixPastes += 1
    }
    override func keyDown(with event: NSEvent) {
        recordMatrixInput(event)
        knownSource = testArgument("--test-source-pid").flatMap(Int64.init).map { event.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) == $0 } ?? false
        defer { knownSource = false }
        super.keyDown(with: event)
    }
    override func keyUp(with event: NSEvent) { recordMatrixInput(event); super.keyUp(with: event) }
    override func doCommand(by selector: Selector) {
        if knownSource, matrixCommands.count < 100 { matrixCommands.append(NSStringFromSelector(selector)) }
        if selector == #selector(NSResponder.cancelOperation(_:)) { matrixCancelCount += 1; return }
        super.doCommand(by: selector)
    }
}
final class MatrixButton: NSButton {
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) { recordMatrixInput(event); super.keyDown(with: event) }
    override func keyUp(with event: NSEvent) { recordMatrixInput(event); super.keyUp(with: event) }
}
final class MatrixPointerView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemIndigo.withAlphaComponent(0.2).setFill(); bounds.fill()
        ("Synthetic pointer effect count: \(matrixPointerDowns.values.reduce(0, +))" as NSString).draw(at: NSPoint(x: 8, y: 20))
    }
    private func down(_ button: String, _ event: NSEvent) {
        matrixPointerDowns[button, default: 0] += 1; matrixClickCounts[button, default: []].append(event.clickCount)
        recordMatrixInput(event); needsDisplay = true
    }
    private func up(_ button: String, _ event: NSEvent) { matrixPointerUps[button, default: 0] += 1; recordMatrixInput(event) }
    override func mouseDown(with event: NSEvent) { down("left", event) }
    override func mouseUp(with event: NSEvent) { up("left", event) }
    override func rightMouseDown(with event: NSEvent) { down("right", event) }
    override func rightMouseUp(with event: NSEvent) { up("right", event) }
    override func otherMouseDown(with event: NSEvent) { down("middle", event) }
    override func otherMouseUp(with event: NSEvent) { up("middle", event) }
}

final class FixtureApplication: NSApplication {
    override func sendEvent(_ event: NSEvent) {
        if CommandLine.arguments.contains("--ignore-local-deactivation"), event.type == .appKitDefined, event.subtype.rawValue == 2 {
            return // Controlled negative cleanup test only; never a product behavior.
        }
        super.sendEvent(event)
    }
}

func recordFixtureEvent(_ event: NSEvent) {
    eventCount += 1; lastEvent = String(event.type.rawValue)
    if event.type == .keyDown {
        keyCount += 1
        if let raw = event.cgEvent {
            let tag = raw.getIntegerValueField(.eventSourceUserData)
            if expectedTestTags.contains(tag), taggedKeyEvents.count < 20 {
                taggedKeyEvents.append(["tag": tag, "sourcePid": raw.getIntegerValueField(.eventSourceUnixProcessID)])
            }
        }
    }
    if event.type == .leftMouseDown { leftDownCount += 1; leftMouseHeld = true }
    if event.type == .leftMouseUp { leftUpCount += 1; leftMouseHeld = false }
}
final class FixturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func sendEvent(_ event: NSEvent) { recordFixtureEvent(event); super.sendEvent(event) }
}
final class FixtureWindow: NSWindow {
    override func sendEvent(_ event: NSEvent) { recordFixtureEvent(event); super.sendEvent(event) }
}

final class FixtureScrollView: NSScrollView {
    override func scrollWheel(with event: NSEvent) {
        scrollCount += 1
        super.scrollWheel(with: event)
    }
}

final class DragTarget: NSView {
    private var start: NSPoint?
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemTeal.withAlphaComponent(0.25).setFill()
        bounds.fill()
        ("Drag inside this test area" as NSString).draw(
            at: NSPoint(x: 14, y: 24), withAttributes: [.foregroundColor: NSColor.labelColor])
    }
    override func mouseDown(with event: NSEvent) { start = convert(event.locationInWindow, from: nil) }
    override func mouseDragged(with event: NSEvent) {}
    override func mouseUp(with event: NSEvent) {
        if let start, hypot(convert(event.locationInWindow, from: nil).x - start.x,
                            convert(event.locationInWindow, from: nil).y - start.y) > 15 {
            dragCount += 1
        }
        start = nil
    }
}

final class FixtureDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    var panel: NSWindow!
    var field: NSTextField!
    var secondaryField: NSTextField?
    var matrixEditor: MatrixTextView?
    var matrixScroll: NSScrollView?
    var matrixPointer: MatrixPointerView?
    var advancedFocus = false
    var button: NSButton!
    var scroll: FixtureScrollView!
    var drag: DragTarget!
    var timer: Timer?
    var deactivationSignal: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--standard-window") {
            panel = FixtureWindow(contentRect: NSRect(x: 80, y: 90, width: 520, height: 480),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
        } else {
            panel = FixturePanel(contentRect: NSRect(x: 80, y: 90, width: 520, height: 480),
                                 styleMask: [.titled, .closable, .nonactivatingPanel],
                                 backing: .buffered, defer: false)
        }
        panel.title = String((testArgument("--title") ?? "DJL Background Input Test Fixture").prefix(80))
        panel.identifier = NSUserInterfaceItemIdentifier("djl-background-fixture-window")
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        let content = panel.contentView!
        let label = NSTextField(labelWithString: "Controlled fixture — synthetic data only")
        label.frame = NSRect(x: 24, y: 432, width: 470, height: 24)
        content.addSubview(label)
        field = NSTextField(string: "fixture-initial")
        field.frame = NSRect(x: 24, y: 384, width: 470, height: 30)
        field.setAccessibilityIdentifier("fixture-text")
        content.addSubview(field)
        if CommandLine.arguments.contains("--advance-focus-on-type") {
            let secondary = NSTextField(string: "")
            secondary.frame = NSRect(x: 300, y: 334, width: 190, height: 30)
            secondary.setAccessibilityIdentifier("fixture-secondary-text")
            content.addSubview(secondary)
            secondaryField = secondary
            field.delegate = self
        }
        button = CommandLine.arguments.contains("--input-matrix") ? MatrixButton(title: "Increment fixture counter", target: self, action: #selector(increment)) : NSButton(title: "Increment fixture counter", target: self, action: #selector(increment))
        button.frame = NSRect(x: 24, y: 332, width: 260, height: 36)
        button.setAccessibilityIdentifier("fixture-button")
        content.addSubview(button)
        scroll = FixtureScrollView(frame: NSRect(x: 24, y: 130, width: 470, height: 184))
        scroll.hasVerticalScroller = true
        scroll.setAccessibilityIdentifier("fixture-scroll")
        let document = NSView(frame: NSRect(x: 0, y: 0, width: 450, height: 1500))
        for index in 0..<35 {
            let line = NSTextField(labelWithString: "Synthetic scroll row \(index)")
            line.frame = NSRect(x: 12, y: 1450 - index * 40, width: 380, height: 24)
            document.addSubview(line)
        }
        scroll.documentView = document
        content.addSubview(scroll)
        drag = DragTarget(frame: NSRect(x: 24, y: 30, width: 470, height: 74))
        drag.setAccessibilityIdentifier("fixture-drag")
        content.addSubview(drag)
        if CommandLine.arguments.contains("--input-matrix") {
            // Command-A is a standard menu equivalent, unlike text-view arrow
            // bindings. This owned fixture exposes only the safe Select All item.
            let menu = NSMenu(), editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
            let edit = NSMenu(title: "Edit")
            if testArgument("--pasteboard-name") != nil { edit.autoenablesItems = false }
            edit.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
            if testArgument("--pasteboard-name") != nil {
                edit.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
            }
            editItem.submenu = edit; menu.addItem(editItem); NSApp.mainMenu = menu
            field.isHidden = true; button.isHidden = true; scroll.isHidden = true
            let matrixScroll = NSScrollView(frame: NSRect(x: 24, y: 270, width: 470, height: 140))
            matrixScroll.hasVerticalScroller = true; matrixScroll.hasHorizontalScroller = true
            let editor = MatrixTextView(frame: NSRect(x: 0, y: 0, width: 1400, height: 1200))
            editor.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            editor.minSize = NSSize(width: 1400, height: 140)
            editor.maxSize = NSSize(width: 1400, height: CGFloat.greatestFiniteMagnitude)
            editor.isEditable = !CommandLine.arguments.contains("--matrix-readonly")
            editor.isRichText = CommandLine.arguments.contains("--paste-rich"); editor.isHorizontallyResizable = true; editor.isVerticallyResizable = true
            editor.isAutomaticQuoteSubstitutionEnabled = false; editor.isAutomaticDashSubstitutionEnabled = false
            editor.isAutomaticSpellingCorrectionEnabled = false
            editor.textContainer?.widthTracksTextView = false
            editor.textContainer?.containerSize = NSSize(width: 1400, height: CGFloat.greatestFiniteMagnitude)
            editor.string = "alpha beta gamma\nsecond line words\nthird line"
            editor.setAccessibilityIdentifier("fixture-matrix-editor")
            matrixScroll.documentView = editor; content.addSubview(matrixScroll)
            let pointer = MatrixPointerView(frame: NSRect(x: 24, y: 180, width: 470, height: 60))
            content.addSubview(pointer)
            self.matrixEditor = editor; self.matrixScroll = matrixScroll; self.matrixPointer = pointer
            if CommandLine.arguments.contains("--matrix-focus-button") || CommandLine.arguments.contains("--matrix-disabled-button") {
                button.isHidden = false; button.frame = NSRect(x: 24, y: 130, width: 260, height: 36)
                button.keyEquivalent = "\r"; button.isEnabled = !CommandLine.arguments.contains("--matrix-disabled-button")
            }
        }
        // Establish only the fixture's internal responder. Never activate it or make it key.
        if !CommandLine.arguments.contains("--defer-first-responder") {
            panel.makeFirstResponder((matrixEditor as NSResponder?) ?? field)
            if CommandLine.arguments.contains("--matrix-focus-button") { panel.makeFirstResponder(button) }
        }
        panel.orderFront(nil)
        dumpState()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.dumpState() }
        // Explicit opt-in for the fixture-only passive-history integration test.
        // Product/helper code never activates an app.
        if CommandLine.arguments.contains("--history-foreground") {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
            Timer.scheduledTimer(withTimeInterval: min(90, max(1, testArgument("--history-foreground-seconds").flatMap(Double.init) ?? 12)), repeats: false) { [weak self] _ in
                NSApp.deactivate()
                self?.dumpState()
            }
        }
        if CommandLine.arguments.contains("--self-deactivate") {
            signal(SIGUSR1, SIG_IGN)
            deactivationSignal = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
            deactivationSignal?.setEventHandler { [weak self] in NSApp.deactivate(); self?.dumpState() }
            deactivationSignal?.resume()
            Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
                NSApp.deactivate()
                self?.dumpState()
            }
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        activationCount += 1
        if panel != nil { dumpState() }
    }
    func applicationDidResignActive(_ notification: Notification) {
        deactivationCount += 1
        if panel != nil { dumpState() }
    }
    @objc func increment() { buttonCount += 1; dumpState() }

    func controlTextDidChange(_ notification: Notification) {
        guard CommandLine.arguments.contains("--advance-focus-on-type"), !advancedFocus,
              let changed = notification.object as? NSTextField, changed === field,
              let secondary = secondaryField else { return }
        advancedFocus = true
        panel.makeFirstResponder(secondary) // Only this fixture's own responder.
        dumpState()
    }

    func point(_ view: NSView, x: CGFloat? = nil) -> [String: Double] {
        let local = NSPoint(x: x ?? view.bounds.midX, y: view.bounds.midY)
        let screen = panel.convertPoint(toScreen: view.convert(local, to: nil))
        return ["x": screen.x, "y": CGDisplayBounds(CGMainDisplayID()).height - screen.y]
    }

    func dumpState() {
        stateRevision += 1
        let state: [String: Any] = [
            "bundleId": "com.djl.computer-use.background-fixture", "pid": ProcessInfo.processInfo.processIdentifier,
            "windowId": panel.windowNumber,
            "text": CommandLine.arguments.contains("--metadata-only-state") ? "[redacted]" : field.stringValue,
            "buttonCount": buttonCount,
            "secondaryText": CommandLine.arguments.contains("--metadata-only-state") ? "[redacted]" : secondaryField?.stringValue ?? "", "advancedFocus": advancedFocus,
            "regularApp": CommandLine.arguments.contains("--regular-app"), "statePath": stateURL.path, "standardWindow": CommandLine.arguments.contains("--standard-window"), "activationCount": activationCount, "deactivationCount": deactivationCount, "stateRevision": stateRevision,
            "leftDownCount": leftDownCount, "leftUpCount": leftUpCount, "leftMouseHeld": leftMouseHeld,
            "taggedKeyEvents": taggedKeyEvents,
            "matrix": matrixEditor.map { editor in ["selectionLocation": editor.selectedRange().location, "selectionLength": editor.selectedRange().length,
                "textLength": editor.string.utf16.count, "viewportX": matrixScroll?.contentView.bounds.minX ?? 0,
                "documentWidth": editor.frame.width, "documentHeight": editor.frame.height, "viewportWidth": matrixScroll?.contentView.bounds.width ?? 0,
                "selectAllMenuAvailable": NSApp.mainMenu?.item(withTitle: "Edit")?.submenu?.item(withTitle: "Select All") != nil,
                "pasteMenuEnabled": NSApp.mainMenu?.item(withTitle: "Edit")?.submenu?.item(withTitle: "Paste")?.isEnabled ?? false,
                "viewportY": matrixScroll?.contentView.bounds.minY ?? 0, "cancelCount": matrixCancelCount,
                "pasteAttempts": matrixPasteAttempts, "pastes": matrixPastes,
                "boldCharacters": editor.boldCharacterCount,
                "commands": matrixCommands, "inputMetadata": matrixInputMetadata, "pointerDowns": matrixPointerDowns,
                "pointerUps": matrixPointerUps, "clickCounts": matrixClickCounts,
                "editorPoint": point(matrixScroll!), "pointerPoint": point(matrixPointer!)] as [String: Any] } ?? [:],
            "knownForeignMarkerInserted": testArgument("--test-foreign-marker").map { field.stringValue.contains($0) } ?? false,
            "knownForeignMarkerCount": testArgument("--test-foreign-marker").map { field.stringValue.components(separatedBy: $0).count - 1 } ?? 0,
            "scrollCount": scrollCount, "scrollOffset": scroll.contentView.bounds.origin.y,
            "dragCount": dragCount, "keyCount": keyCount, "eventCount": eventCount, "lastEvent": lastEvent,
            "isKey": panel.isKeyWindow, "isActive": NSApp.isActive, "isVisible": panel.isVisible, "windowLevel": panel.level.rawValue,
            "points": ["button": point(button), "text": point(field), "scroll": point(scroll),
                       "dragStart": point(drag, x: 60), "dragEnd": point(drag, x: 300)]
        ]
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) {
            try? data.write(to: stateURL, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
        }
    }
}

let application = FixtureApplication.shared
application.setActivationPolicy(CommandLine.arguments.contains("--regular-app") ? .regular : .accessory)
let delegate = FixtureDelegate()
application.delegate = delegate
application.run()
