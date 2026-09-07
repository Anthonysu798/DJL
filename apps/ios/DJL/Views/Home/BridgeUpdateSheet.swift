// FILE: BridgeUpdateSheet.swift
// Purpose: Presents a guided recovery flow when the computer bridge package needs an update.
// Layer: View
// Exports: BridgeUpdateSheet
// Depends on: SwiftUI, UIKit, CodexBridgeUpdatePrompt

import SwiftUI
import UIKit

struct BridgeUpdateSheet: View {
    let prompt: CodexBridgeUpdatePrompt
    let isRetrying: Bool
    let onRetry: () -> Void
    let onScanNewQR: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header

                        updateInstructions

                        Text(prompt.target == .iPhone
                            ? "After the app finishes updating on your iPhone, reconnect to your Mac."
                            : "After DJL relaunches on your Mac, come back here and reconnect."
                        )
                            .font(AppFont.caption())
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
                    .padding(.top, 24)
                    .padding(.bottom, 20)
                }

                actionButtons
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(prompt.title)
                .font(AppFont.title3(weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)

            Text(prompt.message)
                .font(AppFont.body())
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // Keeps long bridge-version copy scrollable while the recovery actions stay reachable.
    @ViewBuilder
    private var updateInstructions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if prompt.target == .mac {
                Text("Do this on your Mac")
                    .font(AppFont.caption(weight: .semibold))
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 8) {
                    macUpdateStep("1", "In DJL, open the DJL menu and choose Check for Updates…")
                    macUpdateStep("2", "Install the update and let DJL relaunch.")
                    macUpdateStep("3", "Come back here and tap I Updated It.")
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color(.tertiarySystemFill).opacity(0.75))
                )
            } else {
                Text("Install the latest DJL build on this iPhone, then come back here and reconnect.")
                    .font(AppFont.body())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func macUpdateStep(_ number: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(AppFont.caption2(weight: .bold))
                .frame(width: 20, height: 20)
                .background(Color(.secondarySystemFill), in: Circle())
            Text(text)
                .font(AppFont.body())
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button(action: onRetry) {
                HStack(spacing: 8) {
                    if isRetrying {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(isRetrying ? "Reconnecting..." : "I Updated It")
                        .font(AppFont.body(weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .foregroundStyle(.white)
                .background(.black, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isRetrying)

            Button("Scan New QR Code", action: onScanNewQR)
                .font(AppFont.body(weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color(.secondarySystemFill))
                )
                .buttonStyle(.plain)

            Button("Not Now", role: .cancel, action: onDismiss)
                .font(AppFont.subheadline(weight: .medium))
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
        }
    }
}
