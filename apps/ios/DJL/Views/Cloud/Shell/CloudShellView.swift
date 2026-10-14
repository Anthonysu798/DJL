import SwiftUI

struct CloudShellView: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.scenePhase) private var scenePhase

    private var selected: CloudConversation? {
        guard let id = cloud.navigation.selectedConversationID else { return nil }
        return cloud.conversations.first { $0.id == id }
            ?? CloudConversation(id: id, title: nil, pinned: false, archived: false, lastMessageAt: "", createdAt: "", updatedAt: "")
    }

    var body: some View {
        @Bindable var navigation = cloud.navigation
        PhoneNavigationDrawer(isOpen: $navigation.isMenuOpen) {
            CloudNavigationMenu()
        } content: {
            NavigationStack {
                Group {
                    switch navigation.destination {
                    case .chat:
                        CloudChatView(conversation: selected)
                            .id(navigation.presentationID)
                    case .settings:
                        CloudSettingsView()
                    case .images:
                        CloudImagesView()
                    case .notifications:
                        CloudNotificationsView()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { navigation.isMenuOpen = true } label: { Image(systemName: "line.3.horizontal") }
                            .accessibilityLabel("Open navigation")
                            .accessibilityIdentifier("cloud.navigation.toggle")
                    }
                }
            }
        }
        .task { await cloud.refreshAll() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await cloud.refreshAll() } }
        }
        .onChange(of: cloud.pendingConversationID, initial: true) { _, id in
            guard let id else { return }
            cloud.pendingConversationID = nil
            navigation.openConversation(id)
        }
    }
}
