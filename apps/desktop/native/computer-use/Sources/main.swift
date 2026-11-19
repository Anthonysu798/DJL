import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import CoreImage
import CoreMedia
import Darwin

// JSONL transport is private stdin/stdout owned by Electron. Never log input/AX text.
typealias Object = [String: Any]
struct Failure: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}
func fail(_ code: String, _ message: String) throws -> Never { throw Failure(code, message) }
func keys(_ object: Object, _ allowed: [String], _ required: [String]) throws {
    guard Set(object.keys).isSubset(of: Set(allowed)), required.allSatisfy({ object[$0] != nil }) else {
        try fail("invalid-request", "Missing or unknown fields")
    }
}
func string(_ object: Object, _ key: String, max: Int = 128, empty: Bool = false) throws -> String {
    guard let value = object[key] as? String, value.utf16.count <= max,
          empty || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        try fail("invalid-request", "Invalid string field: \(key)")
    }
    return value
}
func number(_ object: Object, _ key: String, min: Double, max: Double, integer: Bool = false) throws -> Double {
    guard let value = object[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
          value.doubleValue.isFinite, value.doubleValue >= min, value.doubleValue <= max,
          !integer || value.doubleValue.rounded() == value.doubleValue else {
        try fail("invalid-request", "Invalid numeric field: \(key)")
    }
    return value.doubleValue
}
func dictionary(_ object: Object, _ key: String) throws -> Object {
    guard let value = object[key] as? Object else { try fail("invalid-request", "Invalid object field: \(key)") }
    return value
}
func bool(_ object: Object, _ key: String) throws -> Bool {
    guard let value = object[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else {
        try fail("invalid-request", "Invalid boolean field: \(key)")
    }
    return value.boolValue
}
func clipped(_ value: String?, _ count: Int = 512) -> String {
    var result = String((value ?? "").prefix(count))
    while result.utf16.count > count { result.removeLast() }
    return result
}
func boundsJSON(_ rect: CGRect) -> Object { ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height] }
func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func axRect(_ element: AXUIElement) -> CGRect? {
    guard let position = attr(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = attr(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, dimensions = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions),
          point.x.isFinite, point.y.isFinite, abs(point.x) <= 100000, abs(point.y) <= 100000,
          dimensions.width > 0, dimensions.height > 0, dimensions.width <= 100000, dimensions.height <= 100000 else { return nil }
    return CGRect(origin: point, size: dimensions)
}
let actionNames = ["press": kAXPressAction, "confirm": kAXConfirmAction, "increment": kAXIncrementAction,
                   "decrement": kAXDecrementAction, "showMenu": kAXShowMenuAction,
                   "pick": kAXPickAction, "cancel": kAXCancelAction]
func supportedAXActions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let names = names as? [String] else { return [] }
    return actionNames.keys.sorted().filter { names.contains(actionNames[$0]!) }
}
func secure(_ element: AXUIElement) -> Bool {
    let role = attr(element, kAXRoleAttribute) as? String ?? ""
    let subrole = attr(element, kAXSubroleAttribute) as? String ?? ""
    return role.localizedCaseInsensitiveContains("secure") || subrole.localizedCaseInsensitiveContains("secure") ||
        (attr(element, "AXProtectedContent") as? Bool == true)
}
struct Target {
    let bundle: String
    let pid: pid_t
    let window: CGWindowID
    init(_ object: Object) throws {
        try keys(object, ["bundleId", "pid", "windowId"], ["bundleId", "pid", "windowId"])
        bundle = try string(object, "bundleId", max: 256)
        pid = pid_t(try number(object, "pid", min: 1, max: 2_147_483_647, integer: true))
        window = CGWindowID(try number(object, "windowId", min: 1, max: 4_294_967_295, integer: true))
    }
    var json: Object { ["bundleId": bundle, "pid": pid, "windowId": window] }
}
struct ProcessIdentity: Equatable {
    let startSeconds: UInt64
    let startMicroseconds: UInt64
    let executable: URL
    let ownerUserID: UInt32
    init(_ pid: pid_t) throws {
        var info = proc_bsdinfo()
        let size = MemoryLayout<proc_bsdinfo>.size
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(size)) == size, info.pbi_start_tvsec > 0 else {
            try fail("target-unavailable", "Process start identity is unavailable")
        }
        var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &path, UInt32(path.count)) > 0 else {
            try fail("target-unavailable", "Process executable identity is unavailable")
        }
        startSeconds = info.pbi_start_tvsec; startMicroseconds = info.pbi_start_tvusec; ownerUserID = info.pbi_uid
        executable = URL(fileURLWithPath: String(cString: path)).resolvingSymlinksInPath().standardizedFileURL
    }
}
// A failed metadata read is unknown, not proof of process replacement.
func processReplacedOrExited(_ pid: pid_t, _ identity: ProcessIdentity) -> Bool {
    if let current = try? ProcessIdentity(pid) {
        // A changed credential is not evidence that the process generation died.
        return current.startSeconds != identity.startSeconds || current.startMicroseconds != identity.startMicroseconds || current.executable != identity.executable
    }
    errno = 0
    return Darwin.kill(pid, 0) == -1 && errno == ESRCH
}
final class Session {
    let id = UUID().uuidString
    let owner: String
    let target: Target
    let identity: ProcessIdentity
    let app: NSRunningApplication // Retain the originally attested LaunchServices object.
    let lock = NSLock()
    private var cancelled = false
    private var humanStopRequested = false
    var humanStopWasRequested: Bool { lock.withLock { humanStopRequested } }
    private var snapshot = ""
    private var references: [Int: AXUIElement] = [:]
    var lastUsed = Date()
    var focusProtection: FocusProtection? // Serialized operation worker only.
    var manualAccessibilityPrepared = false // Serialized operation worker only.
    init(owner: String, target: Target, app: NSRunningApplication, identity: ProcessIdentity) throws {
        guard try ProcessIdentity(target.pid) == identity else {
            try fail("target-unavailable", "Process start/executable identity changed")
        }
        self.identity = identity
        if let appExecutable = app.executableURL,
           appExecutable.resolvingSymlinksInPath().standardizedFileURL != identity.executable {
            try fail("target-unavailable", "Conflicting process executable identities")
        }
        self.owner = owner; self.target = target; self.app = app
    }
    @discardableResult func cancel(fromHuman: Bool = false) -> Bool {
        lock.lock(); defer { lock.unlock() }
        humanStopRequested = humanStopRequested || fromHuman
        let wasActive = !cancelled
        cancelled = true; snapshot = ""; references.removeAll()
        return wasActive
    }
    func check() throws { lock.lock(); let stopped = cancelled; lock.unlock(); if stopped { try fail("cancelled", "Session stopped") } }
    func invalidate() { lock.lock(); snapshot = ""; references.removeAll(); lock.unlock() }
    func dispatch(release: Bool, _ block: () throws -> Void) throws {
        lock.lock(); defer { lock.unlock() }
        guard release || !cancelled else { try fail("cancelled", "Session stopped") }
        try block()
    }
    func save(_ id: String, _ elements: [Int: AXUIElement]) throws {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled else { try fail("cancelled", "Session stopped") }
        snapshot = id; references = elements
    }
    func element(_ object: Object) throws -> AXUIElement {
        let id = try string(object, "snapshotId")
        let index = Int(try number(object, "elementId", min: 0, max: 500, integer: true))
        lock.lock(); defer { lock.unlock() }
        guard !cancelled else { try fail("cancelled", "Session stopped") }
        guard id == snapshot else { try fail("stale-snapshot", "Observe again before using element references") }
        guard let element = references[index] else { try fail("element-unavailable", "Element is absent from this snapshot") }
        return element
    }
}
struct Window {
    let id: CGWindowID
    let pid: pid_t
    let title: String
    let rect: CGRect
}
func windows(_ only: CGWindowID? = nil) -> [Window] {
    let options: CGWindowListOption = only == nil ? [.optionAll, .excludeDesktopElements] : [.optionIncludingWindow, .excludeDesktopElements]
    let rows = CGWindowListCopyWindowInfo(options, only ?? kCGNullWindowID) as? [Object] ?? []
    return rows.compactMap { row in
        guard let id = row[kCGWindowNumber as String] as? UInt32, id > 0,
              let pid = row[kCGWindowOwnerPID as String] as? Int32,
              let layer = row[kCGWindowLayer as String] as? Int, layer == 0,
              let data = row[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: data), rect.width > 0, rect.height > 0,
              rect.width <= 100000, rect.height <= 100000, abs(rect.minX) <= 100000, abs(rect.minY) <= 100000 else { return nil }
        return Window(id: id, pid: pid, title: row[kCGWindowName as String] as? String ?? "", rect: rect)
    }
}
func window(_ session: Session) throws -> Window {
    try session.check()
    func unavailable(_ message: String) throws -> Never { session.cancel(); try fail("target-unavailable", message) }
    let app = session.app
    guard !app.isTerminated else { try unavailable("Bound running-app metadata reports termination") }
    guard app.bundleIdentifier == session.target.bundle else { try unavailable("Bound app bundle identity unavailable or changed") }
    guard let current = try? ProcessIdentity(session.target.pid) else { try unavailable("Bound process start/executable metadata unavailable") }
    guard current == session.identity else { try unavailable("Bound process start/executable identity changed") }
    guard let window = windows(session.target.window).first(where: { $0.id == session.target.window && $0.pid == session.target.pid }) else {
        try unavailable("Bound exact CGWindow metadata unavailable")
    }
    return window
}

func axWindow(_ session: Session, _ window: Window) throws -> AXUIElement {
    guard AXIsProcessTrusted() else { try fail("permission-denied", "Accessibility permission is required") }
    let app = AXUIElementCreateApplication(session.target.pid)
    AXUIElementSetMessagingTimeout(app, 0.4)
    var rawWindows: CFTypeRef?
    let windowRead = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &rawWindows)
    guard windowRead == .success, let candidates = rawWindows as? [AXUIElement] else {
        try fail("target-unavailable", "AX window enumeration unavailable (\(windowRead.rawValue))")
    }
    guard candidates.count <= 100 else { try fail("unsupported", "Too many AX windows to match safely") }
    let numbered = candidates.filter { (attr($0, "AXWindowNumber") as? NSNumber)?.uint32Value == window.id }
    if numbered.count == 1 { return numbered[0] }
    guard numbered.isEmpty else { try fail("target-unavailable", "Ambiguous AX window number") }
    let matching = candidates.filter { candidate in
        guard let rect = axRect(candidate), abs(rect.minX - window.rect.minX) < 2,
              abs(rect.minY - window.rect.minY) < 2, abs(rect.width - window.rect.width) < 2,
              abs(rect.height - window.rect.height) < 2 else { return false }
        let title = attr(candidate, kAXTitleAttribute) as? String ?? ""
        return window.title.isEmpty || title == window.title
    }
    guard matching.count == 1 else { try fail("target-unavailable", "AX window match count \(matching.count) from \(candidates.count) candidates") }
    return matching[0]
}

// Only the explicitly bound window is streamed; no display capture or audio output is installed.
final class WindowPreviewStream: NSObject, SCStreamOutput, SCStreamDelegate {
    let session: Session
    let deliver: (NSImage) -> Void
    let sampleQueue = DispatchQueue(label: "com.djl.computer-use.preview")
    let stateLock = NSLock()
    let context = CIContext(options: [.cacheIntermediates: false])
    var stream: SCStream?
    var ended = false
    init(_ session: Session, deliver: @escaping (NSImage) -> Void) {
        self.session = session; self.deliver = deliver
        super.init()
    }
    func start() {
        guard CGPreflightScreenCaptureAccess() else { return }
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
                try session.check()
                let current = try window(session)
                guard let selected = content.windows.first(where: { $0.windowID == session.target.window && $0.owningApplication?.processID == session.target.pid }) else { return }
                let filter = SCContentFilter(desktopIndependentWindow: selected)
                let configuration = SCStreamConfiguration()
                let scale = min(1.0, 640 / max(current.rect.width, current.rect.height))
                configuration.width = max(1, Int(current.rect.width * scale)); configuration.height = max(1, Int(current.rect.height * scale))
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: 5)
                configuration.queueDepth = 3; configuration.showsCursor = false; configuration.capturesAudio = false
                let candidate = SCStream(filter: filter, configuration: configuration, delegate: self)
                try candidate.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
                let shouldStart = stateLock.withLock { () -> Bool in
                    guard !ended else { return false }; stream = candidate; return true
                }
                guard shouldStart else { return }
                try await candidate.startCapture()
                if stateLock.withLock({ ended }) { try? await candidate.stopCapture() }
            } catch { stop() }
        }
    }
    func stop() {
        let previous = stateLock.withLock { () -> SCStream? in ended = true; let previous = stream; stream = nil; return previous }
        if let previous = previous { Task { try? await previous.stopCapture() } }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { stop() }
    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !stateLock.withLock({ ended }), (try? session.check()) != nil,
              CMSampleBufferIsValid(buffer), let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
        // Reject incomplete frames and metadata-only updates.
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue else { return }
        guard (try? window(session)) != nil else { stop(); return }
        let image = CIImage(cvPixelBuffer: pixels)
        guard let rendered = context.createCGImage(image, from: image.extent) else { return }
        let preview = NSImage(cgImage: rendered, size: .zero)
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.stateLock.withLock({ self.ended }), (try? self.session.check()) != nil else { return }
            self.deliver(preview)
        }
    }
}

// An original vector pointer and pulse. Presentation never changes the hardware pointer.
final class SyntheticCursorView: NSView {
    private var timer: Timer?
    private var pulseStart = Date.timeIntervalSinceReferenceDate
    override var isFlipped: Bool { false }
    func startPulse() {
        guard timer == nil else { return }
        pulseStart = Date.timeIntervalSinceReferenceDate
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.needsDisplay = true }
    }
    func stopPulse() { timer?.invalidate(); timer = nil }
    override func draw(_ dirtyRect: NSRect) {
        let progress = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0.35 : (Date.timeIntervalSinceReferenceDate - pulseStart).truncatingRemainder(dividingBy: 1.3) / 1.3
        let radius = 5 + 12 * progress
        let ring = NSBezierPath(ovalIn: NSRect(x: 8 - radius, y: 36 - radius, width: 2 * radius, height: 2 * radius))
        NSColor.systemOrange.withAlphaComponent(0.55 * (1 - progress)).setStroke(); ring.lineWidth = 2; ring.stroke()
        let arrow = NSBezierPath()
        arrow.move(to: NSPoint(x: 8, y: 36)); arrow.line(to: NSPoint(x: 10, y: 10))
        arrow.line(to: NSPoint(x: 17, y: 17)); arrow.line(to: NSPoint(x: 23, y: 6))
        arrow.line(to: NSPoint(x: 28, y: 9)); arrow.line(to: NSPoint(x: 22, y: 20))
        arrow.line(to: NSPoint(x: 32, y: 21)); arrow.close()
        NSColor.systemOrange.setFill(); arrow.fill()
        NSColor.white.withAlphaComponent(0.95).setStroke(); arrow.lineWidth = 1.6; arrow.lineJoinStyle = .round; arrow.stroke()
    }
    deinit { timer?.invalidate() }
}

// Nonactivating presentation. These panels never accept input on behalf of the target.
final class Presentation: NSObject, NSWindowDelegate {
    var preview: NSPanel?
    var cursor: NSPanel?
    lazy var cursorView = SyntheticCursorView(frame: NSRect(x: 0, y: 0, width: 44, height: 56))
    lazy var image = NSImageView()
    lazy var label = NSTextField(labelWithString: "DJL computer use")
    var active: Session?
    var previewStream: WindowPreviewStream?
    var cursorMoveTimer: Timer?
    var stop: ((Session) -> Void)?
    func show(_ session: Session, _ screenshot: NSImage? = nil) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard (try? session.check()) != nil else { return }
        let changed = active?.id != session.id
        if changed { previewStream?.stop(); previewStream = nil }
        active = session
        if preview == nil {
            let panel = NSPanel(contentRect: NSRect(x: 40, y: 80, width: 320, height: 240), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.title = "DJL Computer Use"; panel.level = .floating; panel.hidesOnDeactivate = false
            panel.isReleasedWhenClosed = false; panel.delegate = self; panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            image.frame = NSRect(x: 10, y: 45, width: 300, height: 185); image.imageScaling = .scaleProportionallyUpOrDown
            label.frame = NSRect(x: 10, y: 12, width: 125, height: 25)
            label.lineBreakMode = .byTruncatingMiddle
            let openChat = NSButton(title: "Open chat", target: self, action: #selector(openChatClicked))
            openChat.frame = NSRect(x: 140, y: 10, width: 90, height: 28)
            let button = NSButton(title: "Stop", target: self, action: #selector(stopClicked))
            button.frame = NSRect(x: 235, y: 10, width: 75, height: 28)
            panel.contentView?.addSubview(image); panel.contentView?.addSubview(label); panel.contentView?.addSubview(openChat); panel.contentView?.addSubview(button)
            preview = panel
        }
        label.stringValue = clipped(NSRunningApplication(processIdentifier: session.target.pid)?.localizedName ?? session.target.bundle)
        label.toolTip = session.target.bundle
        if changed || screenshot != nil { image.image = screenshot }
        preview?.orderFrontRegardless()
        if previewStream == nil && CGPreflightScreenCaptureAccess() {
            let live = WindowPreviewStream(session) { [weak self] frame in
                guard let self = self, self.active?.id == session.id else { return }
                self.image.image = frame
            }
            previewStream = live; live.start()
        }
    }
    func move(_ point: CGPoint, session: Session) {
        guard active?.id == session.id else { return }
        if cursor == nil {
            let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 44, height: 56), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.backgroundColor = .clear; panel.isOpaque = false; panel.hasShadow = false
            panel.ignoresMouseEvents = true; panel.level = .floating; panel.hidesOnDeactivate = false
            panel.contentView?.addSubview(cursorView)
            cursor = panel
        }
        let screenTop = NSScreen.screens.first?.frame.maxY ?? 0
        let origin = NSPoint(x: point.x - 8, y: screenTop - point.y - 36)
        cursorMoveTimer?.invalidate(); cursorMoveTimer = nil
        if let panel = cursor, panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let initial = panel.frame.origin, started = Date.timeIntervalSinceReferenceDate
            cursorMoveTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self, weak panel] timer in
                guard let panel = panel else { timer.invalidate(); return }
                let progress = min(1.0, (Date.timeIntervalSinceReferenceDate - started) / 0.12)
                let eased = 1 - pow(1 - progress, 3)
                panel.setFrameOrigin(NSPoint(x: initial.x + (origin.x - initial.x) * eased, y: initial.y + (origin.y - initial.y) * eased))
                if progress >= 1 { timer.invalidate(); self?.cursorMoveTimer = nil }
            }
        } else { cursor?.setFrameOrigin(origin) }
        cursorView.startPulse(); cursor?.orderFrontRegardless()
    }
    func hide(_ session: Session) {
        if active?.id == session.id { previewStream?.stop(); previewStream = nil; preview?.orderOut(nil); cursor?.orderOut(nil); cursorMoveTimer?.invalidate(); cursorMoveTimer = nil; cursorView.stopPulse(); active = nil }
    }
    func windowWillClose(_ notification: Notification) { if let session = active { hide(session) } }
    @objc func openChatClicked() {
        guard let session = active, (try? session.check()) != nil else { return }
        emit(["event": ["type": "show-thread", "sessionId": session.id]])
    }
    @objc func stopClicked() { if let session = active { stop?(session); hide(session) } }
}
let presentation = Presentation()
let outputLock = NSLock()
func emit(_ value: Object) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), data.count <= 6_000_000 else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    do {
        try FileHandle.standardOutput.write(contentsOf: data)
        try FileHandle.standardOutput.write(contentsOf: Data([10]))
    } catch { shutdown() }
}
let sessionsLock = NSLock()
var sessions: [String: Session] = [:]
var ownerEpochs: [String: UInt64] = [:]
var shuttingDown = false
let work = DispatchQueue(label: "com.djl.computer-use.operations")
// Process-directed CGEvent delivery is experimental until the controlled fixture proves effects.
let experimentalInput = ProcessInfo.processInfo.environment["DJL_COMPUTER_USE_EXPERIMENTAL_INPUT"] == "1"
func getSession(_ request: Object, _ owner: String) throws -> Session {
    let id = try string(request, "sessionId")
    sessionsLock.lock(); let session = sessions[id]; sessionsLock.unlock()
    guard let session = session, session.owner == owner else { try fail("unauthorized-session", "Unknown session for this thread") }
    guard Date().timeIntervalSince(session.lastUsed) <= 1800 else { session.cancel(); try fail("target-unavailable", "Session expired") }
    session.lastUsed = Date(); try session.check(); return session
}
func stopped(_ session: Session) {
    guard session.cancel() else { return }
    _ = sessionsLock.withLock { sessions.removeValue(forKey: session.id) }
    DispatchQueue.main.async { presentation.hide(session) }
    emit(["event": ["type": "stopped", "sessionId": session.id]])
}
// Thread cancellation is atomic with session publication, including pending opens.
func stopThread(_ owner: String, fromHuman: Bool = false) -> [Session] {
    if owner == "desktop:recorder" { InteractionHistory.shared.stop() }
    sessionsLock.lock()
    if let current = ownerEpochs[owner] { ownerEpochs[owner] = current &+ 1 }
    let selected = sessions.values.filter { $0.owner == owner }
    selected.forEach { $0.cancel(fromHuman: fromHuman) }
    selected.forEach { sessions.removeValue(forKey: $0.id) }
    sessionsLock.unlock()
    selected.forEach { session in
        DispatchQueue.main.async { presentation.hide(session) }
        emit(["event": ["type": "stopped", "sessionId": session.id]])
    }
    return selected
}
func humanStopped(_ session: Session) {
    session.cancel(fromHuman: true)
    _ = stopThread(session.owner, fromHuman: true)
    // Only this direct human control emits a thread latch. The manager resumes it at trusted turn start.
    emit(["event": ["type": "thread-stopped", "threadId": session.owner]])
}
func status() -> Object {
    let ax = AXIsProcessTrusted(), screen = CGPreflightScreenCaptureAccess()
    var actions = ax ? ["click", "setValue", "performAction"] : []
    if ax && experimentalInput && WindowLocationAPI.setter != nil { actions += ["drag", "type", "paste", "pressKey", "scroll", "selectText"] }
    return ["platform": "darwin", "available": true,
            "permissions": ["accessibility": ax ? "granted" : "denied", "screenRecording": screen ? "granted" : "denied"],
            "capabilities": ["observation": ax, "screenshots": ax && screen, "backgroundActions": actions,
                             "virtualCursor": true, "passiveHistory": true],
            "message": "No permission prompts. AX actions require app support; coordinate/key input is experimental and disabled by default. Effects must be verified by observing again."]
}
func capture(_ session: Session, _ window: Window) throws -> (Object, NSImage) {
    guard CGPreflightScreenCaptureAccess() else { try fail("permission-denied", "Screen Recording permission is required") }
    let gate = DispatchSemaphore(value: 0)
    let resultLock = NSLock()
    var result: Result<CGImage, Error>?
    let captureTask = Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            guard let selected = content.windows.first(where: { $0.windowID == window.id && $0.owningApplication?.processID == session.target.pid }) else {
                throw Failure("target-unavailable", "Requested window is unavailable for capture")
            }
            try session.check()
            let filter = SCContentFilter(desktopIndependentWindow: selected)
            let config = SCStreamConfiguration()
            let scale = min(2.0, 2048.0 / max(window.rect.width, window.rect.height))
            config.width = max(1, Int(window.rect.width * scale)); config.height = max(1, Int(window.rect.height * scale))
            config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            resultLock.withLock { result = .success(image) }
        } catch { resultLock.withLock { result = .failure(error) } }
        gate.signal()
    }
    let captureDeadline = Date().addingTimeInterval(5)
    while gate.wait(timeout: .now() + 0.05) != .success {
        do { try session.check() } catch { captureTask.cancel(); throw error }
        if Date() >= captureDeadline { captureTask.cancel(); try fail("timeout", "Window capture timed out") }
    }
    try session.check(); _ = try selfCheckWindow(session, window)
    resultLock.lock(); let completed = result; resultLock.unlock()
    guard let completed = completed else { try fail("internal", "Capture returned no result") }
    let image: CGImage
    do { image = try completed.get() } catch let error as Failure { throw error } catch {
        try fail("target-unavailable", "Window capture failed; no fallback was attempted")
    }
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]), data.count <= 3_000_000 else {
        try fail("unsupported", "Window capture exceeds the inline image limit")
    }
    return (["mimeType": "image/png", "width": image.width, "height": image.height,
             "payload": ["kind": "data", "base64": data.base64EncodedString()]], NSImage(cgImage: image, size: .zero))
}
func selfCheckWindow(_ session: Session, _ previous: Window) throws -> Window {
    let current = try window(session)
    guard current.rect == previous.rect else { try fail("target-unavailable", "Window moved or resized during the operation") }
    return current
}
// Electron's documented assistive-client flag enables its renderer AX tree.
// Only the attested target app is addressed; no screen-reader mode is changed.
func prepareManualAccessibility(_ session: Session, _ targetWindow: Window) throws {
    if session.manualAccessibilityPrepared { return }
    let app = AXUIElementCreateApplication(session.target.pid)
    AXUIElementSetMessagingTimeout(app, 0.15)
    let name = "AXManualAccessibility" as CFString
    guard let value = attr(app, "AXManualAccessibility"), CFGetTypeID(value) == CFBooleanGetTypeID(),
          let enabled = value as? Bool else { return }
    if enabled { session.manualAccessibilityPrepared = true; return }
    var settable = DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(app, name, &settable) == .success, settable.boolValue else { return }
    try session.check(); _ = try selfCheckWindow(session, targetWindow)
    try session.dispatch(release: false) {
        guard try ProcessIdentity(session.target.pid) == session.identity else { try fail("target-unavailable", "Process identity expired before accessibility preparation") }
        session.manualAccessibilityPrepared = true
        _ = AXUIElementSetAttributeValue(app, name, kCFBooleanTrue)
    }
    try session.check(); _ = try selfCheckWindow(session, targetWindow)
}
func observe(_ session: Session, _ request: Object) throws -> Object {
    let targetWindow = try window(session)
    try prepareManualAccessibility(session, targetWindow)
    let root = try axWindow(session, targetWindow)
    let limit = request["maxElements"] == nil ? 500 : Int(try number(request, "maxElements", min: 1, max: 500, integer: true))
    let snapshot = UUID().uuidString
    var rows: [Object] = [], references: [Int: AXUIElement] = [:], truncated = false
    var queue: [(AXUIElement, Int?, Int)] = [(root, nil, 0)]
    let deadline = Date().addingTimeInterval(5)
    while !queue.isEmpty {
        try session.check()
        if rows.count >= limit || Date() > deadline { truncated = true; break }
        let (element, parent, depth) = queue.removeFirst()
        AXUIElementSetMessagingTimeout(element, 0.2)
        let index = rows.count, protected = secure(element)
        let role = clipped(attr(element, kAXRoleAttribute) as? String, 128)
        var row: Object = ["elementId": index, "role": role.isEmpty ? "AXUnknown" : role,
                           "label": protected ? "[secure content redacted]" : clipped((attr(element, kAXTitleAttribute) as? String) ?? (attr(element, kAXDescriptionAttribute) as? String)),
                           "actions": protected ? [] : supportedAXActions(element)]
        if let parent = parent { row["parentId"] = parent }
        if !protected, let value = attr(element, kAXValueAttribute) as? String {
            row["value"] = clipped(value, 1024)
            if value.utf16.count <= 1_048_576, let raw = attr(element, kAXSelectedTextRangeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() {
                let ax = unsafeBitCast(raw, to: AXValue.self)
                var range = CFRange()
                if AXValueGetType(ax) == .cfRange, AXValueGetValue(ax, .cfRange, &range),
                   range.location >= 0, range.length >= 0, range.location <= value.utf16.count,
                   range.length <= value.utf16.count - range.location {
                    row["selectedTextRange"] = ["location": range.location, "length": range.length]
                }
            }
        }
        if let bounds = axRect(element) { row["bounds"] = boundsJSON(bounds) }
        if let enabled = attr(element, kAXEnabledAttribute) as? Bool { row["enabled"] = enabled }
        rows.append(row)
        if !protected { references[index] = element }
        if depth < 30 && !protected {
            // Fetch a bounded slice; do not materialize arbitrarily large accessibility arrays.
            var count: CFIndex = 0
            if AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count) == .success, count > 0 {
                let allowed = min(count, max(0, limit - rows.count - queue.count))
                if allowed < count { truncated = true }
                var children: CFArray?
                if allowed > 0 && AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, allowed, &children) == .success,
                   let children = children as? [AXUIElement] { queue += children.map { ($0, index, depth + 1) } }
            }
        } else if depth >= 30 { truncated = true }
    }
    var result: Object = ["sessionId": session.id, "snapshotId": snapshot, "target": session.target.json,
                          "capturedAt": ISO8601DateFormatter().string(from: Date()), "bounds": boundsJSON(targetWindow.rect),
                          "elements": rows, "truncated": truncated]
    var previewImage: NSImage?
    if try request["screenshot"] != nil && bool(request, "screenshot") {
        let (screenshot, image) = try capture(session, targetWindow); result["screenshot"] = screenshot; previewImage = image
    }
    _ = try selfCheckWindow(session, targetWindow)
    try session.save(snapshot, references)
    DispatchQueue.main.async { presentation.show(session, previewImage) }
    return result
}
func resolve(_ object: Object, _ session: Session, _ targetWindow: Window) throws -> (AXUIElement?, CGPoint) {
    let kind = try string(object, "kind")
    if kind == "element" {
        try keys(object, ["kind", "snapshotId", "elementId"], ["kind", "snapshotId", "elementId"])
        let element = try session.element(object)
        let boundRoot = try axWindow(session, targetWindow)
        let owningWindow = attr(element, kAXWindowAttribute)
        guard CFEqual(element, boundRoot) || (owningWindow != nil && CFEqual(owningWindow!, boundRoot)) else {
            try fail("element-unavailable", "Element no longer belongs to the bound window")
        }
        guard let rect = axRect(element) else {
            try fail("element-unavailable", "Element is protected, moved, or outside the bound window")
        }
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        var ancestor = element, reachedWindow = false, scrollAreas: [CGRect] = []
        for _ in 0..<30 {
            try session.check()
            guard DispatchTime.now().uptimeNanoseconds < deadline else { try fail("timeout", "Element target validation timed out") }
            AXUIElementSetMessagingTimeout(ancestor, 0.15)
            guard !secure(ancestor) else { try fail("element-unavailable", "Element has a protected ancestor") }
            if CFEqual(ancestor, boundRoot) { reachedWindow = true; break }
            guard let role = attr(ancestor, kAXRoleAttribute) as? String else { try fail("element-unavailable", "Element ancestor role is unavailable") }
            if role == kAXScrollAreaRole {
                guard let viewport = axRect(ancestor) else { try fail("element-unavailable", "Scroll area bounds are unavailable") }
                scrollAreas.append(viewport)
            }
            guard let parent = attr(ancestor, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
            ancestor = unsafeBitCast(parent, to: AXUIElement.self)
        }
        try session.check()
        guard DispatchTime.now().uptimeNanoseconds < deadline else { try fail("timeout", "Element target validation timed out") }
        guard reachedWindow, let point = ElementActionGeometry.point(element: rect, window: targetWindow.rect, scrollAreas: scrollAreas) else {
            try fail("element-unavailable", "Element is outside its visible scroll area or bound window")
        }
        return (element, point)
    }
    guard kind == "point" else { try fail("invalid-request", "Unknown action target") }
    try keys(object, ["kind", "x", "y"], ["kind", "x", "y"])
    let x = try number(object, "x", min: 0, max: 100000), y = try number(object, "y", min: 0, max: 100000)
    guard x < targetWindow.rect.width, y < targetWindow.rect.height else { try fail("invalid-request", "Point lies outside the bound window") }
    return (nil, CGPoint(x: targetWindow.rect.minX + x, y: targetWindow.rect.minY + y))
}
// Availability is checked before any synthetic focus or input is dispatched.
// This undocumented Apple entry point is isolated; no proprietary helper is loaded.
enum WindowLocationAPI {
    typealias Setter = @convention(c) (CGEvent, CGPoint) -> Void
    static let setter: Setter? = {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW | RTLD_LOCAL),
              let symbol = dlsym(handle, "CGEventSetWindowLocation") else { return nil }
        // Keep the system framework handle alive for the process lifetime.
        return unsafeBitCast(symbol, to: Setter.self)
    }()
}
func post(_ event: CGEvent, _ session: Session, localBounds: CGRect? = nil, release: Bool = false, flags: CGEventFlags = []) throws {
    guard (try? ProcessIdentity(session.target.pid)) == session.identity else {
        if release { return }
        try fail("target-unavailable", "Process identity expired before input dispatch")
    }
    event.flags = flags // Explicit packet-local flags; never inherit human modifiers.
    event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(session.target.window))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(session.target.window))
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(session.target.window))
    event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(session.target.pid))
    if let bounds = localBounds {
        guard let setter = WindowLocationAPI.setter else { try fail("unsupported", "Window-local input is unavailable on this macOS version") }
        let point = event.location
        setter(event, CGPoint(x: point.x - bounds.minX, y: point.y - bounds.minY))
    }
    try session.dispatch(release: release) {
        if !release {
            guard let protection = session.focusProtection else { try fail("unsupported", "Input lacks a scoped keyboard-protection lease") }
            try protection.authorizeAgentInput()
        }
        refreshProcessEventTimestamp(event)
        event.postToPid(session.target.pid)
    }
}
func mouse(_ type: CGEventType, _ point: CGPoint, _ session: Session, _ targetWindow: Window, button: CGMouseButton = .left, count: Int = 1) throws {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
        try fail("internal", "Could not construct process-directed mouse event")
    }
    event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
    try post(event, session, localBounds: targetWindow.rect, release: [.leftMouseUp, .rightMouseUp, .otherMouseUp].contains(type))
}
// Accessed only by the serialized native operation worker. A failed cleanup is
// never mistaken for pre-existing focus in a later session on the same process.
var focusQuarantine: [pid_t: ProcessIdentity] = [:]
func appLocalFocusState(_ pid: pid_t) -> Bool? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.15)
    guard let value = attr(app, kAXFrontmostAttribute) as? NSNumber,
          CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
    return value.boolValue
}
func requireCleanLocalFocus(_ session: Session) throws {
    guard let dirty = focusQuarantine[session.target.pid] else { return }
    if dirty != session.identity || LiveForeground.pid() == session.target.pid || appLocalFocusState(session.target.pid) == false {
        focusQuarantine.removeValue(forKey: session.target.pid)
        return
    }
    try fail("unsupported", "Process is quarantined after temporary focus cleanup failed")
}
@discardableResult func requireKeyboardTarget(_ requested: AXUIElement?, _ session: Session, _ targetWindow: Window, typing: Bool, revoke: Bool, preflight: Bool = false) throws -> AXUIElement {
    let validationDeadline = Date().addingTimeInterval(2)
    func reject() throws -> Never {
        if revoke { stopped(session) }
        try fail("unsupported", "Keyboard target is no longer a permitted app-local focused element in the bound window")
    }
    try session.check(); _ = try selfCheckWindow(session, targetWindow)
    let root = try axWindow(session, targetWindow)
    let app = AXUIElementCreateApplication(session.target.pid)
    AXUIElementSetMessagingTimeout(app, 0.15)
    func focusedElement() -> AXUIElement? {
        guard let value = attr(app, kAXFocusedUIElementAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(value, to: AXUIElement.self)
    }
    let focused = focusedElement()
    guard let element = requested ?? focused else { try reject() }
    func matchesFocus(_ current: AXUIElement?) -> Bool {
        if let current = current {
            return KeyboardTargetPolicy.permitsFocus(CFEqual(current, element) ? .matches : .different,
                isPreflight: preflight, requestedFieldFocused: nil, appLocallyActive: nil)
        }
        return KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: preflight,
            requestedFieldFocused: preflight ? requested.flatMap { attr($0, kAXFocusedAttribute) as? Bool } : nil,
            appLocallyActive: preflight ? appLocalFocusState(session.target.pid) : nil)
    }
    guard matchesFocus(focused) else { try reject() }
    let ownsWindow = CFEqual(element, root) || attr(element, kAXWindowAttribute).map { CFEqual($0, root) } == true
    guard ownsWindow, let role = attr(element, kAXRoleAttribute) as? String else { try reject() }
    var settable = DarwinBoolean(false)
    let valueSettable = typing && AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
    guard KeyboardTargetPolicy.permits(role: role, enabled: attr(element, kAXEnabledAttribute) as? Bool,
          valueSettable: valueSettable, editable: typing ? attr(element, "AXEditable") as? Bool : nil,
          readOnly: typing ? attr(element, "AXReadOnly") as? Bool : nil, typing: typing) else { try reject() }
    var ancestor = element, reachedWindow = false
    for _ in 0..<30 {
        try session.check()
        guard Date() < validationDeadline else { try fail("timeout", "Keyboard target validation timed out") }
        if secure(ancestor) { try reject() }
        if CFEqual(ancestor, root) { reachedWindow = true; break }
        guard let parent = attr(ancestor, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID() else { try reject() }
        ancestor = unsafeBitCast(parent, to: AXUIElement.self)
    }
    guard reachedWindow, matchesFocus(focusedElement()) else { try reject() }
    return element
}

func validateHumanControl(_ guardState: HumanControlGuard, _ session: Session, allowCancelled: Bool = false, allowSeedTransition: Bool = false, activation: ForegroundRestorationAuthority? = nil) throws {
    if !allowCancelled { try session.check() }
    do {
        if let activation = activation { try guardState.checkActivation(activation) } else { try guardState.check() }
        try session.focusProtection?.check(guardState, allowSeedTransition: allowSeedTransition)
    }
    catch let violation as HumanControlViolation {
        stopped(session)
        try fail("unsupported", violation.message)
    }
}
final class LocalInputScope {
    let session: Session
    let targetWindow: Window
    let human: HumanControlGuard
    private let deadline = Date().addingTimeInterval(12)
    private var seeded = false
    private var finished = false
    private var activation: ActivationScope?
    private var controlFocusDeadlineNs: UInt64?
    private let activate: CGEvent
    private let deactivate: CGEvent
    private let activationMouse: (down: CGEvent, up: CGEvent)?
    private(set) var cleanupMessage = "Temporary app-local focus cleanup failed; process quarantined"
    init(_ session: Session, _ targetWindow: Window, _ human: HumanControlGuard) throws {
        self.session = session; self.targetWindow = targetWindow; self.human = human
        try requireCleanLocalFocus(session)
        let root = try axWindow(session, targetWindow)
        let activationPoint: AppLocalActivationPoint
        if let value = attr(root, "AXActivationPoint") {
            if CFGetTypeID(value) == CFNullGetTypeID() { activationPoint = .absent }
            else if CFGetTypeID(value) == AXValueGetTypeID() {
                let ax = unsafeBitCast(value, to: AXValue.self)
                var point = CGPoint.zero
                activationPoint = AXValueGetType(ax) == .cgPoint && AXValueGetValue(ax, .cgPoint, &point) ? .point(point) : .unsupported
            } else { activationPoint = .unsupported }
        } else { activationPoint = .unsupported }
        try session.check(); _ = try selfCheckWindow(session, targetWindow)
        let notifications = DispatchQueue.main.sync {
            AppLocalFocusEvents(windowID: targetWindow.id, bounds: targetWindow.rect, activationPoint: activationPoint)
        }
        guard let notifications = notifications else { try fail("unsupported", "App-local focus notifications are unavailable") }
        self.activate = notifications.activate; self.deactivate = notifications.deactivate
        self.activationMouse = notifications.activationMouse
    }
    func check(allowSeedTransition: Bool = false) throws {
        try session.check(); _ = try selfCheckWindow(session, targetWindow)
        guard Date() < deadline else { try fail("timeout", "Native input exceeded its operation deadline") }
        try validateHumanControl(human, session, allowSeedTransition: allowSeedTransition, activation: allowSeedTransition ? activation?.authority : nil)
    }
    func begin() throws {
        try check(); try requireCleanLocalFocus(session)
        guard let active = appLocalFocusState(session.target.pid) else { try fail("unsupported", "Cannot determine app-local focus ownership") }
        try check() // AX focus lookup may have blocked while human/window state changed.
        if active { return }
        guard let protection = session.focusProtection else { try fail("unsupported", "Own-seed keyboard protection is unavailable") }
        let activationScope = try ActivationScope(session: session, victim: human.lastSample.foregroundPid, human: human, validate: { try self.check() })
        activation = activationScope
        defer {
            let clean = activationScope.finish()
            protection.detachForegroundAuthority(activationScope.authority); activation = nil
            if !clean { stopped(session) }
        }
        try protection.attachForegroundAuthority(activationScope.authority, healthy: { [weak activationScope] in activationScope?.hasActiveResources == true })
        try session.dispatch(release: false) { try activationScope.arm(); try protection.issueOwnSeed(activate) }
        activationScope.noteEnforcerEvent(activate)
        seeded = true; focusQuarantine[session.target.pid] = session.identity
        if let mouse = activationMouse {
            var resamples = 0
            defer {
                if resamples > 0, let data = try? JSONSerialization.data(withJSONObject: ["phase": "activation-mouse-resampled", "count": resamples], options: [.sortedKeys]) {
                    try? FileHandle.standardError.write(contentsOf: data + Data([10]))
                }
            }
            while true {
                try check(allowSeedTransition: true)
                var issued = false
                try session.dispatch(release: false) { issued = try protection.issueActivationMouse(mouse.down) }
                if issued { break }
                resamples += 1
                Thread.sleep(forTimeInterval: 0.005)
            }
            // Down can throw only before posting. Once posted, pair it before
            // any blocking ownership check; release dispatch bypasses Stop.
            try session.dispatch(release: true) { _ = try protection.issueActivationMouse(mouse.up) }
            activationScope.noteEnforcerEvent(mouse.up)
            try check(allowSeedTransition: true)
        }
        while protection.seedWaitEligible {
            // Only the activation mouse pair may precede steady ownership.
            // No keyboard down/chunk is sent during this <=2s seed phase.
            try check(allowSeedTransition: true)
            guard activationScope.isHealthy else { try fail("unsupported", "Activation notification scope lost health") }
            if appLocalFocusState(session.target.pid) == true {
                let repaired = try activationScope.repairVictimWindow()
                if repaired && session.focusProtection?.isKeyboardSteady == true && activationScope.settled {
                    guard protection.seedWaitEligible else { break }
                    guard activationScope.finish() else { try fail("unsupported", "Activation update/loop cleanup did not complete") }
                    try check(); return
                }
            }
            Thread.sleep(forTimeInterval: 0.005)
        }
        try fail("unsupported", "Target focus did not settle under verified keyboard protection")
    }
    @discardableResult func finish() -> Bool {
        if finished { return true }
        guard seeded else {
            finished = true
            do { try validateHumanControl(human, session, allowCancelled: true); return true }
            catch { cleanupMessage = "Human-control attribution failed at operation completion"; return false }
        }
        if controlFocusDeadlineNs == nil { controlFocusDeadlineNs = DispatchTime.now().uptimeNanoseconds + 300_000_000 }
        var attributionFailed = false
        var cleanupVeto: FocusRoutingState.CleanupDisposition?
        func checkHuman() {
            var waits = 0
            while DispatchTime.now().uptimeNanoseconds < (controlFocusDeadlineNs ?? 0),
                  session.focusProtection?.humanStopControlFocusPending() == true {
                waits += 1; Thread.sleep(forTimeInterval: 0.005)
            }
            if waits > 0, let data = try? JSONSerialization.data(withJSONObject: ["phase": "stop-control-focus-waited", "count": waits], options: [.sortedKeys]) { try? FileHandle.standardError.write(contentsOf: data + Data([10])) }
            // Cleanup needs the typed violation to preserve a detected takeover
            // or unavailable sample through the final deactivation boundary.
            do { try human.check(); try session.focusProtection?.checkCleanup(human) }
            catch let violation as HumanControlViolation {
                attributionFailed = true; cleanupMessage = violation.message
                if violation == .targetForeground { cleanupVeto = .humanTakeover }
                else if violation == .unavailableSample || violation == .unstableSample { cleanupVeto = .retain }
                stopped(session)
            }
            catch let error as Failure { attributionFailed = true; cleanupMessage = "Focus cleanup validation failed: " + error.message }
            catch { attributionFailed = true; cleanupMessage = "Human-control attribution failed during focus cleanup" }
        }
        checkHuman()
        // Mouse/key releases run first. A human-owned OS foreground app must never
        // receive our deactivation notification, even during error cleanup.
        for _ in 0..<2 {
            guard let foreground = LiveForeground.pid() else {
                focusQuarantine[session.target.pid] = session.identity; finished = true
                cleanupMessage = "Live foreground is unavailable during focus cleanup; protection retained"
                stopped(session); return false
            }
            if foreground == session.target.pid {
                focusQuarantine.removeValue(forKey: session.target.pid); finished = true
                cleanupMessage = "Target became the human foreground app; local deactivation was skipped"
                stopped(session); return false
            }
            guard (try? ProcessIdentity(session.target.pid)) == session.identity else {
                if processReplacedOrExited(session.target.pid, session.identity), focusQuarantine[session.target.pid] == session.identity { focusQuarantine.removeValue(forKey: session.target.pid) }
                if !processReplacedOrExited(session.target.pid, session.identity) { focusQuarantine[session.target.pid] = session.identity }
                finished = true; cleanupMessage = "Process identity is unavailable or changed during focus cleanup"
                stopped(session); return false
            }
            checkHuman()
            var decision = FocusRoutingState.CleanupDisposition.retain
            do { try session.dispatch(release: true) {
                if let protection = session.focusProtection { decision = try protection.dispatchDeactivation(deactivate, veto: cleanupVeto) }
            } }
            catch { break }
            guard decision == .deactivate else {
                if decision == .humanTakeover, LiveForeground.pid() == session.target.pid { focusQuarantine.removeValue(forKey: session.target.pid) }
                else { focusQuarantine[session.target.pid] = session.identity }
                finished = true; cleanupMessage = "Human takeover or unknown foreground prevented local deactivation; protection retained unless takeover is verified"
                stopped(session); return false
            }
            let deadline = Date().addingTimeInterval(0.3)
            while Date() < deadline {
                if LiveForeground.pid() == session.target.pid { break }
                guard (try? ProcessIdentity(session.target.pid)) == session.identity else { break }
                if appLocalFocusState(session.target.pid) == false {
                    guard session.focusProtection?.confirmOwnSeedCleanup() == true else { break }
                    focusQuarantine.removeValue(forKey: session.target.pid)
                    seeded = false; finished = true
                    checkHuman(); return !attributionFailed
                }
                Thread.sleep(forTimeInterval: 0.01)
            }
        }
        // Ownership remains quarantined until a later verified inactive/foreground
        // transition or process replacement; it cannot be borrowed by a new session.
        focusQuarantine[session.target.pid] = session.identity
        stopped(session)
        return false
    }
}
func clipboardFailure(_ error: ClipboardPasteError) -> Failure {
    switch error {
    case .conflict: return Failure("clipboard-conflict", "Clipboard ownership changed. Cleanup preserved the newer owner at its checkpoint; inspect the target before retrying.")
    case .restoreFailed: return Failure("clipboard-restore-failed", "Clipboard restoration failed. Stop clipboard operations and report this; target effect remains unverified.")
    case .snapshotUnavailable: return Failure("unsupported", "Clipboard representations could not be preserved; paste was not started.")
    case .tooLarge: return Failure("unsupported", "Clipboard snapshot exceeds the supported item, type or retained-byte bounds.")
    case .writeFailed: return Failure("unsupported", "Clipboard data dispatch failed; target effect remains unverified.")
    case .notRead: return Failure("timeout", "No clipboard consumption was observed. Inspect the target before retrying.")
    case .timeout: return Failure("timeout", "Clipboard consumption did not settle. Inspect the target before retrying.")
    }
}
func perform(_ session: Session, _ action: Object) throws -> Object {
    guard AXIsProcessTrusted() else { try fail("permission-denied", "Accessibility permission is required") }
    let targetWindow = try window(session)
    _ = try axWindow(session, targetWindow)
    let type = try string(action, "type")
    let fields: [String: [String]] = ["click": ["target", "button", "count"], "drag": ["from", "to", "durationMs"],
        "type": ["target", "text"], "paste": ["target", "text", "format"], "pressKey": ["target", "key", "modifiers"], "scroll": ["target", "deltaX", "deltaY"],
        "setValue": ["target", "value"], "performAction": ["target", "action"], "selectText": ["target", "text", "prefix", "suffix", "selection"]]
    guard let allowed = fields[type] else { try fail("invalid-request", "Unknown action type") }
    try keys(action, ["type"] + allowed, ["type", type == "drag" ? "from" : "target"])
    let (element, point) = try resolve(dictionary(action, type == "drag" ? "from" : "target"), session, targetWindow)
    let initialHuman: HumanControlSample
    do { initialHuman = try HumanControlSample.capture() }
    catch let violation as HumanControlViolation { try fail("unsupported", violation.message) }
    let before = HumanControlGuard(targetPid: session.target.pid, initial: initialHuman)
    try validateHumanControl(before, session)
    defer { session.invalidate() }
    var preparedPaste: ClipboardPasteTransaction?
    if type == "paste" {
        guard experimentalInput, WindowLocationAPI.setter != nil else { try fail("unsupported", "Background paste is disabled until controlled native input acceptance") }
        guard let element = element else { try fail("invalid-request", "Paste requires a fresh editable element reference") }
        try requireKeyboardTarget(element, session, targetWindow, typing: true, revoke: false)
        let contents: [NSPasteboard.PasteboardType: Data]
        do { contents = try PasteRepresentations.make(text: string(action, "text", max: 16384, empty: true), format: string(action, "format", max: 8)) }
        catch PasteRepresentationError.unavailable { try fail("unsupported", "The local rich-paste renderer is unavailable") }
        catch { try fail("invalid-request", "Invalid or excessive paste content or format") }
        // Snapshot before taking the temporary input/focus lease. Framework
        // pasteboard reads may block; no clipboard mutation or input has begun.
        do {
            preparedPaste = try ClipboardPasteTransaction(board: NSPasteboard.general, contents: contents, check: {
                try validateHumanControl(before, session); _ = try selfCheckWindow(session, targetWindow)
            })
        } catch let error as ClipboardPasteError { throw clipboardFailure(error) }
    }
    DispatchQueue.main.async { presentation.move(point, session: session) }
    let protection = try FocusProtection(session, before, window: targetWindow)
    session.focusProtection = protection
    defer { session.focusProtection = nil }
    var operationError: Error?
    do {
        if type == "setValue" {
            guard let element = element else { try fail("invalid-request", "setValue requires an element") }
            let value = try string(action, "value", max: 16384, empty: true)
            var settable = DarwinBoolean(false)
            guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue else {
                try fail("unsupported", "Element does not support setting its value")
            }
            try validateHumanControl(before, session)
            guard AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString) == .success else {
                try fail("unsupported", "Target rejected AX value dispatch")
            }
        } else if type == "performAction" || (type == "click" && element != nil && action["button"] == nil && action["count"] == nil) {
            guard let element = element else { try fail("invalid-request", "AX action requires an element") }
            let name = type == "click" ? "press" : try string(action, "action")
            // AXRaise can activate the target and is deliberately never dispatched.
            guard let native = actionNames[name], supportedAXActions(element).contains(name) else {
                try fail("unsupported", "AX action is unavailable without foreground takeover")
            }
            try validateHumanControl(before, session)
            guard AXUIElementPerformAction(element, native as CFString) == .success else { try fail("unsupported", "Target rejected AX action dispatch") }
        } else {
            guard experimentalInput else { try fail("unsupported", "Process-directed input is disabled until the controlled fixture verifies background effects") }
            try nativeInput(type, action, session, targetWindow, element, point, before, paste: preparedPaste)
        }
        // Allow target-side asynchronous dispatch to settle before checking human state.
        // This remains a bounded sample, not proof that every app preserves focus indefinitely.
        for _ in 0..<10 { try validateHumanControl(before, session); Thread.sleep(forTimeInterval: 0.01) }
        try validateHumanControl(before, session)

    } catch let error as ClipboardPasteError { operationError = clipboardFailure(error) }
    catch { operationError = error }
    guard protection.finish() else {
        if let error = operationError as? Failure, error.code.hasPrefix("clipboard-") {
            throw Failure(error.code, error.message + " Keyboard protection was also retained; target quarantined.")
        }
        try fail("unsupported", "Keyboard protection retained after unsafe cleanup; target quarantined")
    }
    if let operationError = operationError { throw operationError }
    return ["acknowledgement": "dispatched", "effect": "unverified", "message": "Dispatch acknowledged; observe the target to verify its effect"]
}
func nativeInput(_ type: String, _ action: Object, _ session: Session, _ targetWindow: Window, _ element: AXUIElement?, _ point: CGPoint, _ human: HumanControlGuard, paste: ClipboardPasteTransaction? = nil) throws {
    guard WindowLocationAPI.setter != nil else { try fail("unsupported", "Window-local input is unavailable on this macOS version") }
    let dispatch: (LocalInputScope) throws -> Void
    switch type {
    case "click":
        let button = action["button"] == nil ? "left" : try string(action, "button")
        let count = action["count"] == nil ? 1 : Int(try number(action, "count", min: 1, max: 3, integer: true))
        let buttons: [String: (CGMouseButton, CGEventType, CGEventType)] = [
            "left": (.left, .leftMouseDown, .leftMouseUp), "right": (.right, .rightMouseDown, .rightMouseUp),
            "middle": (.center, .otherMouseDown, .otherMouseUp)]
        guard let (nativeButton, down, up) = buttons[button] else { try fail("invalid-request", "Unknown mouse button") }
        dispatch = { scope in
            for click in 1...count {
                try scope.check(); try mouse(down, point, session, targetWindow, button: nativeButton, count: click)
                defer { try? mouse(up, point, session, targetWindow, button: nativeButton, count: click) }
                try scope.check()
            }
        }
    case "drag":
        let (_, end) = try resolve(dictionary(action, "to"), session, targetWindow)
        let duration = action["durationMs"] == nil ? 300 : try number(action, "durationMs", min: 1, max: 10000, integer: true)
        dispatch = { scope in
            try scope.check(); try mouse(.leftMouseDown, point, session, targetWindow)
            var last = point
            defer { try? mouse(.leftMouseUp, last, session, targetWindow) }
            let steps = max(1, Int(duration / 10))
            for step in 1...steps {
                try scope.check()
                last = CGPoint(x: point.x + (end.x - point.x) * Double(step) / Double(steps), y: point.y + (end.y - point.y) * Double(step) / Double(steps))
                try mouse(.leftMouseDragged, last, session, targetWindow)
                let cursorPoint = last
                DispatchQueue.main.async { presentation.move(cursorPoint, session: session) }
                Thread.sleep(forTimeInterval: duration / Double(steps) / 1000)
            }
        }
    case "scroll":
        let x = try number(action, "deltaX", min: -10000, max: 10000), y = try number(action, "deltaY", min: -10000, max: 10000)
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(y), wheel2: Int32(x), wheel3: 0) else { try fail("internal", "Could not create scroll event") }
        event.location = point
        dispatch = { scope in try scope.check(); try post(event, session, localBounds: targetWindow.rect) }
    case "paste":
        guard let element = element, let paste = paste else { try fail("invalid-request", "Paste requires a prepared element transaction") }
        let keyboardElement = try requireKeyboardTarget(element, session, targetWindow, typing: true, revoke: false)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) else { try fail("internal", "Could not create paste key pair") }
        dispatch = { scope in
            var operationError: Error?
            do {
                try scope.check()
                try requireKeyboardTarget(keyboardElement, session, targetWindow, typing: true, revoke: true)
                guard attr(keyboardElement, kAXFocusedAttribute) as? Bool == true else { stopped(session); try fail("unsupported", "Paste target lost app-local focus") }
                var value = attr(keyboardElement, kAXValueAttribute), range = attr(keyboardElement, kAXSelectedTextRangeAttribute)
                try paste.install(); try scope.check()
                try requireKeyboardTarget(keyboardElement, session, targetWindow, typing: true, revoke: true)
                try post(down, session, flags: .maskCommand); try post(up, session, release: true, flags: .maskCommand)
                try paste.waitForConsumption(activity: {
                    try scope.check()
                    // All input has already been paired. AX activity is an
                    // optional settling hint; never read values without fresh
                    // proof, or revoke a completed paste for transient AX loss.
                    guard (try? requireKeyboardTarget(keyboardElement, session, targetWindow, typing: true, revoke: false)) != nil else {
                        try scope.check(); return false
                    }
                    let currentValue = attr(keyboardElement, kAXValueAttribute), currentRange = attr(keyboardElement, kAXSelectedTextRangeAttribute)
                    func same(_ a: CFTypeRef?, _ b: CFTypeRef?) -> Bool {
                        if let a = a, let b = b { return CFEqual(a, b) }
                        return a == nil && b == nil
                    }
                    let changed = !same(value, currentValue) || !same(range, currentRange)
                    value = currentValue; range = currentRange
                    try scope.check(); return changed
                })
            } catch { operationError = error }
            do { try paste.finish() } catch { operationError = error }
            if let operationError = operationError { throw operationError }
        }
    case "selectText":
        guard let selected = element else { try fail("invalid-request", "Selection requires a fresh element reference") }
        let text = try string(action, "text", max: 16384, empty: true)
        guard !text.isEmpty else { try fail("invalid-request", "Selection text must not be empty") }
        let prefix = try action["prefix"].map { _ in try string(action, "prefix", max: 16384, empty: true) }
        let suffix = try action["suffix"].map { _ in try string(action, "suffix", max: 16384, empty: true) }
        let modeName = action["selection"] == nil ? "text" : try string(action, "selection", max: 32)
        let modes: [String: SelectionText.Mode] = ["text": .text, "cursor_before": .before, "cursor_after": .after]
        guard let mode = modes[modeName] else { try fail("invalid-request", "Unknown selection mode") }
        func validateSelectionElement() throws {
            let (current, _) = try resolve(dictionary(action, "target"), session, targetWindow)
            guard let current = current, CFEqual(current, selected) else { try fail("element-unavailable", "Selection element changed") }
            var settable = DarwinBoolean(false)
            guard AXUIElementIsAttributeSettable(selected, kAXSelectedTextRangeAttribute as CFString, &settable) == .success,
                  settable.boolValue else { try fail("unsupported", "Target cannot set its text range") }
        }
        try validateSelectionElement()
        dispatch = { scope in
            do {
                _ = try SelectionOperation.perform(text: text, prefix: prefix, suffix: suffix, mode: mode, readValue: {
                    try scope.check(); try validateSelectionElement()
                    guard let value = attr(selected, kAXValueAttribute) as? String, value.utf16.count <= 1_048_576 else {
                        try fail("unsupported", "Selection text is unavailable or exceeds its bound")
                    }
                    try scope.check(); return value
                }, focus: {
                    try scope.begin()
                    try scope.check(); try validateSelectionElement()
                    let app = AXUIElementCreateApplication(session.target.pid)
                    AXUIElementSetMessagingTimeout(app, 0.15)
                    if let focused = attr(app, kAXFocusedUIElementAttribute), CFEqual(focused, selected) { return }
                    var settable = DarwinBoolean(false)
                    if AXUIElementIsAttributeSettable(selected, kAXFocusedAttribute as CFString, &settable) == .success, settable.boolValue {
                        try scope.check()
                        try session.dispatch(release: false) {
                            guard let protection = session.focusProtection else { try fail("unsupported", "Selection lacks a scoped input lease") }
                            try protection.authorizeAgentInput()
                            _ = AXUIElementSetAttributeValue(selected, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                        }
                        try scope.check()
                        if let focused = attr(app, kAXFocusedUIElementAttribute), CFEqual(focused, selected) { return }
                    }
                    let (fresh, focusPoint) = try resolve(dictionary(action, "target"), session, targetWindow)
                    guard let fresh = fresh, CFEqual(fresh, selected) else { try fail("element-unavailable", "Selection focus target changed") }
                    try scope.check()
                    try mouse(.leftMouseDown, focusPoint, session, targetWindow)
                    var released = false
                    defer { if !released { try? mouse(.leftMouseUp, focusPoint, session, targetWindow) } }
                    try mouse(.leftMouseUp, focusPoint, session, targetWindow); released = true
                    let deadline = Date().addingTimeInterval(0.3)
                    while Date() < deadline {
                        try scope.check()
                        if let focused = attr(app, kAXFocusedUIElementAttribute), CFEqual(focused, selected) { return }
                        Thread.sleep(forTimeInterval: 0.005)
                    }
                    try fail("unsupported", "Selection field focus did not settle")
                }, validate: {
                    try scope.check(); try validateSelectionElement()
                    try requireKeyboardTarget(selected, session, targetWindow, typing: false, revoke: true)
                    try scope.check()
                }, write: { range in
                    var nativeRange = CFRange(location: range.location, length: range.length)
                    guard let value = AXValueCreate(.cfRange, &nativeRange) else { try fail("internal", "Cannot encode selection range") }
                    try scope.check()
                    try session.dispatch(release: false) {
                        guard let protection = session.focusProtection else { try fail("unsupported", "Selection lacks a scoped input lease") }
                        try protection.authorizeAgentInput()
                        guard AXUIElementSetAttributeValue(selected, kAXSelectedTextRangeAttribute as CFString, value) == .success else {
                            try fail("unsupported", "Target rejected selection range")
                        }
                    }
                }, checkpoint: { try session.check() })
            } catch SelectionOperation.Failure.missingOrAmbiguous {
                try fail("element-unavailable", "Selection text is missing or ambiguous")
            } catch SelectionOperation.Failure.valueChanged {
                try fail("stale-snapshot", "Selection text changed before mutation; observe again")
            }
        }
    case "type", "pressKey":
        if type == "type" && element == nil { try fail("unsupported", "Unicode typing requires a fresh editable element reference") }
        var code: CGKeyCode = 0
        var keyFlags: CGEventFlags = []
        var units: [UniChar] = []
        if type == "type" {
            units = Array(try string(action, "text", max: 16384, empty: true).utf16)
            guard !units.isEmpty else { try fail("invalid-request", "Text must not be empty") }
        } else {
            let key = try string(action, "key", max: 64)
            let codes: [String: CGKeyCode] = ["Enter": 36, "Return": 36, "Tab": 48, "Space": 49, "Backspace": 51, "Escape": 53, "Delete": 117, "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126, "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121]
            // SDK kVK_ANSI positions, not Unicode or current-layout translation.
            // Letter names are case-insensitive; Shift is always explicit.
            let ascii: [String: CGKeyCode] = ["a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
                "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
                "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46]
            guard let mapped = codes[key] ?? (key.utf8.count == 1 ? ascii[key.lowercased()] : nil) else { try fail("unsupported", "Unsupported key; use type for Unicode text") }
            code = mapped
            if let modifiers = action["modifiers"] {
                let flags: [String: CGEventFlags] = ["command": .maskCommand, "control": .maskControl, "option": .maskAlternate, "shift": .maskShift]
                guard let values = modifiers as? [String], values.count <= 4, values.allSatisfy({ flags[$0] != nil }) else { try fail("invalid-request", "Unsupported key modifier") }
                keyFlags = values.reduce(CGEventFlags()) { $0.union(flags[$1]!) }
            }
            guard !keyFlags.contains(.maskCommand) || !["c", "v", "x"].contains(key.lowercased()) else {
                try fail("unsupported", "Clipboard shortcuts require the separate guarded clipboard operation")
            }
        }
        var chunks: [[UniChar]] = [], offset = 0
        while offset < units.count {
            var end = min(offset + 20, units.count)
            if end < units.count && (0xD800...0xDBFF).contains(units[end - 1]) && (0xDC00...0xDFFF).contains(units[end]) { end -= 1 }
            chunks.append(Array(units[offset..<end])); offset = end
        }
        if chunks.isEmpty { chunks = [[]] }
        // Reject unknown/non-editable/secure/focus-mismatched targets before any seed.
        let keyboardElement = try requireKeyboardTarget(element, session, targetWindow, typing: type == "type", revoke: false, preflight: true)
        dispatch = { scope in
            for chunk in chunks {
                try scope.check()
                if type == "type" && attr(keyboardElement, kAXFocusedAttribute) as? Bool != true {
                    stopped(session); try fail("unsupported", "Keyboard target lost app-local focus")
                }
                try requireKeyboardTarget(keyboardElement, session, targetWindow, typing: type == "type", revoke: true)
                try scope.check() // Revalidate after the potentially blocking AX walk.
                guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
                      let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { try fail("internal", "Could not create key events") }
                if !chunk.isEmpty { chunk.withUnsafeBufferPointer { pointer in
                    down.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: pointer.baseAddress)
                    up.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: pointer.baseAddress)
                } }
                try post(down, session, flags: keyFlags); try post(up, session, release: true, flags: keyFlags)
                // Give the target a chance to process auto-advance before the next
                // identity/focus check. No later chunk bypasses that fresh check.
                Thread.sleep(forTimeInterval: 0.01)
            }
        }
    default: try fail("unsupported", "Action cannot be dispatched in the background")
    }
    // Every argument and target above is validated before beginning temporary focus.
    let focus = try LocalInputScope(session, targetWindow, human)
    var operationError: Error?
    do {
        if type != "selectText" { try focus.begin() }
        try dispatch(focus)
        for _ in 0..<5 { try focus.check(); Thread.sleep(forTimeInterval: 0.01) }
    } catch { operationError = error }
    // Cleanup failure is reported even if Stop or another error ended the action.
    guard focus.finish() else {
        if let error = operationError as? ClipboardPasteError {
            let mapped = clipboardFailure(error)
            throw Failure(mapped.code, mapped.message + " " + focus.cleanupMessage)
        }
        try fail("unsupported", focus.cleanupMessage)
    }
    if let operationError = operationError { throw operationError }
}
func handle(_ request: Object, owner: String, epoch: UInt64) throws -> Any {
    let method = try string(request, "method")
    switch method {
    case "status": try keys(request, ["method"], ["method"]); return status()
    case "permissions.request":
        try keys(request, ["method", "permission"], ["method", "permission"])
        let permission = try string(request, "permission")
        guard permission == "accessibility" || permission == "screenRecording" else { try fail("invalid-request", "Unknown permission") }
        // Electron exposes this only after an explicit human settings click, never to agents.
        DispatchQueue.main.sync {
            if permission == "accessibility" {
                _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
            } else { _ = CGRequestScreenCaptureAccess() }
        }
        return status()
    case "activity.observe":
        try keys(request, ["method", "epoch", "settings"], ["method", "epoch", "settings"])
        guard owner == "desktop:recorder" else { try fail("unauthorized-session", "Interaction observation belongs to the host recorder") }
        guard !sessionsLock.withLock({ shuttingDown }) else { try fail("cancelled", "Helper is shutting down") }
        do { return try InteractionHistory.shared.configure(epoch: string(request, "epoch"), settings: dictionary(request, "settings")) }
        catch is HistoryInvalid { try fail("invalid-request", "Invalid interaction observation policy") }
    case "activity.capture":
        try keys(request, ["method", "settings"], ["method", "settings"])
        if let snapshot = try capturePassiveActivity(settings: dictionary(request, "settings"), isCancelled: { sessionsLock.withLock { shuttingDown || ownerEpochs[owner, default: 0] != epoch } }) { return snapshot }
        return NSNull()
    case "apps.list":
        try keys(request, ["method"], ["method"])
        let all = windows()
        return NSWorkspace.shared.runningApplications.filter {
            guard let bundle = $0.bundleIdentifier else { return false }
            return !bundle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && bundle.utf16.count <= 256 &&
                $0.processIdentifier > 0 && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && !$0.isTerminated
        }.prefix(200).map { app -> Object in
            ["bundleId": app.bundleIdentifier!, "pid": app.processIdentifier, "name": clipped(app.localizedName),
             "windows": all.filter { $0.pid == app.processIdentifier }.prefix(100).map { ["windowId": $0.id, "title": clipped($0.title), "bounds": boundsJSON($0.rect)] }]
        }
    case "session.open":
        try keys(request, ["method", "target"], ["method", "target"])
        let target = try Target(dictionary(request, "target"))
        guard target.pid != ProcessInfo.processInfo.processIdentifier else { try fail("target-unavailable", "Requested process identity is unavailable") }
        let binding = try admitRunningApplication(target, isCancelled: {
            sessionsLock.withLock { shuttingDown || ownerEpochs[owner, default: 0] != epoch }
        })
        let session = try Session(owner: owner, target: target, app: binding.app, identity: binding.identity)
        _ = try window(session); _ = try axWindow(session, window(session))
        try requireCleanLocalFocus(session)
        sessionsLock.lock()
        guard !shuttingDown, ownerEpochs[owner, default: 0] == epoch else {
            sessionsLock.unlock(); session.cancel(); try fail("cancelled", "Session opening was stopped")
        }
        if sessions.count >= 100 { sessionsLock.unlock(); try fail("unsupported", "Close an existing session before opening another") }
        sessions[session.id] = session; sessionsLock.unlock()
        DispatchQueue.main.async { presentation.show(session) }
        return ["sessionId": session.id, "threadId": owner, "target": target.json]
    case "session.observe":
        try keys(request, ["method", "sessionId", "screenshot", "maxElements"], ["method", "sessionId"])
        if request["screenshot"] != nil { _ = try bool(request, "screenshot") }
        return try observe(getSession(request, owner), request)
    case "session.perform":
        try keys(request, ["method", "sessionId", "action"], ["method", "sessionId", "action"])
        return try perform(getSession(request, owner), dictionary(request, "action"))
    case "session.close":
        try keys(request, ["method", "sessionId"], ["method", "sessionId"])
        let id = try string(request, "sessionId")
        sessionsLock.lock(); let session = sessions[id]; sessionsLock.unlock()
        guard let session = session, session.owner == owner else { try fail("unauthorized-session", "Unknown session for this thread") }
        session.cancel()
        sessionsLock.lock(); sessions.removeValue(forKey: session.id); sessionsLock.unlock()
        DispatchQueue.main.async { presentation.hide(session) }; return ["closed": true]
    case "stop":
        try keys(request, ["method", "sessionId"], ["method"])
        let selected: [Session]
        if request["sessionId"] != nil {
            let id = try string(request, "sessionId")
            sessionsLock.lock(); let session = sessions[id]; sessionsLock.unlock()
            guard let session = session, session.owner == owner else { try fail("unauthorized-session", "Unknown session for this thread") }
            selected = [session]
        } else { return ["stoppedSessionIds": stopThread(owner).map(\.id)] }

        selected.forEach(stopped)
        sessionsLock.withLock { for session in selected { sessions.removeValue(forKey: session.id) } }
        return ["stoppedSessionIds": selected.map(\.id)]
    case "history.list", "history.settings", "history.configure", "history.clear": try fail("unsupported", "History belongs to the authenticated Electron manager")
    default: try fail("invalid-request", "Unknown method")
    }
}
let pendingLock = NSLock()
var pendingRequests = 0
let validMethods: Set<String> = ["status", "permissions.request", "activity.capture", "activity.observe", "apps.list", "session.open", "session.observe", "session.perform", "session.close", "stop", "history.list", "history.settings", "history.configure", "history.clear"]
func process(_ data: Data) {
    var id = "invalid", method = "status"
    do {
        guard let envelope = try JSONSerialization.jsonObject(with: data) as? Object else { try fail("invalid-request", "Expected a JSON object") }
        try keys(envelope, ["id", "threadId", "request"], ["id", "threadId", "request"])
        id = try string(envelope, "id")
        let owner = try string(envelope, "threadId")
        let request = try dictionary(envelope, "request")
        let requestedMethod = try string(request, "method")
        guard validMethods.contains(requestedMethod) else { try fail("invalid-request", "Unknown method") }; method = requestedMethod
        sessionsLock.lock()
        if (method == "session.open" || method == "activity.capture") && ownerEpochs[owner] == nil {
            guard ownerEpochs.count < 1000 else { sessionsLock.unlock(); try fail("unsupported", "Thread scope capacity reached; restart the helper") }
            ownerEpochs[owner] = 0
        }
        let epoch = ownerEpochs[owner, default: 0]
        sessionsLock.unlock()
        let queuedAt = Date()
        let run = {
            do {
                guard Date().timeIntervalSince(queuedAt) < 15 else { try fail("timeout", "Native request expired in the operation queue") }
                if method.hasPrefix("session.") || method == "activity.capture" {
                    sessionsLock.lock(); let revoked = shuttingDown || ownerEpochs[owner, default: 0] != epoch; sessionsLock.unlock()
                    guard !revoked else { try fail("cancelled", "Thread computer work was stopped") }
                }
                emit(["id": id, "response": ["method": method, "result": try handle(request, owner: owner, epoch: epoch)]])
            }
            catch let error as Failure { emit(["id": id, "response": ["method": method, "error": ["code": error.code, "message": error.message]]]) }
            catch { emit(["id": id, "response": ["method": method, "error": ["code": "internal", "message": "Native operation failed"]]]) }
        }
        // Stop bypasses the operation queue and revokes references immediately.
        if method == "stop" || method == "activity.observe" { run() } else {
            pendingLock.lock()
            guard pendingRequests < 64 else { pendingLock.unlock(); try fail("timeout", "Native operation queue is full") }
            pendingRequests += 1; pendingLock.unlock()
            work.async { run(); pendingLock.withLock { pendingRequests -= 1 } }
        }
    } catch let error as Failure { emit(["id": id, "response": ["method": method, "error": ["code": error.code, "message": error.message]]]) }
    catch { emit(["id": id, "response": ["method": method, "error": ["code": "invalid-request", "message": "Malformed JSON frame"]]]) }
}
func shutdown() {
    InteractionHistory.shared.shutdown()
    sessionsLock.lock(); shuttingDown = true; let remaining = Array(sessions.values); sessionsLock.unlock()
    remaining.forEach { $0.cancel() }
    work.async { ActivationScope.awaitSafeShutdown(); FocusProtection.awaitSafeShutdown(); DispatchQueue.main.async { NSApplication.shared.terminate(nil) } }
}
// Cooperative termination lets an in-flight sequence release any posted down event.
signal(SIGPIPE, SIG_IGN)
signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
let terminationSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
terminationSignal.setEventHandler { shutdown() }; terminationSignal.resume()
let interruptSignal = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
interruptSignal.setEventHandler { shutdown() }; interruptSignal.resume()
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
presentation.stop = humanStopped
DispatchQueue.global(qos: .userInitiated).async {
    var buffer = Data(), dropping = false
    while true {
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty { break }
        for byte in chunk {
            if byte == 10 {
                if !dropping && !buffer.isEmpty { process(buffer) }
                buffer.removeAll(keepingCapacity: true); dropping = false
            } else if !dropping {
                if buffer.count >= 262144 {
                    buffer.removeAll(keepingCapacity: true); dropping = true
                    emit(["id": "invalid", "response": ["method": "status", "error": ["code": "invalid-request", "message": "Frame exceeds 256 KiB"]]])
                } else { buffer.append(byte) }
            }
        }
    }
    if !dropping && !buffer.isEmpty { process(buffer) }
    shutdown()
}
app.run()
