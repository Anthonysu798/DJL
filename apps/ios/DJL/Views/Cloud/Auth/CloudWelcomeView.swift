// FILE: CloudWelcomeView.swift
// Purpose: Signed-out home: DJL Cloud sign-in first, "Pair with a Mac" as the secondary path.
// Layer: View
// Exports: CloudWelcomeView
// Depends on: CloudService, CloudAppleSignInButton, CloudGoogleSignIn, CloudEmailSignInView

import AuthenticationServices
import SwiftUI

struct CloudWelcomeView: View {
    @Environment(CloudService.self) private var cloud
    @State private var isShowingEmail = false
    @State private var errorMessage: String?
    @State private var isSigningInWithGoogle = false
    @State private var google = CloudGoogleSignIn()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                hero
                Spacer(minLength: 24)
                actions
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
            .navigationDestination(isPresented: $isShowingEmail) {
                CloudEmailSignInView()
            }
            .alert("Couldn't sign in", isPresented: isShowingError) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
        .onAppear(perform: openDebugScreenIfRequested)
    }

    private var hero: some View {
        VStack(spacing: 18) {
            Image("AppLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 76, height: 76)
                .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 12, y: 6)

            VStack(spacing: 8) {
                Text("Welcome to DJL")
                    .font(AppFont.system(size: 30, weight: .bold))
                Text("Chat, create images, and hand off long tasks that keep working after you close the app.")
                    .font(AppFont.body())
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            CloudAppleSignInButton { errorMessage = $0 }

            if let clientID = CloudGoogleSignIn.clientID {
                welcomeButton(title: "Continue with Google", systemImage: "g.circle.fill", isBusy: isSigningInWithGoogle) {
                    signInWithGoogle(clientID: clientID)
                }
            }

            welcomeButton(title: "Continue with email", systemImage: "envelope.fill") {
                isShowingEmail = true
            }

            Button {
                cloud.sectionPreference = .myMacs
            } label: {
                Label("Pair with a Mac", systemImage: "laptopcomputer")
                    .font(AppFont.subheadline(weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .padding(.top, 4)

            Text("By continuing you agree to the DJL Terms and Privacy Policy.")
                .font(AppFont.caption())
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
    }

    private func welcomeButton(title: String, systemImage: String, isBusy: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if isBusy {
                    ProgressView()
                } else {
                    Image(systemName: systemImage)
                        .font(.system(size: 16, weight: .semibold))
                }
                Text(title)
                    .font(AppFont.body(weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Color(.secondarySystemBackground), in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
    }

    private func signInWithGoogle(clientID: String) {
        isSigningInWithGoogle = true
        Task {
            defer { isSigningInWithGoogle = false }
            do {
                let idToken = try await google.idToken(clientID: clientID)
                let session = try await cloud.authAPI.signIn(provider: "google", idToken: idToken, nonce: nil)
                await cloud.completeSignIn(sessionToken: session)
            } catch {
                if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return }
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private var isShowingError: Binding<Bool> {
        Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
    }

    private func openDebugScreenIfRequested() {
        #if DEBUG
        if CloudDebugLaunch.screen == "sign-in" { isShowingEmail = true }
        #endif
    }
}
