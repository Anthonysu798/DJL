// FILE: TurnChatToolbarTitleLabel.swift
// Purpose: Shared stacked title/subtitle label used by the regular TurnView
//          toolbar and the New Chat draft toolbar so both surfaces render the
//          same "{Title} / {folder}" navigation block.
// Layer: View Component
// Exports: TurnChatToolbarTitleLabel
// Depends on: SwiftUI, AppFont, HapticFeedback

import SwiftUI

struct TurnChatToolbarTitleLabel: View {
    let title: String
    let subtitle: String?
    var onTap: (() -> Void)? = nil
    var accessibilityLabel: String? = nil
    var accessibilityHint: String? = nil

    var body: some View {
        Group {
            if let onTap {
                Button {
                    HapticFeedback.shared.triggerImpactFeedback(style: .light)
                    onTap()
                } label: {
                    contentStack
                }
                .buttonStyle(.plain)
                .contentShape(Rectangle())
            } else {
                contentStack
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .multilineTextAlignment(.leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel ?? defaultAccessibilityLabel)
        .accessibilityHint(accessibilityHint ?? "")
        .accessibilityAddTraits(onTap != nil ? .isButton : [])
    }

    private var contentStack: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(AppFont.subheadline(weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(AppFont.caption(weight: .regular))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var defaultAccessibilityLabel: String {
        guard let subtitle, !subtitle.isEmpty else { return title }
        return "\(title), \(subtitle)"
    }
}
