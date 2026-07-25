// FILE: UserBubbleLayout.swift
// Purpose: Shared trailing-column layout for user bubbles, mention chips, and attachments.
// Layer: View Component
// Exports: UserBubbleLayout, UserBubbleTrailingColumn
// Depends on: SwiftUI

import SwiftUI

enum UserBubbleLayout {
    static let leadingGutter: CGFloat = 60
    static let stackSpacing: CGFloat = 4
}

/// Right-aligned column used by sent user messages.
struct UserBubbleTrailingColumn<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack {
            Spacer(minLength: UserBubbleLayout.leadingGutter)
            VStack(alignment: .trailing, spacing: UserBubbleLayout.stackSpacing) {
                content()
            }
        }
    }
}
