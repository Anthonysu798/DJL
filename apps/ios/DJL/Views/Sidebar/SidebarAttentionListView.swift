// FILE: SidebarAttentionListView.swift
// Purpose: Renders the sidebar's review-first Needs You and Ready to Review sections.
// Layer: View Component
// Exports: SidebarAttentionListView

import SwiftUI

struct SidebarAttentionListView: View {
    let items: [SidebarAttentionItem]
    let isFiltering: Bool
    let onOpenItem: (SidebarAttentionItem) -> Void

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if items.isEmpty {
                emptyState
            } else {
                section(.needsYou)
                section(.readyToReview)
            }
        }
        .accessibilityIdentifier("attention.list")
    }

    @ViewBuilder
    private func section(_ section: SidebarAttentionSection) -> some View {
        let sectionItems = items.filter { $0.section == section }
        if !sectionItems.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(section.title)
                    .font(AppFont.caption(weight: .semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .padding(.horizontal, 16)
                    .padding(.top, section == .needsYou ? 10 : 22)
                    .accessibilityAddTraits(.isHeader)

                ForEach(sectionItems) { item in
                    SidebarAttentionRow(item: item) {
                        onOpenItem(item)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            DJLIcon.image(systemName: isFiltering ? "magnifyingglass" : "checkmark.circle", size: 30, weight: .regular)
                .foregroundStyle(isFiltering ? Color.secondary : Color.green)
                .accessibilityHidden(true)

            Text(isFiltering ? "No matching attention items" : "You're all caught up")
                .font(AppFont.body(weight: .semibold))
                .foregroundStyle(.primary)

            Text(isFiltering
                ? "Try a different project, chat, or status."
                : "Approvals, agent questions, failed runs, and completed work will appear here.")
                .font(AppFont.subheadline())
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)
        .padding(.top, 46)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(isFiltering ? "attention.empty.filtered" : "attention.empty.all-caught-up")
    }
}

private struct SidebarAttentionRow: View {
    let item: SidebarAttentionItem
    let onTap: () -> Void

    var body: some View {
        HapticButton(hapticStyle: .light, action: onTap) {
            HStack(alignment: .top, spacing: 12) {
                statusIcon

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.kind.title)
                            .font(AppFont.body(weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        Spacer(minLength: 4)

                        Text(item.date, style: .relative)
                            .font(AppFont.caption2())
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }

                    Text(item.threadTitle)
                        .font(AppFont.subheadline(weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Text(item.summary)
                        .font(AppFont.footnote())
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)

                    if let projectTitle = item.projectTitle {
                        Label(projectTitle, systemImage: "folder")
                            .font(AppFont.caption2())
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }

                DJLIcon.image(systemName: "chevron.right", size: 13, weight: .semibold)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color(.secondarySystemBackground).opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.kind.title), \(item.threadTitle), \(item.summary)")
        .accessibilityHint(item.kind.accessibilityAction)
        .accessibilityIdentifier("attention.item.\(item.id)")
    }

    private var statusIcon: some View {
        ZStack {
            Circle()
                .fill(iconTint.opacity(0.14))
            DJLIcon.image(systemName: iconName, size: 16, weight: .semibold)
                .foregroundStyle(iconTint)
        }
        .frame(width: 34, height: 34)
        .accessibilityHidden(true)
    }

    private var iconName: String {
        switch item.kind {
        case .approval:
            return "hand.raised.fill"
        case .question:
            return "questionmark.bubble.fill"
        case .failedRun:
            return "exclamationmark.triangle.fill"
        case .blockedGoal:
            return "pause.circle.fill"
        case .completedRun:
            return "checkmark.circle.fill"
        }
    }

    private var iconTint: Color {
        switch item.kind {
        case .approval, .question:
            return .orange
        case .failedRun:
            return .red
        case .blockedGoal:
            return .purple
        case .completedRun:
            return .green
        }
    }
}
