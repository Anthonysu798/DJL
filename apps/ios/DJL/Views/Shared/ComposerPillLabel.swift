// FILE: ComposerPillLabel.swift
// Purpose: Shared capsule "pill" used by composer-adjacent menus (runtime picker,
//          git branch selector, ...) so icon + text + chevron sizing stays in sync.
// Layer: View Component
// Exports: ComposerPillLabel
// Depends on: SwiftUI, DJLIcon, AppFont, AdaptiveGlassModifier

import SwiftUI

/// Unified visual shell for the small capsule pills shown in the composer
/// secondary bar. All callers should route through this view so icon size,
/// chevron weight, padding and glass background remain identical.
struct ComposerPillLabel: View {
    let title: String
    let iconSystemName: String
    let foregroundColor: Color
    let titleFont: Font
    let titleWeight: Font.Weight
    let iconSize: CGFloat
    let chevronSize: CGFloat
    let showsTrailingChevron: Bool

    init(
        title: String,
        iconSystemName: String,
        foregroundColor: Color = Color(.secondaryLabel),
        titleFont: Font = AppFont.subheadline(),
        titleWeight: Font.Weight = .regular,
        iconSize: CGFloat = 16,
        chevronSize: CGFloat = 9,
        showsTrailingChevron: Bool = true
    ) {
        self.title = title
        self.iconSystemName = iconSystemName
        self.foregroundColor = foregroundColor
        self.titleFont = titleFont
        self.titleWeight = titleWeight
        self.iconSize = iconSize
        self.chevronSize = chevronSize
        self.showsTrailingChevron = showsTrailingChevron
    }

    var body: some View {
        HStack(spacing: 6) {
            DJLIcon.image(systemName: iconSystemName, size: iconSize)

            Text(title)
                .font(titleFont)
                .fontWeight(titleWeight)
                .lineLimit(1)

            if showsTrailingChevron {
                DJLIcon.image(systemName: "chevron.down", size: chevronSize)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .adaptiveGlass(.regular, isInteractive: true, in: Capsule())
        .foregroundStyle(foregroundColor)
        .contentShape(Capsule())
    }
}

#if DEBUG
#Preview("Composer pills") {
    HStack(spacing: 8) {
        ComposerPillLabel(
            title: "Local",
            iconSystemName: "laptopcomputer"
        )
        ComposerPillLabel(
            title: "main",
            iconSystemName: "djl.git-branch",
            showsTrailingChevron: false
        )
    }
    .padding()
}
#endif
