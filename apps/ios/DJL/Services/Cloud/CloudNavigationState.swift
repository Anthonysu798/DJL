import Foundation
import Observation

@MainActor
@Observable
final class CloudNavigationState {
    enum Destination: Equatable { case chat, settings }
    var destination: Destination = .chat
    var isMenuOpen = false
    private(set) var selectedConversationID: String?
    private(set) var presentationID = UUID()

    func openConversation(_ id: String) {
        if selectedConversationID != id { presentationID = UUID() }
        selectedConversationID = id
        destination = .chat
        isMenuOpen = false
    }

    func acknowledgeCreatedConversation(_ id: String) { selectedConversationID = id }

    func newChat() {
        selectedConversationID = nil
        presentationID = UUID()
        destination = .chat
        isMenuOpen = false
    }
}
