// FILE: SettingsCloudCard.swift
// Purpose: Settings entry that leaves "My Macs" for DJL Cloud chat (or its sign-in when signed out).
// Layer: View
// Exports: SettingsCloudCard
// Depends on: CloudService, SettingsBaseComponents

import SwiftUI

struct SettingsCloudCard: View {
    @Environment(CloudService.self) private var cloud

    var body: some View {
        SettingsCard(title: "DJL Cloud") {
            Button {
                cloud.sectionPreference = .cloud
            } label: {
                SettingsLinkRow(
                    title: cloud.isSignedIn ? "Open DJL Cloud chat" : "Sign in to DJL Cloud",
                    subtitle: cloud.isSignedIn ? cloud.me?.user.email : "Chat, images, and background tasks without your Mac"
                ) {
                    DJLIcon.image(systemName: "cloud")
                }
            }
            .buttonStyle(.plain)
        }
    }
}
