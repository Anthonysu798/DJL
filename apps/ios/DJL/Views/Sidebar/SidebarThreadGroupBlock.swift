// FILE: SidebarThreadGroupBlock.swift
// Purpose: Shared elevated card used to group sidebar thread rows for both the
//          Pinned section and each project section. Centralizes the rounded
//          background, inner padding, bottom spacing and insertion transition
//          so both surfaces stay in sync.
// Layer: View Component
// Exports: SidebarThreadGroupBlock
// Depends on: SwiftUI

import SwiftUI

struct SidebarThreadGroupBlock<Content: View>: View {
    var bottomPadding: CGFloat = 14
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.vertical, 6)
            .padding(.horizontal, 4)
            .background(
                Color(.clear),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
            .padding(.bottom, bottomPadding)
            .transition(.opacity)
    }
}
