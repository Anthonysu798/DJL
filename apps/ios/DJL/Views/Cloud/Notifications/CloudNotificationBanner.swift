import SwiftUI

struct CloudNotificationBanner: View {
    let item: CloudNotification
    let open: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 12) {
                    Image(systemName: item.status == "failed" ? "exclamationmark.bubble" : "bubble.left.and.text.bubble.right")
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.status == "failed" ? "Task stopped" : "Task finished").font(AppFont.subheadline(weight: .semibold))
                        Text(item.conversationTitle ?? "Open DJL to see the result").font(AppFont.footnote()).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }.buttonStyle(.plain)
            Button(action: dismiss) { Image(systemName: "xmark").frame(width: 32, height: 32) }
                .accessibilityLabel("Dismiss notification").buttonStyle(.plain)
        }
        .padding(16)
        .adaptiveGlass(.regular, isInteractive: true, in: .rect(cornerRadius: 24))
        .padding(.horizontal, 16).padding(.top, 8)
    }
}
