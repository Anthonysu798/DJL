import SwiftUI

struct CloudImageCreationSheet: View {
    @Environment(CloudService.self) private var cloud
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: CloudChatSession
    let onCreated: () -> Void
    @State private var prompt = ""
    @State private var aspectRatio = "1:1"

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Make something yours.").font(AppFont.title2(weight: .semibold))
                    Text("Describe the subject, style, and details you have in mind.").font(AppFont.subheadline()).foregroundStyle(.secondary)
                }
                TextField("A quiet studio in morning light…", text: $prompt, axis: .vertical)
                    .lineLimit(4...8).font(AppFont.body())
                    .padding(16).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20))
                    .accessibilityIdentifier("cloud.images.prompt")
                Picker("Shape", selection: $aspectRatio) {
                    Text("Square").tag("1:1"); Text("Landscape").tag("4:3"); Text("Portrait").tag("3:4")
                }.pickerStyle(.segmented)
                if let error = session.errorMessage { Text(error).font(AppFont.footnote()).foregroundStyle(.secondary) }
                if cloud.clientConfig?.tools.imageGeneration != true {
                    Text("Image generation isn't configured on this server yet. Your saved images are still available.").font(AppFont.footnote()).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button {
                    Task {
                        if await session.generateImage(prompt: prompt, aspectRatio: aspectRatio) { onCreated(); dismiss() }
                    }
                } label: {
                    HStack { if session.isSending { ProgressView().tint(.white) }; Text(session.isSending ? "Starting…" : "Create image"); if !session.isSending { Image(systemName: "arrow.up") } }
                        .font(AppFont.body(weight: .semibold)).frame(maxWidth: .infinity).frame(height: 52)
                        .foregroundStyle(Color(.systemBackground)).background(Color.primary, in: Capsule())
                }
                .disabled(session.isSending || cloud.clientConfig?.tools.imageGeneration != true || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || prompt.utf16.count > 4000)
                Text("One image per request. You can leave the chat while DJL works.").font(AppFont.caption()).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            }
            .padding(24).navigationTitle("Create image").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(session.isSending) } }
        }
        .interactiveDismissDisabled(session.isSending)
        .presentationDetents([.large])
    }
}
