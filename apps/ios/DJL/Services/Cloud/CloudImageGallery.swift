import Foundation
import Observation

nonisolated struct CloudGeneratedImage: Codable, Sendable, Identifiable, Equatable {
    let fileId: String
    let conversationId: String
    let messageId: String
    let prompt: String
    let mimeType: String
    let size: Int
    let width: Int?
    let height: Int?
    let createdAt: String
    var id: String { fileId }
    var part: CloudMessagePart { .imageRef(fileId: fileId, mimeType: mimeType, width: width, height: height) }
}
nonisolated struct CloudImageGalleryPage: Codable, Sendable {
    let images: [CloudGeneratedImage]
    let nextCursor: String?
}
nonisolated struct CloudCreateImageInput: Codable, Sendable {
    let clientMessageId: String
    let prompt: String
    let aspectRatio: String
}

@MainActor @Observable final class CloudImageGallery {
    private(set) var images: [CloudGeneratedImage] = []
    private(set) var nextCursor: String?
    private(set) var isLoading = false
    private(set) var error: String?
    @ObservationIgnored private weak var cloud: CloudService?
    @ObservationIgnored private var revision = 0
    init(cloud: CloudService) { self.cloud = cloud }
    func reset() { revision += 1; images = []; nextCursor = nil; error = nil; isLoading = false }
    func refresh() async { await load(cursor: nil) }
    func loadNextPage() async { guard let nextCursor else { return }; await load(cursor: nextCursor) }
    private func load(cursor: String?) async {
        guard let cloud, cloud.isSignedIn, !isLoading else { return }
        let session = cloud.sessionRevision, version = revision
        isLoading = true
        defer { if revision == version { isLoading = false } }
        do {
            let page = try await cloud.client.images(cursor: cursor)
            guard !Task.isCancelled, version == revision, cloud.sessionRevision == session else { return }
            let all = (cursor == nil ? [] : images) + page.images
            var seen = Set<String>()
            images = all.filter { seen.insert($0.id).inserted }
            nextCursor = page.nextCursor; error = nil
        } catch {
            guard version == revision, cloud.sessionRevision == session, !Task.isCancelled else { return }
            self.error = error.localizedDescription; cloud.handle(error)
        }
    }
}
