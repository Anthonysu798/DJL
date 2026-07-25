// FILE: SidebarThreadContextMenu.swift
// Purpose: Shared `UIMenu` builder for the thread-row long-press surfaces in
//          the sidebar and the Archived Chats screen. Each action is
//          optional so each callsite only opts into the entries it supports
//          (e.g. the archived list omits Pin and Rename). Used via the
//          `.uiKitContextMenu` modifier so the leading icons render at the
//          SF Symbol menu glyph metric — see `UIKitContextMenu.swift` and
//          `DJLIcon.menuUIImage` for why we go through UIKit here.
// Layer: View Helper
// Exports: SidebarThreadContextMenu
// Depends on: UIKit, DJLIcon, HapticFeedback, CodexThread

import UIKit

struct SidebarThreadContextMenu {
    let thread: CodexThread
    /// Drives the Pin / Unpin label. Ignored when `onPinToggle` is nil.
    var isPinned: Bool = false
    var onCopySessionId: (() -> Void)? = nil
    var onRename: (() -> Void)? = nil
    var onArchiveToggle: (() -> Void)? = nil
    var onPinToggle: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil

    func uiMenu() -> UIMenu {
        var children: [UIMenuElement] = []

        if let onCopySessionId {
            children.append(makeAction(
                title: "Copy sessionId",
                systemImage: "doc.on.doc",
                handler: onCopySessionId
            ))
        }

        if let onRename {
            children.append(makeAction(
                title: "Rename",
                systemImage: "pencil",
                handler: onRename
            ))
        }

        if let onArchiveToggle {
            let isArchived = thread.syncState == .archivedLocal
            children.append(makeAction(
                title: isArchived ? "Unarchive" : "Archive",
                systemImage: isArchived ? "tray.and.arrow.up" : "archivebox",
                handler: onArchiveToggle
            ))
        }

        if let onPinToggle, thread.syncState != .archivedLocal, !thread.isSubagent {
            children.append(makeAction(
                title: isPinned ? "Unpin" : "Pin",
                systemImage: isPinned ? "pin.slash" : "pin",
                handler: onPinToggle
            ))
        }

        if let onDelete {
            children.append(makeAction(
                title: "Remove from Phone",
                systemImage: "trash",
                attributes: .destructive,
                handler: onDelete
            ))
        }

        return UIMenu(title: "", options: [.displayInline], children: children)
    }

    private func makeAction(
        title: String,
        systemImage: String,
        attributes: UIMenuElement.Attributes = [],
        handler: @escaping () -> Void
    ) -> UIAction {
        UIAction(
            title: title,
            image: DJLIcon.menuUIImage(systemName: systemImage),
            attributes: attributes
        ) { _ in
            // Match the haptic feedback HapticButton used to give SwiftUI
            // context menu rows so the long-press experience stays
            // consistent after the UIKit bridge.
            HapticFeedback.shared.triggerImpactFeedback(style: .light)
            handler()
        }
    }
}
