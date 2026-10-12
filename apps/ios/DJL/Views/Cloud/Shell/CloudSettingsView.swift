import SwiftUI
import UserNotifications

struct CloudSettingsView: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("djl.appearance.mode") private var appearance = "system"
    @AppStorage(GlassPreference.storageKey) private var glass = true
    @AppStorage("djl.notifications.inApp") private var inAppAlerts = true
    @AppStorage("djl.voice.spokenReplies") private var spokenReplies = false
    @State private var showingAccount = false
    @State private var permission: UNAuthorizationStatus = .notDetermined

    var body: some View {
        List {
            Section("Account") {
                Button { showingAccount = true } label: {
                    Label(cloud.me?.user.email ?? "DJL account", systemImage: "person.crop.circle")
                }.accessibilityIdentifier("cloud.settings.account")
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
            Section("Notifications") {
                Toggle("In-app alerts", isOn: $inAppAlerts)
                LabeledContent("Background alerts", value: cloud.clientConfig?.pushConfigured == true ? (permission == .denied ? "Off" : permission == .notDetermined ? "Not enabled" : "Enabled") : "Unavailable")
                if cloud.clientConfig?.pushConfigured == true {
                    if permission == .notDetermined {
                        Button("Enable background alerts") { cloud.enableTaskNotifications() }
                    } else if permission == .denied {
                        Button("Open notification settings") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    }
                }
            }
            Section("Voice") {
                Toggle("Speak new replies", isOn: $spokenReplies)
                Text("Dictation stays on your iPhone. Review the text before sending. Replies use the iPhone voice.").font(AppFont.footnote()).foregroundStyle(.secondary)
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
        .task { permission = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { permission = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus } }
        }
    }
}
