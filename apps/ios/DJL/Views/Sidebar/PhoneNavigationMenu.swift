// Compact navigation over the existing paired desktop's thread store.
import SwiftUI

struct PhoneNavigationMenu: View {
    @Environment(CodexService.self) private var codex
    let selectedThreadID: String?
    let isRemoteSelected: Bool
    let onRemote: () -> Void
    let onThread: (CodexThread) -> Void
    let onNewChat: () -> Void
    let onSettings: () -> Void

    @State private var searchText = ""
    @State private var showsSearch = false
    @State private var headerHeight: CGFloat = 74
    @FocusState private var searchFocused: Bool

    private var visibleThreads: [CodexThread] {
        codex.threads.filter { thread in
            !thread.isSubagent && thread.syncState == .live
                && (searchText.isEmpty || thread.displayTitle.localizedCaseInsensitiveContains(searchText))
        }
        .sorted {
            let left = $0.updatedAt ?? $0.createdAt ?? .distantPast
            let right = $1.updatedAt ?? $1.createdAt ?? .distantPast
            return left == right ? $0.id < $1.id : left > right
        }
    }

    var body: some View {
        let threads = visibleThreads
        let pinnedIDs = Set(codex.pinnedThreadIDs)
        let pinned = threads.filter { pinnedIDs.contains($0.id) }
        let recent = threads.filter { !pinnedIDs.contains($0.id) }

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 4) {
                Button(action: onRemote) {
                    HStack(spacing: 14) {
                        Image(systemName: "laptopcomputer")
                            .font(.system(size: 22))
                            .frame(width: 26)
                        Text("Remote").font(.system(.body, weight: .medium))
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .background(isRemoteSelected ? Color.primary.opacity(0.055) : .clear, in: RoundedRectangle(cornerRadius: 16))
                }
                .accessibilityIdentifier("navigation.remote")

                sectionTitle("Pinned")
                if pinned.isEmpty {
                    Text("Keep favorite chats close.\nTouch and hold a chat to pin it.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                } else {
                    ForEach(pinned) { thread in
                        threadRow(thread, pinned: true)
                    }
                }

                sectionTitle("Recent chats")
                if recent.isEmpty {
                    Text(searchText.isEmpty ? "Your chats will appear here." : "No matching chats")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                } else {
                    ForEach(recent) { thread in
                        threadRow(thread, pinned: false)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, headerHeight)
            // The last row can scroll above the floating controls without
            // shortening the scroll viewport or painting a footer band.
            .padding(.bottom, 124)
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .scrollDismissesKeyboard(.interactively)
        .mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                    .frame(height: 20)
                Rectangle().fill(.black)
            }
        }
        .overlay(alignment: .top) {
            floatingHeader
                .onGeometryChange(for: CGFloat.self) { geometry in
                    geometry.size.height
                } action: { height in
                    headerHeight = height
                }
        }
        .overlay(alignment: .bottom) {
            AdaptiveGlassContainer(spacing: 24) {
                HStack {
                    Button(action: onNewChat) {
                        Label("Chat", systemImage: "square.and.pencil")
                            .font(.system(.body, weight: .semibold))
                            .padding(.horizontal, 22)
                            .frame(minHeight: 50)
                            .foregroundStyle(Color(.systemBackground))
                    }
                    .buttonStyle(.plain)
                    .adaptiveGlass(.regular, isInteractive: true, tint: Color.primary, in: Capsule())
                    .disabled(!codex.isConnected)
                    .accessibilityLabel("New chat")
                    Spacer()
                    Button(action: onSettings) {
                        Image(systemName: "gearshape")
                            .font(.system(size: 22, weight: .medium))
                            .frame(width: 50, height: 50)
                    }
                    .buttonStyle(.plain)
                    .adaptiveGlass(.regular, isInteractive: true, in: Circle())
                    .accessibilityLabel("Settings")
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 12)
        }
        .foregroundStyle(.primary)
        .buttonStyle(.plain)
        .background(Color(.systemBackground))
    }

    private var floatingHeader: some View {
        VStack(spacing: 0) {
            AdaptiveGlassContainer(spacing: 16) {
                HStack {
                    HStack(spacing: 8) {
                        Image("AppLogo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 25, height: 25)
                            .accessibilityHidden(true)
                        Text("DJL")
                            .font(.system(.title2, design: .default, weight: .semibold))
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .adaptiveGlass(.regular, in: Capsule())
                    Spacer()
                    Button {
                        showsSearch.toggle()
                        searchFocused = showsSearch
                        if !showsSearch { searchText = "" }
                    } label: {
                        Image(systemName: showsSearch ? "xmark" : "magnifyingglass")
                            .font(.system(size: 19, weight: .medium))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .adaptiveGlass(.regular, isInteractive: true, in: Circle())
                    .accessibilityLabel(showsSearch ? "Close search" : "Search chats")
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 12)
            .padding(.bottom, 18)

            if showsSearch {
                TextField("Search chats", text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($searchFocused)
                    .padding(12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal, 18)
                    .padding(.bottom, 12)
                    .accessibilityIdentifier("navigation.search")
            }
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(.subheadline, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.top, 26)
            .padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)
    }

    private func threadRow(_ thread: CodexThread, pinned: Bool) -> some View {
        Button { onThread(thread) } label: {
            HStack(spacing: 12) {
                Image(systemName: pinned ? "pin" : "bubble.left")
                    .font(.system(size: 18))
                    .frame(width: 26)
                Text(thread.displayTitle)
                    .font(.body)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if codex.runningThreadIDs.contains(thread.id) {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(selectedThreadID == thread.id ? Color.primary.opacity(0.065) : .clear, in: RoundedRectangle(cornerRadius: 14))
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("navigation.thread.\(thread.id)")
        .contextMenu {
            Button {
                if pinned { codex.unpinThread(thread.id) }
                else { codex.pinThread(thread.id) }
            } label: {
                Label(pinned ? "Unpin chat" : "Pin chat", systemImage: pinned ? "pin.slash" : "pin")
            }
        }
    }
}
