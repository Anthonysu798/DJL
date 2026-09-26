// FILE: CloudAccountView.swift
// Purpose: DJL Cloud account: plan, credits, usage windows, banked resets, My Macs, sign-out, and in-app
//          account deletion (App Store Review Guideline 5.1.1(v)).
// Layer: View
// Exports: CloudAccountView
// Depends on: CloudService, CloudModels

import SwiftUI

struct CloudAccountView: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.dismiss) private var dismiss
    @State private var isConfirmingSignOut = false
    @State private var isConfirmingDelete = false
    @State private var deleteConfirmation = ""
    @State private var isDeleting = false
    @State private var isRedeeming = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Email", value: cloud.me?.user.email ?? "—")
                    LabeledContent("Plan", value: planName)
                    LabeledContent("Credits", value: cloud.credits?.display.total ?? "—")
                }

                if let usage = cloud.usage {
                    Section {
                        usageRow(title: "5-hour limit", window: usage.windows.fiveHour)
                        usageRow(title: "Weekly limit", window: usage.windows.week)
                        bankRow(usage)
                    } header: {
                        Text("Usage")
                    } footer: {
                        Text("A banked reset starts both limits over and restarts your week. Banks expire 90 days after they're granted.")
                    }
                }

                Section {
                    Button {
                        cloud.sectionPreference = .myMacs
                        dismiss()
                    } label: {
                        Label("My Macs", systemImage: "laptopcomputer")
                    }
                    .foregroundStyle(.primary)
                }

                Section {
                    Button("Sign out") { isConfirmingSignOut = true }
                    Button("Delete account", role: .destructive) { isConfirmingDelete = true }
                } footer: {
                    Text("Deleting your account removes your chats, files, and credits. You have 30 days to change your mind by contacting support.")
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await cloud.refreshUsage() }
            .refreshable { await cloud.refreshAll() }
            .confirmationDialog("Sign out of DJL Cloud?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    Task {
                        await cloud.signOut()
                        dismiss()
                    }
                }
            }
            .alert("Delete your account?", isPresented: $isConfirmingDelete) {
                TextField("Type DELETE", text: $deleteConfirmation)
                    .textInputAutocapitalization(.characters)
                Button("Delete account", role: .destructive, action: deleteAccount)
                Button("Cancel", role: .cancel) { deleteConfirmation = "" }
            } message: {
                Text("This can't be undone after 30 days. Type DELETE to confirm.")
            }
            .alert("Something went wrong", isPresented: isShowingError) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .overlay { if isDeleting { ProgressView().controlSize(.large) } }
        }
    }

    private var planName: String {
        guard let plan = cloud.usage?.planId else { return "—" }
        return plan.prefix(1).uppercased() + plan.dropFirst()
    }

    private func usageRow(title: String, window: CloudUsageWindow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int((window.fractionUsed * 100).rounded()))% used")
                    .foregroundStyle(window.isExhausted ? .red : .secondary)
                    .monospacedDigit()
            }
            ProgressView(value: window.fractionUsed)
                .tint(window.isExhausted ? .red : .accentColor)
            if let date = CloudDate.parse(window.resetsAt) {
                Text("Resets \(date.formatted(.relative(presentation: .named)))")
                    .font(AppFont.caption())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func bankRow(_ usage: CloudUsageStatus) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Banked resets")
                if let oldest = usage.banks.first, let expires = CloudDate.parse(oldest.expiresAt) {
                    Text("Next expires \(expires.formatted(date: .abbreviated, time: .omitted))")
                        .font(AppFont.caption())
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if usage.banks.isEmpty {
                Text("None").foregroundStyle(.secondary)
            } else {
                Button {
                    isRedeeming = true
                    Task {
                        _ = await cloud.redeemBankedReset()
                        isRedeeming = false
                    }
                } label: {
                    if isRedeeming { ProgressView() } else { Text("Use 1 of \(usage.banks.count)") }
                }
                .buttonStyle(.bordered)
                .disabled(isRedeeming)
            }
        }
    }

    private func deleteAccount() {
        guard deleteConfirmation.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" else {
            deleteConfirmation = ""
            errorMessage = "Type DELETE to confirm."
            return
        }
        deleteConfirmation = ""
        isDeleting = true
        Task {
            defer { isDeleting = false }
            do {
                try await cloud.deleteAccount()
                dismiss()
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private var isShowingError: Binding<Bool> {
        Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    }
}
