// FILE: SidebarSectionHeader.swift
// Purpose: Shared section-header shell for sidebar groups (Pinned, Project,
//          rootless Chats). Centralizes leading icon + label + trailing slot
//          treatment so every section sits in the same horizontal slot grid.
//          Inline label accessories and trailing affordances (chevron, new-chat
//          pencil, ...) stay centralized while callers keep local intent.
// Layer: View Component
// Exports: SidebarSectionHeader, SidebarSectionExpansionChevron,
//          SidebarSectionHeaderTrailingSlotSize
// Depends on: SwiftUI, UIKit, HapticButton, DJLIcon, AppFont

import SwiftUI
import UIKit

// Square frame used for every trailing slot (chevron, compose button, ...).
// Matches the tap target the project compose pencil already used (30pt) so
// both passive and active trailing icons sit in the same slot footprint.
enum SidebarSectionHeaderTrailingSlotSize {
    static let length: CGFloat = 30
}

struct SidebarSectionExpansionChevron: View {
    let isExpanded: Bool

    var body: some View {
        DJLIcon.image(systemName: "chevron.right")
            .font(AppFont.system(size: 13, weight: .semibold))
            .foregroundStyle(.secondary.opacity(0.6))
            .frame(width: 22, height: 22)
            .rotationEffect(.degrees(isExpanded ? 90 : 0))
            .animation(.easeInOut(duration: 0.2), value: isExpanded)
            .accessibilityHidden(true)
    }
}

struct SidebarSectionHeader<Leading: View, LabelAccessory: View, Trailing: View>: View {
    let label: String
    var labelWeight: Font.Weight = .medium
    var verticalPadding: (top: CGFloat, bottom: CGFloat) = (18, 0)
    let onToggle: () -> Void
    let leadingIcon: () -> Leading
    let labelAccessory: () -> LabelAccessory
    let trailing: () -> Trailing
    // Pass `nil` when the section has no context menu (Pinned). Built as a
    // `UIMenu` so the leading icons render at the SF Symbol menu glyph
    // metric — see `DJLIcon.menuUIImage` and `UIKitContextMenu.swift`.
    var contextMenu: (() -> UIMenu)? = nil

    init(
        label: String,
        labelWeight: Font.Weight = .medium,
        verticalPadding: (top: CGFloat, bottom: CGFloat) = (18, 0),
        onToggle: @escaping () -> Void,
        @ViewBuilder leadingIcon: @escaping () -> Leading,
        @ViewBuilder labelAccessory: @escaping () -> LabelAccessory,
        @ViewBuilder trailing: @escaping () -> Trailing,
        contextMenu: (() -> UIMenu)? = nil
    ) {
        self.label = label
        self.labelWeight = labelWeight
        self.verticalPadding = verticalPadding
        self.onToggle = onToggle
        self.leadingIcon = leadingIcon
        self.labelAccessory = labelAccessory
        self.trailing = trailing
        self.contextMenu = contextMenu
    }

    var body: some View {
        HStack(spacing: 12) {
            toggleButton

            // Unified trailing slot — any icon, chevron, or button the caller
            // passes ends up in the same 30pt square so adjacent sections
            // line up visually even though the inner content differs.
            trailing()
                .frame(
                    width: SidebarSectionHeaderTrailingSlotSize.length,
                    height: SidebarSectionHeaderTrailingSlotSize.length
                )
        }
        .padding(.leading, 6)
        .padding(.trailing, -2)
        .padding(.top, verticalPadding.top)
        .padding(.bottom, verticalPadding.bottom)
    }

    // `.uiKitContextMenu` is only applied when there is something to show —
    // attaching the empty-menu interaction to every header would still cost
    // a `UIHostingController` per section for no user-visible benefit.
    @ViewBuilder
    private var toggleButton: some View {
        if let contextMenu {
            baseToggleButton.uiKitContextMenu(contextMenu)
        } else {
            baseToggleButton
        }
    }

    private var baseToggleButton: some View {
        HapticButton(action: onToggle) {
            HStack(spacing: 8) {
                leadingIcon()
                HStack(spacing: 4) {
                    Text(label)
                        .font(AppFont.body(weight: labelWeight))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    labelAccessory()
                        .fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

extension SidebarSectionHeader where LabelAccessory == EmptyView {
    init(
        label: String,
        labelWeight: Font.Weight = .medium,
        verticalPadding: (top: CGFloat, bottom: CGFloat) = (18, 0),
        onToggle: @escaping () -> Void,
        @ViewBuilder leadingIcon: @escaping () -> Leading,
        @ViewBuilder trailing: @escaping () -> Trailing,
        contextMenu: (() -> UIMenu)? = nil
    ) {
        self.init(
            label: label,
            labelWeight: labelWeight,
            verticalPadding: verticalPadding,
            onToggle: onToggle,
            leadingIcon: leadingIcon,
            labelAccessory: { EmptyView() },
            trailing: trailing,
            contextMenu: contextMenu
        )
    }
}
