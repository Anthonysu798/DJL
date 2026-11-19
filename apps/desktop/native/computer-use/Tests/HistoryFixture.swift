import AppKit
import ApplicationServices

// Dedicated synthetic fixture: commands and state only under this fixed owned temporary prefix.
let directory = URL(fileURLWithPath: CommandLine.arguments.contains("--secondary") ? "/private/tmp/djl-cua-history-fixture-secondary" : "/private/tmp/djl-cua-history-fixture")
let app = NSApplication.shared
var protectedValueReads = 0
var protectedReadStacks: [[String]] = []
var pointerDowns = 0, pointerUps = 0, pointerDrags = 0, pointerScrolls = 0
final class PointerArea: NSView {
    override func mouseDown(with event: NSEvent) { pointerDowns += 1 }
    override func mouseUp(with event: NSEvent) { pointerUps += 1 }
    override func rightMouseDown(with event: NSEvent) { pointerDowns += 1 }
    override func rightMouseUp(with event: NSEvent) { pointerUps += 1 }
    override func mouseDragged(with event: NSEvent) { pointerDrags += 1 }
    override func scrollWheel(with event: NSEvent) { pointerScrolls += 1 }
}
final class FocusableEvidenceView: NSView { override var acceptsFirstResponder: Bool { true } }
final class CredentialField: NSTextField {
    override func accessibilityValue() -> String? { protectedValueReads += 1; protectedReadStacks.append(Array(Thread.callStackSymbols.prefix(16))); return super.accessibilityValue() }
    override func accessibilitySelectedText() -> String? { protectedValueReads += 1; return super.accessibilitySelectedText() }
}
// Only explicitly armed disposable negative cases mutate metadata on their one real Tab.
final class StageFieldWindow: NSWindow {
    weak var fieldA: NSTextField?, fieldB: NSTextField?
    var stageAction: String?, stageEffects = 0
    override func sendEvent(_ event: NSEvent) {
        guard event.type == .keyDown, event.keyCode == 48, let action = stageAction else { super.sendEvent(event); return }
        stageAction = nil; stageEffects += 1
        if action == "old-credential" { fieldA?.setAccessibilityIdentifier("password") }
        if action == "new-credential" { fieldB?.setAccessibilityIdentifier("api-key") }
        if action == "private" { title = "Private Window" }
        super.sendEvent(event)
        if action == "extra-focus" { makeFirstResponder(fieldA); makeFirstResponder(fieldB) }
    }
}
final class FixtureDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!, second: NSWindow!, editor: NSTextView!, credential: CredentialField!, secure: NSSecureTextField!
    var fieldA: NSTextField?, fieldB: NSTextField?
    var timer: Timer?, sequence = 0, web: NSView?, cycleLabel: NSView?, excludedField: NSView?, excludedChild: NSView?
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 130, y: 140, width: 560, height: 400), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "DJL Synthetic History Fixture"; window.isReleasedWhenClosed = false
        let label = NSTextField(labelWithString: "Synthetic history evidence")
        label.frame = NSRect(x: 20, y: 345, width: 500, height: 25); window.contentView!.addSubview(label)
        editor = NSTextView(frame: NSRect(x: 20, y: 170, width: 510, height: 160))
        editor.string = "alpha beta gamma"; editor.isRichText = false
        editor.setAccessibilityIdentifier("fixture-editor"); window.contentView!.addSubview(editor)
        credential = CredentialField(string: "synthetic-hidden-credential")
        credential.frame = NSRect(x: 20, y: 105, width: 500, height: 28)
        credential.setAccessibilityLabel("API key"); credential.setAccessibilityIdentifier("api-key")
        window.contentView!.addSubview(credential)
        secure = NSSecureTextField(string: "synthetic-hidden-password")
        secure.frame = NSRect(x: 20, y: 55, width: 500, height: 28); window.contentView!.addSubview(secure)
        let pointer = PointerArea(frame: NSRect(x: 20, y: 0, width: 500, height: 45)); pointer.setAccessibilityElement(true); pointer.setAccessibilityRole(.group); pointer.setAccessibilityIdentifier("fixture-pointer"); window.contentView!.addSubview(pointer)
        second = NSWindow(contentRect: NSRect(x: 710, y: 140, width: 300, height: 200), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        second.title = "DJL Synthetic Second Window"; second.isReleasedWhenClosed = false
        let field = NSTextField(string: "second fixture field"); field.frame = NSRect(x: 20, y: 80, width: 250, height: 28)
        field.setAccessibilityIdentifier("fixture-second"); second.contentView!.addSubview(field)
        window.makeKeyAndOrderFront(nil); window.makeFirstResponder(editor)
        // The harness explicitly owns this foreground transition; no helper capture performs activation.
        app.activate(ignoringOtherApps: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.poll() }
        save()
    }
    func save() {
        let state: [String: Any] = ["pid": getpid(), "bundleId": Bundle.main.bundleIdentifier ?? "", "windowId": window.windowNumber,
            "secondWindowId": second.windowNumber, "windowTitle": window.title, "fieldAText": fieldA?.stringValue ?? "", "fieldBText": fieldB?.stringValue ?? "", "fieldBFocused": fieldB?.currentEditor() != nil, "fieldAIdentifier": fieldA?.accessibilityIdentifier() ?? "", "fieldBIdentifier": fieldB?.accessibilityIdentifier() ?? "", "stageEffects": (window as? StageFieldWindow)?.stageEffects ?? 0, "text": editor.string, "selectionLocation": editor.selectedRange().location,
            "selectionLength": editor.selectedRange().length, "protectedValueReads": protectedValueReads, "protectedReadStacks": protectedReadStacks,
            "sequence": sequence, "active": app.isActive, "editorIsFirstResponder": window.firstResponder === editor, "descendantIsFirstResponder": window.firstResponder === excludedChild, "descendantParentIsSubtree": excludedChild?.accessibilityParent() as AnyObject? === excludedField, "pointerDowns": pointerDowns, "pointerUps": pointerUps, "pointerDrags": pointerDrags, "pointerScrolls": pointerScrolls]
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) { try? data.write(to: directory.appendingPathComponent("state.json"), options: .atomic) }
    }
    func poll() {
        defer { save() }
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("command.json")),
              let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let seq = command["sequence"] as? Int, seq > sequence else { return }
        sequence = seq
        switch command["command"] as? String {
        case "private-title": window.title = "Private Window"
        case "ordinary-title": window.title = "DJL Synthetic History Fixture"
        case "two-fields", "stage-fields":
            window.orderOut(nil)
            if command["command"] as? String == "stage-fields" {
                window = StageFieldWindow(contentRect: NSRect(x: 130, y: 140, width: 500, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
            } else {
            window = NSWindow(contentRect: NSRect(x: 130, y: 140, width: 500, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
            }
            window.title = "DJL Synthetic Fields"; window.isReleasedWhenClosed = false
            let a = NSTextField(string: "alpha"), b = NSTextField(string: "beta")
            a.frame = NSRect(x: 20, y: 30, width: 220, height: 28); b.frame = NSRect(x: 260, y: 30, width: 220, height: 28)
            a.setAccessibilityIdentifier("fixture-field-a"); b.setAccessibilityIdentifier("fixture-field-b")
            window.contentView!.addSubview(a); window.contentView!.addSubview(b)
            if let stage = window as? StageFieldWindow { stage.fieldA = a; stage.fieldB = b }
            a.nextKeyView = b; b.nextKeyView = a; fieldA = a; fieldB = b; window.makeKeyAndOrderFront(nil); window.makeFirstResponder(a)
        case "stage-old-credential", "stage-new-credential", "stage-private", "stage-extra-focus":
            (window as? StageFieldWindow)?.stageAction = (command["command"] as? String)?.replacingOccurrences(of: "stage-", with: "")
        case "text":
            editor.string = command["text"] as? String ?? "fixture updated"
            NSAccessibility.post(element: editor!, notification: .valueChanged)
        case "selection":
            editor.setSelectedRange(NSRange(location: 0, length: min(5, editor.string.utf16.count)))
            NSAccessibility.post(element: editor!, notification: .selectedTextChanged)
        case "cycle-label":
            let label = NSView(frame: NSRect(x: 530, y: 140, width: 10, height: 10))
            label.setAccessibilityElement(true); label.setAccessibilityRole(.staticText)
            label.setAccessibilityIdentifier("fixture-cycle-label"); label.setAccessibilityValue("synthetic-hidden-cycle-label")
            window.contentView!.addSubview(label); label.setAccessibilityTitleUIElement(label)
            editor.setAccessibilityTitleUIElement(label); cycleLabel = label
        case "remove-cycle":
            editor.setAccessibilityTitleUIElement(nil); cycleLabel?.removeFromSuperview(); cycleLabel = nil
        case "named-credential-subtree": excludedField?.setAccessibilityIdentifier("password"); window.makeFirstResponder(excludedChild)
        case "associated":
            credential.setAccessibilityIdentifier("fixture-associated")
            credential.setAccessibilityLabel(nil)
            let title = NSTextField(labelWithString: "Password")
            title.frame = NSRect(x: 20, y: 140, width: 300, height: 20); window.contentView!.addSubview(title)
            credential.setAccessibilityTitleUIElement(title)
            let child = FocusableEvidenceView(frame: NSRect(x: 0, y: 0, width: 10, height: 10))
            child.setAccessibilityElement(true); child.setAccessibilityRole(.textArea); child.setAccessibilityValue("synthetic-hidden-descendant")
            child.setAccessibilityIdentifier("fixture-associated-descendant")
            let container = NSView(frame: NSRect(x: 525, y: 105, width: 20, height: 30))
            container.setAccessibilityElement(true); container.setAccessibilityRole(.textField)
            container.setAccessibilityIdentifier("fixture-associated-subtree")
            container.setAccessibilityTitleUIElement(title); container.setAccessibilityValue("synthetic-hidden-subtree-field")
            window.contentView!.addSubview(container); container.addSubview(child)
            let linkedLabel = NSView(frame: NSRect(x: 10, y: 0, width: 10, height: 10))
            linkedLabel.setAccessibilityElement(true); linkedLabel.setAccessibilityRole(.staticText)
            linkedLabel.setAccessibilityIdentifier("fixture-associated-linked-label"); linkedLabel.setAccessibilityValue("synthetic-hidden-linked-label")
            container.addSubview(linkedLabel); linkedLabel.setAccessibilityParent(container)
            child.setAccessibilityTitleUIElement(linkedLabel)
            container.setAccessibilityChildren([child, linkedLabel]); child.setAccessibilityParent(container)
            excludedField = container; excludedChild = child
            window.makeFirstResponder(credential)
        case "excluded-web": excludedChild?.setAccessibilityRole(NSAccessibility.Role(rawValue: "AXWebArea"))
        case "excluded-native": excludedChild?.setAccessibilityRole(.textArea)
        case "excluded-focus": window.makeFirstResponder(excludedChild)
        case "web-unknown":
            let view = NSView(frame: NSRect(x: 5, y: 5, width: 10, height: 10)); view.setAccessibilityElement(true); view.setAccessibilityRole(NSAccessibility.Role(rawValue: "AXWebArea"))
            window.contentView!.addSubview(view); web = view
        case "web-remove": web?.removeFromSuperview(); web = nil
        case "credential": window.makeFirstResponder(credential)
        case "secure": window.makeFirstResponder(secure)
        case "editor": window.makeFirstResponder(editor)
        case "second": second.makeKeyAndOrderFront(nil); second.makeFirstResponder(second.contentView!.subviews.first)
        case "first": window.makeKeyAndOrderFront(nil); window.makeFirstResponder(editor)
        case "activate": window.makeKeyAndOrderFront(nil); window.makeFirstResponder(editor); app.activate(ignoringOtherApps: true)
        case "quit": app.terminate(nil)
        default: break
        }
    }
}
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let delegate = FixtureDelegate(); app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
