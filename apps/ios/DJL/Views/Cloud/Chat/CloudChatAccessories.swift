// FILE: CloudChatAccessories.swift
// Purpose: Small chat accessories: model picker, live task step list, and the usage-window banner with
//          the "Use a banked reset" flow.
// Layer: View
// Exports: CloudModelPicker, CloudTaskStepsView, CloudUsageBanner
// Depends on: CloudService, CloudModels

import SwiftUI

struct CloudModelPicker: View {
    @Environment(CloudService.self) private var cloud

    var body: some View {
        Menu {
            ForEach(cloud.models.filter(\.isSelectable)) { model in
                Button {
                    cloud.selectedModelID = model.id
                } label: {
                    if model.id == cloud.selectedModel?.id {
                        Label(model.displayName, systemImage: "checkmark")
                    } else {
                        Text(model.displayName)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(cloud.selectedModel?.displayName ?? "DJL")
                    .font(AppFont.body(weight: .semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
        }
        .accessibilityLabel("Model")
    }
}

struct CloudTaskStepsView: View {
    let steps: [CloudTaskStep]
    let isRunning: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if isRunning { ProgressView().controlSize(.small) } else { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                Text(isRunning ? "Working on it" : "Task finished")
                    .font(AppFont.subheadline(weight: .semibold))
                Spacer()
                if let last = steps.last {
                    Text("Step \(last.id) of \(last.maxSteps)")
                        .font(AppFont.caption())
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            ForEach(steps) { step in
                HStack(alignment: .top, spacing: 10) {
                    Circle()
                        .fill(step.id == steps.last?.id && isRunning ? Color.accentColor : Color.secondary.opacity(0.4))
                        .frame(width: 7, height: 7)
                        .padding(.top, 6)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Step \(step.id)").font(AppFont.footnote(weight: .medium))
                        if !step.tools.isEmpty {
                            Text(step.tools.joined(separator: " · "))
                                .font(AppFont.caption())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if isRunning {
                Text("You can leave the app. We'll notify you when it's done.")
                    .font(AppFont.caption())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct CloudUsageBanner: View {
    @Environment(CloudService.self) private var cloud
    /// ISO timestamp from the `usage_window_exhausted` error; may be empty when unknown.
    let resetsAt: String
    let onResumed: () -> Void
    @State private var isConfirming = false
    @State private var isRedeeming = false

    private var bankCount: Int { cloud.usage?.banks.count ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "hourglass").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text("You've reached your usage limit").font(AppFont.subheadline(weight: .semibold))
                    Text(resetDescription).font(AppFont.footnote()).foregroundStyle(.secondary)
                }
            }
            if bankCount > 0 {
                Button {
                    isConfirming = true
                } label: {
                    HStack {
                        if isRedeeming { ProgressView() }
                        Text("Use a banked reset (\(bankCount) left)").font(AppFont.subheadline(weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRedeeming)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .confirmationDialog("Use a banked reset?", isPresented: $isConfirming, titleVisibility: .visible) {
            Button("Use reset") { redeem() }
        } message: {
            Text("Both your 5-hour and weekly limits start over now, and your week restarts today.")
        }
        .task { await cloud.refreshUsage() }
    }

    private var resetDescription: String {
        guard let date = CloudDate.parse(resetsAt) else { return "Your limit frees up again soon." }
        return "It resets \(date.formatted(.relative(presentation: .named)))."
    }

    private func redeem() {
        isRedeeming = true
        Task {
            if await cloud.redeemBankedReset() { onResumed() }
            isRedeeming = false
        }
    }
}
