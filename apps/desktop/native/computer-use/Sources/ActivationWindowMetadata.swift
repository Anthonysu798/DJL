import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

enum ActivationWindowMetadata {
    private typealias ReadWindowID = @convention(c) (AXUIElement, UnsafeMutablePointer<UInt32>) -> Int32
    private typealias ReadWindowOrder = @convention(c) (UInt32, UInt32) -> Unmanaged<CFArray>?
    private static let axLibrary = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices", RTLD_NOW | RTLD_LOCAL)
    private static let graphics = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_NOW | RTLD_LOCAL)
    private static let readID = axLibrary.flatMap { dlsym($0, "_AXUIElementGetWindow") }.map { unsafeBitCast($0, to: ReadWindowID.self) }
    private static let readOrder = graphics.flatMap { dlsym($0, "CGWindowListCreate") }.map { unsafeBitCast($0, to: ReadWindowOrder.self) }
    static func focusedWindow(_ pid: pid_t) -> (element: AXUIElement, id: UInt32)? {
        let app = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(app, 0.15)
        guard let value = attr(app, kAXFocusedWindowAttribute), CFGetTypeID(value) == AXUIElementGetTypeID(), let readID = readID else { return nil }
        let element = unsafeBitCast(value, to: AXUIElement.self)
        var owner: pid_t = 0, id: UInt32 = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == pid, readID(element, &id) == 0, id > 0, belongs(id, to: pid) else { return nil }
        return (element, id)
    }
    static func belongs(_ id: UInt32, to pid: pid_t) -> Bool {
        guard let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [Object], rows.count == 1 else { return false }
        return rows[0][kCGWindowNumber as String] as? UInt32 == id && rows[0][kCGWindowOwnerPID as String] as? Int32 == pid && rows[0][kCGWindowLayer as String] as? Int == 0
    }
    static func orderedIDs() -> [UInt32]? {
        // SDK marks this public API Swift-unavailable because entries are raw
        // integer window IDs, not CFType objects. Never bridge them as NSNumber.
        guard let readOrder = readOrder, let raw = readOrder(CGWindowListOption.optionOnScreenOnly.union(.excludeDesktopElements).rawValue, 0) else { return nil }
        let array = raw.takeRetainedValue(); let count = CFArrayGetCount(array)
        guard count >= 0 && count <= 10000 else { return nil }
        var ids: [UInt32] = []; ids.reserveCapacity(count)
        for index in 0..<count {
            let value = UInt(bitPattern: CFArrayGetValueAtIndex(array, index))
            guard value > 0 && value <= UInt(UInt32.max) else { return nil }
            ids.append(UInt32(value))
        }
        return ids
    }
}
