// FILE: CloudMessageRow.swift
// Purpose: Renders one cloud message: user bubble or assistant markdown (streaming), inline images, file chips,
//          tool activity, and the copy / edit / regenerate / branch-switch actions.
// Layer: View
// Exports: CloudMessageRow, CloudImagePartView
// Depends on: StreamingAssistantMarkdownTextView, CloudService, CloudModels

import SwiftUI

struct CloudMessageRow: View {
    let message: CloudMessage
    let isStreaming: Bool
    let siblings: (ids: [String], index: Int)
    let onOpenImage: (CloudMessagePart, UIImage) -> Void
    let onEdit: () -> Void
    let onRegenerate: () -> Void
    let onSwitchBranch: (Int) -> Void

    var body: some View {
        if message.isUser {
            userBody
        } else {
            assistantBody
        }
    }

    // MARK: User

    private var userBody: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
                switch part {
                case .imageRef:
                    CloudImagePartView(part: part, maxHeight: 180, onOpen: onOpenImage)
                case .fileRef(_, let name, let mimeType, let size):
                    CloudFileChip(name: name, mimeType: mimeType, size: size)
                default:
                    EmptyView()
                }
            }
            if !message.text.isEmpty {
                Text(message.text)
                    .font(AppFont.body())
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .contextMenu {
                        Button { UIPasteboard.general.string = message.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                        Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
                    }
            }
            branchSwitcher
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 48)
    }

    // MARK: Assistant

    private var assistantBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(message.parts.enumerated()), id: \.offset) { index, part in
                switch part {
                case .text(let text):
                    StreamingAssistantMarkdownTextView(
                        text: text,
                        enablesSelection: !isStreaming,
                        constrainsToAvailableWidth: true,
                        animatesReveal: isStreaming && index == message.parts.count - 1
                    )
                case .imageRef:
                    CloudImagePartView(part: part, maxHeight: 360, onOpen: onOpenImage)
                case .fileRef(_, let name, let mimeType, let size):
                    CloudFileChip(name: name, mimeType: mimeType, size: size)
                case .toolCall(_, let name, _):
                    CloudToolActivityLabel(name: name)
                case .toolResult(_, _, let content, let isError):
                    if isError {
                        Label(content, systemImage: "exclamationmark.circle")
                            .font(AppFont.footnote())
                            .foregroundStyle(.secondary)
                    }
                case .citation(let url, let title):
                    if let link = URL(string: url), ["https", "http"].contains(link.scheme?.lowercased()) {
                        Link(destination: link) {
                            Label(title ?? link.host() ?? url, systemImage: "link")
                                .font(AppFont.footnote())
                                .lineLimit(1)
                        }
                    }
                }
            }
            if isStreaming, message.parts.isEmpty {
                ShimmerText(text: "Thinking", font: AppFont.body())
            }
            if !isStreaming {
                actions
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actions: some View {
        HStack(spacing: 16) {
            Button { UIPasteboard.general.string = message.text } label: { Image(systemName: "doc.on.doc") }
                .accessibilityLabel("Copy")
            Button(action: onRegenerate) { Image(systemName: "arrow.clockwise") }
                .accessibilityLabel("Regenerate")
            branchSwitcher
            Spacer(minLength: 0)
            if let model = message.model {
                Text(model).font(AppFont.caption()).foregroundStyle(.tertiary)
            }
        }
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var branchSwitcher: some View {
        if siblings.ids.count > 1 {
            HStack(spacing: 6) {
                Button { onSwitchBranch(-1) } label: { Image(systemName: "chevron.left") }
                    .disabled(siblings.index == 0)
                Text("\(siblings.index + 1) / \(siblings.ids.count)")
                    .font(AppFont.caption(weight: .medium))
                    .monospacedDigit()
                Button { onSwitchBranch(1) } label: { Image(systemName: "chevron.right") }
                    .disabled(siblings.index == siblings.ids.count - 1)
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.secondary)
            .buttonStyle(.plain)
        }
    }
}

/// Loads an image file through a signed URL and opens the shared full-screen preview on tap.
struct CloudImagePartView: View {
    @Environment(CloudService.self) private var cloud
    let part: CloudMessagePart
    let maxHeight: CGFloat
    let onOpen: (CloudMessagePart, UIImage) -> Void
    @State private var image: UIImage?
    @State private var failed = false

    private var fileId: String? {
        if case .imageRef(let fileId, _, _, _) = part { return fileId }
        return nil
    }

    private var aspectRatio: CGFloat {
        if case .imageRef(_, _, let width?, let height?) = part, width > 0, height > 0 {
            return CGFloat(width) / CGFloat(height)
        }
        if let image, image.size.height > 0 { return image.size.width / image.size.height }
        return 1
    }

    var body: some View {
        Group {
            if let image {
                Button { onOpen(part, image) } label: {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Image. Double-tap to open.")
            } else {
                ZStack {
                    Color(.secondarySystemBackground)
                    if failed {
                        Image(systemName: "photo.badge.exclamationmark").foregroundStyle(.secondary)
                    } else {
                        ProgressView()
                    }
                }
            }
        }
        .aspectRatio(aspectRatio, contentMode: .fit)
        .frame(maxHeight: maxHeight)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .task(id: fileId) {
            guard let fileId else { return }
            image = cloud.cachedImage(fileId: fileId)
            guard image == nil else { return }
            image = await cloud.image(fileId: fileId)
            failed = image == nil
        }
    }
}

private struct CloudFileChip: View {
    let name: String
    let mimeType: String
    let size: Int

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: mimeType == "application/pdf" ? "doc.richtext" : "doc")
                .font(.system(size: 18))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(AppFont.subheadline(weight: .medium)).lineLimit(1)
                Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                    .font(AppFont.caption())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct CloudToolActivityLabel: View {
    let name: String

    var body: some View {
        Label(Self.title(for: name), systemImage: Self.icon(for: name))
            .font(AppFont.footnote(weight: .medium))
            .foregroundStyle(.secondary)
    }

    static func title(for tool: String) -> String {
        switch tool {
        case "web_search": return "Searched the web"
        case "read_page": return "Read a page"
        case "generate_image": return "Generated an image"
        case "edit_image": return "Edited an image"
        case "read_file": return "Read a file"
        case "python": return "Ran Python"
        default: return "Used \(tool)"
        }
    }

    static func icon(for tool: String) -> String {
        switch tool {
        case "web_search": return "magnifyingglass"
        case "read_page": return "globe"
        case "generate_image", "edit_image": return "photo"
        case "read_file": return "doc.text"
        case "python": return "chevron.left.forwardslash.chevron.right"
        default: return "wrench.and.screwdriver"
        }
    }
}
