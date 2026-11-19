import AppKit
import CoreGraphics

enum AppLocalActivationPoint {
    case unsupported, absent, point(CGPoint)
}

struct AppLocalFocusEvents {
    let activate: CGEvent
    let deactivate: CGEvent
    let activationMouse: (down: CGEvent, up: CGEvent)?

    init?(windowID: CGWindowID, bounds: CGRect? = nil, activationPoint: AppLocalActivationPoint = .absent) {
        let activationWindow: CGWindowID
        switch activationPoint {
        case .unsupported: activationWindow = 0
        case .absent, .point: activationWindow = windowID
        }
        var mouse: (down: CGEvent, up: CGEvent)?
        if activationWindow != 0, let bounds = bounds, case .point(let point) = activationPoint {
            guard point.x.isFinite, point.y.isFinite, bounds.contains(point) else { return nil }
            func event(_ type: NSEvent.EventType, number: Int) -> CGEvent? {
                guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                        timestamp: 0, windowNumber: Int(activationWindow), context: nil,
                        eventNumber: number, clickCount: 1, pressure: 1)?.cgEvent else { return nil }
                event.flags = []; event.location = point
                event.setIntegerValueField(.mouseEventButtonNumber, value: 0)
                event.setIntegerValueField(.mouseEventSubtype, value: 3)
                event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(activationWindow))
                event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(activationWindow))
                return event
            }
            guard let down = event(.leftMouseDown, number: 1), let up = event(.leftMouseUp, number: 2) else { return nil }
            mouse = (down, up)
        }
        let flags: NSEvent.ModifierFlags = activationWindow == 0 ? [] : [.control, .option]
        guard let activate = NSEvent.otherEvent(with: .appKitDefined, location: .zero,
                modifierFlags: flags, timestamp: 0, windowNumber: Int(activationWindow),
                context: nil, subtype: 1, data1: 0, data2: 0)?.cgEvent,
              let deactivate = NSEvent.otherEvent(with: .appKitDefined, location: .zero,
                modifierFlags: [], timestamp: 0, windowNumber: 0,
                context: nil, subtype: 2, data1: 0, data2: 0)?.cgEvent else { return nil }
        self.activate = activate
        self.deactivate = deactivate
        self.activationMouse = mouse
    }
}
