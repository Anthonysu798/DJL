import SwiftUI

struct CloudPasswordRecoveryView: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.dismiss) private var dismiss
    @State private var email: String
    @State private var code = ""
    @State private var password = ""
    @State private var sentAt: Date?
    @State private var busy = false
    @State private var completed = false
    @State private var error: String?
    @State private var request: Task<Void, Never>?
    let onComplete: (String) -> Void

    init(email: String, onComplete: @escaping (String) -> Void) {
        _email = State(initialValue: email)
        self.onComplete = onComplete
    }

    private var normalizedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    var body: some View {
        Form {
            if completed {
                Section {
                    Label("Password updated", systemImage: "lock.open")
                    Text("Sign in with your new password.").foregroundStyle(.secondary)
                    Button("Back to sign in") { onComplete(normalizedEmail); dismiss() }
                }
            } else {
                Section {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress).textContentType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .disabled(sentAt != nil || busy)
                    if sentAt != nil {
                        TextField("6-digit code", text: $code)
                            .textContentType(.oneTimeCode).keyboardType(.numberPad)
                            .onChange(of: code) { _, value in code = String(value.filter { $0.isASCII && $0.isNumber }.prefix(6)) }
                        SecureField("New password", text: $password).textContentType(.newPassword)
                    }
                } footer: {
                    Text(sentAt == nil ? "We'll send a recovery code if an account exists for this email." : "Enter your recovery code and a password with 10–256 characters.")
                }
                Section {
                    Button(action: submit) {
                        if busy { ProgressView() }
                        else { Text(sentAt == nil ? "Send recovery code" : "Reset password") }
                    }
                    .disabled(busy || !normalizedEmail.contains("@") || (sentAt != nil && (!CloudAuthFormState.isValidCode(code) || !CloudAuthFormState.isValidPassword(password))))
                    if let sentAt {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let seconds = CloudAuthFormState.resendSeconds(sentAt: sentAt, now: context.date)
                            Button(seconds == 0 ? "Resend code" : "Resend in \(seconds)s") { sendCode() }
                                .disabled(busy || seconds > 0)
                        }
                        Button("Use another email") { self.sentAt = nil; code = ""; password = ""; error = nil }
                            .disabled(busy)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
        }
        .navigationTitle("Reset password")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { request?.cancel(); password = ""; code = "" }
    }

    private func submit() {
        if sentAt == nil { sendCode(); return }
        busy = true; error = nil
        request = Task {
            defer { busy = false }
            do {
                try await cloud.authAPI.resetPassword(email: normalizedEmail, code: code, password: password)
                try Task.checkCancellation()
                password = ""; code = ""; completed = true
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
        }
    }

    private func sendCode() {
        busy = true; error = nil
        request = Task {
            defer { busy = false }
            do {
                try await cloud.authAPI.requestPasswordReset(email: normalizedEmail)
                try Task.checkCancellation()
                sentAt = .now; code = ""
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
        }
    }
}
