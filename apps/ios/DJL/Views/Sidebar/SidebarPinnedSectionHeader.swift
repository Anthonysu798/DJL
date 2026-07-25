// FILE: SidebarPinnedSectionHeader.swift
// Purpose: Tappable header for the Pinned section. Hosts the pin glyph, label
//          and chevron that toggles the section open/closed. Built on top of
//          the shared `SidebarSectionHeader` so the slot grid (leading icon,
//          label, trailing 30pt slot) matches every other sidebar section.
// Layer: View Component
// Exports: SidebarPinnedSectionHeader
// Depends on: SwiftUI, SidebarSectionHeader, SidebarSectionExpansionChevron,
//             SidebarPinIcon

import SwiftUI

struct SidebarPinnedSectionHeader: View {
    let label: String
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        SidebarSectionHeader(
            label: label,
            verticalPadding: (top: 10, bottom: 0),
            onToggle: onToggle,
            leadingIcon: {
                SidebarPinIcon(style: .header)
            },
            trailing: {
                SidebarSectionExpansionChevron(isExpanded: isExpanded)
            }
            // Pinned section has no context menu; omit `contextMenu:` so
            // the shared header skips the UIKit interaction overhead.
        )
        .padding(.horizontal, 16)
    }
}

#if DEBUG
#Preview("Collapsed") {
    SidebarPinnedSectionHeader(label: "Pinned", isExpanded: false, onToggle: {})
}

#Preview("Expanded") {
    SidebarPinnedSectionHeader(label: "Pinned", isExpanded: true, onToggle: {})
}
#endif
