// FILE: CloudEmailSignInView.swift
// Purpose: Email sign-in: password, one-time code, and account creation with email verification.
// Layer: View
// Exports: CloudEmailSignInView
// Depends on: CloudService, CloudAuthAPI

import SwiftUI

struct CloudEmailSignInView: View {
    enum Method: String, CaseIterable, Identifiable {
        case password = "Password"
        case code = "Email code"
        case create = "Create account"
        var id: String { rawValue }
    }

    @Environment(CloudService.self) private var cloud
    @State private var method: Method = .password
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    /// Set once a code was emailed: for code sign-in or to verify a new account.
    @State private var codeSentTo: String?
    @State private var isBusy = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case name, email, password, code }

    var body: some View {
        Form {
            Section {
                Picker("Method", selection: $method) {
                    ForEach(Method.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                if method == .create, codeSentTo == nil {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                        .focused($focusedField, equals: .name)
                }
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .email)
                    .disabled(codeSentTo != nil)
                if method != .code, codeSentTo == nil {
                    SecureField("Password", text: $password)
                        .textContentType(method == .create ? .newPassword : .password)
                        .focused($focusedField, equals: .password)
                }
                if codeSentTo != nil {
                    TextField("6-digit code", text: $code)
                        .textContentType(.oneTimeCode)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .code)
                }
            } footer: {
                footer
            }

            Section {
                Button(action: submit) {
                    HStack {
                        Spacer()
                        if isBusy { ProgressView() } else { Text(primaryTitle).font(AppFont.body(weight: .semibold)) }
                        Spacer()
                    }
                }
                .disabled(!canSubmit || isBusy)
            }
        }
        .navigationTitle("Continue with email")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: method) { _, _ in
            codeSentTo = nil
            code = ""
            errorMessage = nil
        }
        .onAppear { focusedField = .email }
    }

    @ViewBuilder
    private var footer: some View {
        if let errorMessage {
            Text(errorMessage).foregroundStyle(.red)
        } else if let codeSentTo {
            Text("We sent a code to \(codeSentTo). It expires in 10 minutes.")
        } else if method == .create {
            Text("Use at least 10 characters. We'll email you a code to confirm your address.")
        }
    }

    private var primaryTitle: String {
        switch (method, codeSentTo) {
        case (.password, _): return "Sign in"
        case (.code, nil): return "Email me a code"
        case (.create, nil): return "Create account"
        case (_, .some): return "Verify and continue"
        }
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var canSubmit: Bool {
        let hasEmail = normalizedEmail.contains("@")
        if codeSentTo != nil { return code.trimmingCharacters(in: .whitespaces).count == 6 }
        switch method {
        case .password: return hasEmail && !password.isEmpty
        case .code: return hasEmail
        case .create: return hasEmail && password.count >= 10 && !name.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    private func submit() {
        errorMessage = nil
        isBusy = true
        Task {
            defer { isBusy = false }
            do {
                try await perform()
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func perform() async throws {
        let auth = cloud.authAPI
        let otp = code.trimmingCharacters(in: .whitespaces)
        switch (method, codeSentTo) {
        case (.password, _):
            await cloud.completeSignIn(sessionToken: try await auth.signIn(email: normalizedEmail, password: password))
        case (.code, nil):
            try await auth.sendEmailCode(email: normalizedEmail)
            codeSentTo = normalizedEmail
            focusedField = .code
        case (.code, .some):
            await cloud.completeSignIn(sessionToken: try await auth.signIn(email: normalizedEmail, code: otp))
        case (.create, nil):
            switch try await auth.signUp(name: name.trimmingCharacters(in: .whitespaces), email: normalizedEmail, password: password) {
            case .signedIn(let token):
                await cloud.completeSignIn(sessionToken: token)
            case .verificationRequired:
                codeSentTo = normalizedEmail
                focusedField = .code
            }
        case (.create, .some):
            await cloud.completeSignIn(sessionToken: try await auth.verifyEmail(email: normalizedEmail, code: otp))
        }
    }
}
