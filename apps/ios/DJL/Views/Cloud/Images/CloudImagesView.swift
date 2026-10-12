import SwiftUI

struct CloudImagesView: View {
    @Environment(CloudService.self) private var cloud
    @State private var preview: PreviewImagePayload?
    @State private var selected: CloudGeneratedImage?
    @State private var creation: CloudChatSession?
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(cloud.gallery.images) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        CloudImagePartView(part: item.part, maxHeight: 220) { _, image in
                            selected = item; preview = PreviewImagePayload(id: item.id, image: image, title: "Your image")
                        }
                        Text(item.prompt.isEmpty ? "Generated image" : item.prompt).font(AppFont.footnote()).lineLimit(2)
                        Button("Open chat") { cloud.navigation.openConversation(item.conversationId) }.font(AppFont.caption())
                    }
                }
            }.padding(16)
            if cloud.gallery.nextCursor != nil { Button("Load more") { Task { await cloud.gallery.loadNextPage() } }.disabled(cloud.gallery.isLoading).padding() }
        }
        .overlay {
            if cloud.gallery.images.isEmpty {
                if cloud.gallery.isLoading { ProgressView() }
                else {
                    ContentUnavailableView {
                        Label("Your images", systemImage: "photo.on.rectangle")
                    } description: {
                        Text(cloud.gallery.error ?? (cloud.clientConfig?.tools.imageGeneration == true ? "Create an image and find it here, ready to save or share." : "Image creation is not configured yet. Saved images will appear here."))
                    } actions: {
                        if cloud.gallery.error != nil { Button("Retry") { Task { await cloud.gallery.refresh() } } }
                    }
                }
            }
        }
        .navigationTitle("Images")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if cloud.clientConfig?.tools.imageGeneration == true {
                    Button { creation = CloudChatSession(cloud: cloud, conversation: nil) } label: { Image(systemName: "plus") }.accessibilityLabel("Create image")
                }
            }
        }
        .refreshable { await cloud.gallery.refresh() }
        .task { await cloud.gallery.refresh() }
        .sheet(isPresented: Binding(get: { creation != nil }, set: { if !$0 { creation = nil } })) {
            if let creation { CloudImageCreationSheet(session: creation) { if let id = creation.conversation?.id { cloud.navigation.openConversation(id) } } }
        }
        .fullScreenCover(item: $preview) { payload in
            ZoomableImagePreviewScreen(payload: payload) { preview = nil; selected = nil }
        }
    }
}
