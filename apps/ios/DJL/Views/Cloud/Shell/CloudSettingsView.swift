import SwiftUI

struct CloudSettingsView: View {
    @Environment(CloudService.self) private var cloud
    @AppStorage("djl.appearance.mode") private var appearance = "system"
    @AppStorage(GlassPreference.storageKey) private var glass = true
    @State private var showingAccount = false

    var body: some View {
        List {
            Section("Account") {
                Button { showingAccount = true } label: {
                    Label(cloud.me?.user.email ?? "DJL account", systemImage: "person.crop.circle")
                }
                if let credits = cloud.credits { LabeledContent("Available credits", value: credits.display.total) }
            }
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
                Toggle("Liquid Glass", isOn: $glass)
            }
            Section("Conversations") {
                NavigationLink { CloudArchivedChatsView() } label: { Label("Archived chats", systemImage: "archivebox") }
                Button { cloud.sectionPreference = .myMacs } label: { Label("Remote access", systemImage: "laptopcomputer") }
            }
            Section("About") {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                if let raw = cloud.clientConfig?.policyUrls.terms, let url = URL(string: raw) { Link("Terms", destination: url) }
                if let raw = cloud.clientConfig?.policyUrls.privacy, let url = URL(string: raw) { Link("Privacy", destination: url) }
            }
        }
        .navigationTitle("Settings")
        .sheet(isPresented: $showingAccount) { CloudAccountView() }
        .task { await cloud.refreshUsage() }
    }
}
