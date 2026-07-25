// FILE: SidebarTitleBlock.swift
// Purpose: Sidebar brand title shown under the top toolbar.
// Layer: View Component
// Exports: SidebarTitleBlock
// Depends on: SwiftUI, AppFont

import SwiftUI

struct SidebarTitleBlock: View {
    var title = "DJL"
    let computerName: String?
    let isConnected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(AppFont.system(size: 28, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
#Preview("Connected") {
    SidebarTitleBlock(
        computerName: "MacBook-Pro-di-Emanuele.local",
        isConnected: true
    )
    .padding()
}

#Preview("Disconnected") {
    SidebarTitleBlock(
        computerName: "MacBook-Pro-di-Emanuele.local",
        isConnected: false
    )
    .padding()
}
#endif
