// FILE: CloudComposerView.swift
// Purpose: Cloud chat composer: text, photo / camera / file attachments with validation, Task mode, the
//          "Edit image" chip, and send / stop.
// Layer: View
// Exports: CloudComposerView
// Depends on: CloudChatSession, CloudAttachmentPolicy, CameraImagePicker, PhotosUI

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct CloudComposerView: View {
    @Binding var text: String
    @Binding var attachments: [CloudPendingAttachment]
    @Bindable var session: CloudChatSession
    let onSend: () -> Void

    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var isShowingPhotos = false
    @State private var isShowingCamera = false
    @State private var isShowingFiles = false
    @State private var attachmentError: String?

    private var canSend: Bool {
        !session.isSending && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !attachments.isEmpty || session.imageToEdit != nil {
                attachmentStrip
            }
            if let attachmentError {
                Text(attachmentError).font(AppFont.caption()).foregroundStyle(.red)
            }
            TextField(session.imageToEdit == nil ? "Message DJL" : "Describe the change", text: $text, axis: .vertical)
                .font(AppFont.body())
                .lineLimit(1...6)
                .padding(.horizontal, 4)
            HStack(spacing: 10) {
                attachMenu
                modeToggle
                Spacer()
                sendButton
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .photosPicker(isPresented: $isShowingPhotos, selection: $photoSelection, maxSelectionCount: 4, matching: .images)
        .onChange(of: photoSelection) { _, items in loadPhotos(items) }
        .fullScreenCover(isPresented: $isShowingCamera) {
            CameraImagePicker { data in add(name: "Photo.jpg", mimeType: "image/jpeg", data: data) }
                .ignoresSafeArea()
        }
        .fileImporter(isPresented: $isShowingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            loadFiles(result)
        }
    }

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if session.imageToEdit != nil {
                    chip(title: "Editing image", systemImage: "wand.and.stars") { session.imageToEdit = nil }
                }
                ForEach(attachments) { attachment in
                    if attachment.isImage, let image = UIImage(data: attachment.data) {
                        ZStack(alignment: .topTrailing) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            removeButton { attachments.removeAll { $0.id == attachment.id } }
                        }
                    } else {
                        chip(title: attachment.name, systemImage: "doc") { attachments.removeAll { $0.id == attachment.id } }
                    }
                }
            }
        }
    }

    private func chip(title: String, systemImage: String, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
            Text(title).lineLimit(1)
            Button(action: onRemove) { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove")
        }
        .font(AppFont.footnote(weight: .medium))
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(Color(.tertiarySystemBackground), in: Capsule())
    }

    private func removeButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .black.opacity(0.6))
        }
        .buttonStyle(.plain)
        .offset(x: 4, y: -4)
        .accessibilityLabel("Remove")
    }

    private var attachMenu: some View {
        Menu {
            Button { isShowingPhotos = true } label: { Label("Photos", systemImage: "photo.on.rectangle") }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { isShowingCamera = true } label: { Label("Camera", systemImage: "camera") }
            }
            Button { isShowingFiles = true } label: { Label("Files", systemImage: "folder") }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 34, height: 34)
                .background(Color(.tertiarySystemBackground), in: Circle())
        }
        .foregroundStyle(.primary)
        .accessibilityLabel("Add attachment")
    }

    private var modeToggle: some View {
        Button {
            session.mode = session.mode == .task ? .chat : .task
        } label: {
            Label("Task", systemImage: "checklist")
                .font(AppFont.footnote(weight: .semibold))
                .padding(.horizontal, 12)
                .frame(height: 34)
                .foregroundStyle(session.mode == .task ? Color.white : Color.primary)
                .background(session.mode == .task ? Color.accentColor : Color(.tertiarySystemBackground), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Task mode")
        .accessibilityValue(session.mode == .task ? "On" : "Off")
    }

    @ViewBuilder
    private var sendButton: some View {
        if session.isRunning {
            Button { Task { await session.stop() } } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color(.systemBackground))
                    .frame(width: 34, height: 34)
                    .background(Color.primary, in: Circle())
            }
            .accessibilityLabel("Stop")
        } else {
            Button(action: onSend) {
                Group {
                    if session.isSending {
                        ProgressView().tint(Color(.systemBackground))
                    } else {
                        Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                    }
                }
                .foregroundStyle(Color(.systemBackground))
                .frame(width: 34, height: 34)
                .background(canSend ? Color.primary : Color.secondary.opacity(0.4), in: Circle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
    }

    // MARK: Attachments

    private func add(name: String, mimeType: String, data: Data) {
        do {
            try CloudAttachmentPolicy.validate(mimeType: mimeType, byteCount: data.count, existingCount: attachments.count)
            attachments.append(CloudPendingAttachment(name: name, mimeType: mimeType, data: data))
            attachmentError = nil
        } catch {
            attachmentError = (error as? LocalizedError)?.errorDescription
        }
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photoSelection = []
        Task {
            for item in items {
                guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                // Re-encode to JPEG: strips metadata and turns HEIC into something every model reads.
                guard let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) else { continue }
                add(name: "Photo.jpg", mimeType: "image/jpeg", data: jpeg)
            }
        }
    }

    private func loadFiles(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size > CloudAttachmentPolicy.maxBytes {
                attachmentError = CloudAttachmentPolicy.Rejection.tooLarge.errorDescription
                continue
            }
            guard let data = try? Data(contentsOf: url) else { continue }
            add(name: url.lastPathComponent, mimeType: CloudAttachmentPolicy.mimeType(forFilename: url.lastPathComponent), data: data)
        }
    }
}
