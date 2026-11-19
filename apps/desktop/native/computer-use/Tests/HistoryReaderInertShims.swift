// Test-module external boundaries only. No live AX objects, app inventory or UI startup.
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

typealias Object = [String: Any]
typealias AXUIElement = CFData
typealias AXObserver = CFData
typealias AXObserverCallback = (AXObserver, AXUIElement, CFString, UnsafeMutableRawPointer?) -> Void

typealias CFMachPort = CFData
typealias CFRunLoop = CFData
typealias CFRunLoopSource = CFData
typealias CGEventTapCallBack = (CGEventTapProxy, CGEventType, CGEvent, UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>?
final class CGEvent {
    var location: CGPoint = .zero, flags: CGEventFlags = []
    var integers: [UInt32: Int64] = [:]
    func getIntegerValueField(_ field: CGEventField) -> Int64 { integers[field.rawValue] ?? 0 }
    func getDoubleValueField(_ field: CGEventField) -> Double { 0 }
}
struct InertThread { let body: () -> Void; init(_ body: @escaping () -> Void) { self.body = body }; func start() { body() } }
func InertCFMachPortInvalidate(_ port: CFMachPort) {}
func InertCFRunLoopWakeUp(_ loop: CFRunLoop) {}
func InertCFMachPortCreateRunLoopSource(_ allocator: CFAllocator?, _ port: CFMachPort, _ order: CFIndex) -> CFRunLoopSource? { nil }
func InertCFRunLoopGetCurrent() -> CFRunLoop { InertAX.world.nodes["observer"]! }
func InertCFRunLoopAddSource(_ loop: CFRunLoop, _ source: CFRunLoopSource, _ mode: CFRunLoopMode) {}
func InertCFRunLoopRemoveSource(_ loop: CFRunLoop, _ source: CFRunLoopSource, _ mode: CFRunLoopMode) {}
@discardableResult func InertCFRunLoopRunInMode(_ mode: CFRunLoopMode, _ seconds: CFTimeInterval, _ finished: Bool) -> CFRunLoopRunResult { fatalError("Inert test attempted runloop") }
enum InertFailure: Error { case absentProcess }
struct ProcessIdentity: Equatable {
    let startSeconds: UInt64, startMicroseconds: UInt64, executable: URL
    init(_ pid: pid_t) throws {
        guard pid == InertAX.world.pid else { throw InertFailure.absentProcess }
        startSeconds = InertAX.world.processStart; startMicroseconds = 0
        executable = URL(fileURLWithPath: "/inert/synthetic-application")
    }
}
struct NSRunningApplication {
    enum Policy { case regular }
    let processIdentifier: pid_t
    init?(processIdentifier: pid_t) { guard processIdentifier == InertAX.world.pid else { return nil }; self.processIdentifier = processIdentifier }
    var bundleIdentifier: String? { InertAX.world.bundleReads += 1; InertAX.world.onBundle?(); return InertAX.world.bundle }
    var localizedName: String? { "Synthetic application" }
    var executableURL: URL? { URL(fileURLWithPath: "/inert/synthetic-application") }
    var activationPolicy: Policy { .regular }
    var isTerminated: Bool { false }
}
enum LiveForeground { static func pid() -> pid_t? { InertAX.world.foreground } }

enum InertAX {
    static var world = InertWorld()
    static var clock: UInt64 { world.clock }
    static var date: Date { world.model ? Date(timeIntervalSince1970: 1_700_000_000 + Double(world.clock - 1_000_000_000) / 1_000_000_000) : Date() }
    static func readerOrigin() -> UInt64 {
        guard world.model else { return world.clock }
        world.readerIndex += 1; world.readerStart = world.clock
        return world.clock
    }
    static func encode(_ object: [String: Any]) throws -> Data {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        world.onEncode?(); return data
    }
    static var secure: Bool? { let value = world.secure; world.onSecure?(); return value }
    static var secureAvailable: Bool { world.secure != nil }
    static func forbiddenTap(pid: pid_t, place: CGEventTapPlacement, options: CGEventTapOptions, eventsOfInterest: CGEventMask, callback: CGEventTapCallBack, userInfo: UnsafeMutableRawPointer?) -> CFMachPort? { fatalError("Inert test attempted an event tap") }
    static func forbiddenTapEnable(tap: CFMachPort, enable: Bool) { fatalError("Inert test attempted tap enable") }
}
final class InertWorld {
    let pid: pid_t = 2_000_000_000
    let window: UInt32 = 99
    var model = false, readerIndex = 0, readerStart: UInt64 = 0
    var clock: UInt64 = 1_000_000_000, processStart: UInt64 = 1
    var foreground: pid_t? = 2_000_000_000, permission = true, secure: Bool? = false, locked = false
    var focus = "A", focusedWindow = "root", bundle = "com.djl.history-fixture"
    var nodes: [String: CFData] = [:]
    var properties: [String: [String: (AXError, CFTypeRef?)]] = [:]
    var parents: [String: String] = [:], children: [String: [String]] = [:], owners: [String: pid_t] = [:]
    var reads: [String] = [], counts: [String: Int] = [:], bundleReads = 0, forbiddenStartup = 0
    var onRead: ((String, String) -> Void)?, onBundle: (() -> Void)?, onEncode: (() -> Void)?, onSecure: (() -> Void)?
    var observations = 0, exchanges: [String] = [], guardTrace: [String] = []
    var onSession: (() -> Void)?, onPair: (() -> Void)?
    var onRequested: ((String) -> Void)?
    var requestedResponses: [String: (AXError, CFTypeRef?)] = [:]
    var comparisons: [String] = []
    var session: CFDictionary? = ["CGSSessionScreenIsLocked": false, "kCGSessionOnConsoleKey": true] as CFDictionary
    var pairResponse: (AXError, CFArray?)?
    var triggered = false
    init() {
        for id in ["app", "root", "A", "B", "B2", "sibling", "label", "ancestor", "observer"] { nodes[id] = Data(id.utf8) as CFData; owners[id] = pid }
        add("app", role: "AXApplication", title: "Synthetic application")
        add("root", role: "AXWindow", title: "Synthetic Window")
        add("A", role: "AXTextField", title: "A")
        add("B", role: "AXTextField", title: "B")
        add("B2", role: "AXTextField", title: "B")
        add("sibling", role: "AXStaticText", title: "Sibling")
        add("label", role: "AXStaticText", title: "Ordinary label")
        add("ancestor", role: "AXGroup", title: "Ordinary group")
        children["root"] = ["A", "B", "sibling"]
        for id in ["A", "B", "B2", "sibling", "label", "ancestor"] { parents[id] = "root" }
        parents["root"] = "app"
        set("root", "AXPrivateBrowsing", kCFBooleanFalse!)
        set("root", "AXURL", "https://allowed.test/document" as CFString)
        set("A", "AXValue", "alpha" as CFString); set("B", "AXValue", "beta" as CFString)
        set("A", "AXSelectedText", "alpha" as CFString); set("B", "AXSelectedText", "beta" as CFString)
        var a = CFRange(location: 0, length: 5), b = CFRange(location: 0, length: 4)
        set("A", "AXSelectedTextRange", AXValueCreate(.cfRange, &a)!); set("B", "AXSelectedTextRange", AXValueCreate(.cfRange, &b)!)
        set("sibling", "AXValue", "Sibling" as CFString); set("label", "AXValue", "ordinary security label" as CFString)
        set("B2", "AXIdentifier", "B" as CFString)
    }
    func add(_ id: String, role: String, title: String) {
        properties[id] = ["AXRole": (.success, role as CFString), "AXTitle": (.success, title as CFString), "AXIdentifier": (.success, id as CFString), "AXProtectedContent": (.success, kCFBooleanFalse)]
    }
    func set(_ id: String, _ name: String, _ value: CFTypeRef?) { properties[id, default: [:]][name] = (.success, value) }
    func error(_ id: String, _ name: String, _ error: AXError) { properties[id, default: [:]][name] = (error, nil) }
    func id(_ node: CFData) -> String { String(decoding: node as Data, as: UTF8.self) }
    func read(_ element: CFData, _ attribute: String) -> (AXError, CFTypeRef?) {
        let id = id(element), key = id + "." + attribute
        reads.append(key); counts[key, default: 0] += 1; onRead?(id, attribute)
        if id == "app" && attribute == "AXFocusedWindow" { return (.success, nodes[focusedWindow]) }
        if id == "app" && attribute == "AXFocusedUIElement" { return (.success, nodes[focus]) }
        if attribute == "AXParent" { return parents[id].flatMap { nodes[$0] }.map { (.success, $0 as CFTypeRef) } ?? (.noValue, nil) }
        return properties[id]?[attribute] ?? (.attributeUnsupported, nil)
    }
    func contentAttempts(_ ids: [String]) -> [String] {
        reads.filter { event in ids.contains { id in ["AXValue", "AXSelectedText", "AXSelectedTextRange"].contains { event == id + "." + $0 } } }
    }
}
func InertAXUIElementCreateApplication(_ pid: pid_t) -> AXUIElement { InertAX.world.nodes["app"]! }
func InertAXUIElementGetTypeID() -> CFTypeID { CFDataGetTypeID() }
func InertAXIsProcessTrusted() -> Bool { InertAX.world.permission }
func InertCGSessionCopyCurrentDictionary() -> CFDictionary? {
    let w = InertAX.world; w.observations += 1; w.guardTrace.append("session:\(w.observations)"); if w.model { w.clock += 2_000_000 }; w.onSession?()
    if w.locked { return ["CGSSessionScreenIsLocked": true, "kCGSessionOnConsoleKey": true] as CFDictionary }
    return w.session
}
@discardableResult func InertAXUIElementSetMessagingTimeout(_ element: AXUIElement, _ seconds: Float) -> AXError { .success }
func InertAXUIElementGetPid(_ element: AXUIElement, _ pid: UnsafeMutablePointer<pid_t>) -> AXError {
    guard let owner = InertAX.world.owners[InertAX.world.id(element)] else { return .invalidUIElement }; pid.pointee = owner; return .success
}
func InertRequestedAttributeValue(_ element: AXUIElement, _ name: CFString, _ value: UnsafeMutablePointer<CFTypeRef?>) -> AXError {
    let w = InertAX.world, attribute = name as String
    w.exchanges.append("scalar:" + attribute); w.guardTrace.append("scalar:" + attribute); w.onRequested?(attribute)
    if let result = w.requestedResponses[attribute] { value.pointee = result.1; return result.0 }
    return InertAXUIElementCopyAttributeValue(element, name, value)
}
func InertAXUIElementCopyAttributeValue(_ element: AXUIElement, _ name: CFString, _ value: UnsafeMutablePointer<CFTypeRef?>) -> AXError {
    let result = InertAX.world.read(element, name as String); value.pointee = result.1; return result.0
}
func InertAXUIElementCopyMultipleAttributeValues(_ element: AXUIElement, _ names: CFArray, _ options: AXCopyMultipleAttributeOptions, _ values: UnsafeMutablePointer<CFArray?>) -> AXError {
    let w = InertAX.world
    if names as! [String] == ["AXFocusedWindow", "AXFocusedUIElement"] {
        w.exchanges.append("bulk:AXFocusedWindow,AXFocusedUIElement"); w.guardTrace.append("bulk:AXFocusedWindow,AXFocusedUIElement"); w.onPair?()
        if let response = w.pairResponse { values.pointee = response.1; return response.0 }
    }
    var result: [AnyObject] = []
    for name in names as! [String] {
        let value = InertAX.world.read(element, name)
        if value.0 == .success { result.append(value.1 ?? kCFNull!) }
        else { var error = value.0; result.append(AXValueCreate(.axError, &error)!) }
    }
    values.pointee = result as CFArray; return .success
}
func InertAXUIElementGetAttributeValueCount(_ element: AXUIElement, _ name: CFString, _ count: UnsafeMutablePointer<CFIndex>) -> AXError {
    let id = InertAX.world.id(element); InertAX.world.reads.append(id + ".children-count")
    count.pointee = InertAX.world.children[id]?.count ?? 0; return .success
}
func InertAXUIElementCopyAttributeValues(_ element: AXUIElement, _ name: CFString, _ start: CFIndex, _ count: CFIndex, _ values: UnsafeMutablePointer<CFArray?>) -> AXError {
    let ids = InertAX.world.children[InertAX.world.id(element)] ?? []
    guard start >= 0, count >= 0, start + count <= ids.count else { return .illegalArgument }
    values.pointee = ids[start..<start+count].map { InertAX.world.nodes[$0]! } as CFArray; return .success
}
func InertAXObserverCreate(_ pid: pid_t, _ callback: AXObserverCallback, _ observer: UnsafeMutablePointer<AXObserver?>) -> AXError { fatalError("Inert test attempted observer startup") }
@discardableResult func InertAXObserverAddNotification(_ observer: AXObserver, _ element: AXUIElement, _ name: CFString, _ context: UnsafeMutableRawPointer?) -> AXError { fatalError("Inert test attempted observer registration") }
func InertAXObserverGetRunLoopSource(_ observer: AXObserver) -> CFRunLoopSource { fatalError("Inert test attempted observer runloop") }
func InertCGWindowListCopyWindowInfo(_ options: CGWindowListOption, _ relative: CGWindowID) -> CFArray? { fatalError("Inert test attempted real window discovery") }

func InertOwnershipEqual(_ reference: AXUIElement, _ expected: AXUIElement) -> Bool {
    let w = InertAX.world; w.comparisons.append(w.id(reference) + "=" + w.id(expected)); w.guardTrace.append("compare:" + w.id(reference) + "=" + w.id(expected))
    return CFEqual(reference, expected)
}
