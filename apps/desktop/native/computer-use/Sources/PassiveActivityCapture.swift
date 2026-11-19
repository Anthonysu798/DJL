import AppKit
import ApplicationServices
import CoreGraphics

private func passiveList(_ settings: Object, _ key: String, optional: Bool = false) throws -> [String] {
    if optional && settings[key] == nil { return [] }
    guard let values = settings[key] as? [String], values.count <= 100,
          values.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= (key.contains("Domains") ? 253 : 256) }) else {
        try fail("invalid-request", "Invalid passive activity policy")
    }
    let normalized = values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    if key.contains("Domains") {
        let pattern = "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
        guard normalized.allSatisfy({ ($0.hasSuffix(".") ? String($0.dropLast()) : $0).range(of: pattern, options: .regularExpression) != nil }) else {
            try fail("invalid-request", "Passive policy requires domain names without URLs or paths")
        }
    }
    return normalized
}
private func passiveDomainMatches(_ domain: String, _ rule: String) -> Bool {
    let normalized = rule.hasSuffix(".") ? String(rule.dropLast()) : rule
    return domain == normalized || domain.hasSuffix("." + normalized)
}
private func passiveBrowser(_ bundle: String) -> Bool {
    ["safari", "chrome", "chromium", "firefox", "brave", "edge", "vivaldi", "opera", "browser", "kagi.kagimac"].contains { bundle.contains($0) }
}
private func passivePrivateMarker(_ text: String) -> Bool {
    let lower = text.lowercased()
    return ["incognito", "inprivate", "private browsing", "private window", "隐私浏览", "无痕"].contains { lower.contains($0) }
}
private func passiveEditable(_ element: AXUIElement, _ role: String, read: (AXUIElement, String) -> CFTypeRef?, isCancelled: () -> Bool) -> Bool {
    if ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(role) || read(element, "AXEditable") as? Bool == true { return true }
    guard !isCancelled() else { return true }
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
}
private func passiveHost(_ element: AXUIElement, read: (AXUIElement, String) -> CFTypeRef?) -> String? {
    let value = read(element, "AXURL") ?? read(element, kAXDocumentAttribute)
    let text: String?
    if let url = value as? URL { text = url.absoluteString }
    else { text = value as? String }
    guard let text = text, let url = URL(string: text), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
          let host = url.host?.lowercased(), !host.isEmpty, host.utf16.count <= 253,
          host.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-.").contains($0) }) else { return nil }
    return host.hasSuffix(".") ? String(host.dropLast()) : host
}

// Observe only the foreground focused window. Never prompts, activates, posts input,
// touches the physical cursor, captures images, or presents the background PIP.
func capturePassiveActivity(settings: Object, isCancelled: @escaping () -> Bool = { false }) throws -> Object? {
    func checkCancellation() throws { if isCancelled() { try fail("cancelled", "Passive capture policy was revoked") } }
    let read: (AXUIElement, String) -> CFTypeRef? = { element, name in
        guard !isCancelled() else { return nil }
        return attr(element, name)
    }
    func protected(_ element: AXUIElement) -> Bool {
        let role = read(element, kAXRoleAttribute) as? String ?? ""
        let subrole = read(element, kAXSubroleAttribute) as? String ?? ""
        return role.localizedCaseInsensitiveContains("secure") || subrole.localizedCaseInsensitiveContains("secure") || read(element, "AXProtectedContent") as? Bool == true
    }
    func rectangle(_ element: AXUIElement) -> CGRect? {
        guard let position = read(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
              let size = read(element, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, dimensions = CGSize.zero
        guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
              AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions),
              abs(point.x) <= 100000, abs(point.y) <= 100000, dimensions.width > 0, dimensions.height > 0,
              dimensions.width <= 100000, dimensions.height <= 100000 else { return nil }
        return CGRect(origin: point, size: dimensions)
    }
    try checkCancellation()
    try keys(settings, ["enabled", "paused", "retentionDays", "intervalSeconds", "includedBundleIds", "includedDomains", "excludedBundleIds", "excludedDomains"],
             ["enabled", "paused", "retentionDays", "intervalSeconds", "excludedBundleIds", "excludedDomains"])
    guard try bool(settings, "enabled"), !(try bool(settings, "paused")) else { return nil }
    _ = try number(settings, "retentionDays", min: 1, max: 365, integer: true)
    _ = try number(settings, "intervalSeconds", min: 5, max: 3600, integer: true)
    let includedApps = try passiveList(settings, "includedBundleIds", optional: true)
    let excludedApps = try passiveList(settings, "excludedBundleIds")
    let includedDomains = try passiveList(settings, "includedDomains", optional: true)
    let excludedDomains = try passiveList(settings, "excludedDomains")
    guard AXIsProcessTrusted(), let session = CGSessionCopyCurrentDictionary() as? Object,
          session["CGSSessionScreenIsLocked"] as? Bool != true,
          session["kCGSessionOnConsoleKey"] as? Bool != false,
          let frontmost = NSWorkspace.shared.frontmostApplication, !frontmost.isTerminated,
          let bundleId = frontmost.bundleIdentifier else { return nil }
    let bundle = bundleId.lowercased()
    let sensitive = ["com.apple.loginwindow", "com.apple.securityagent", "com.apple.keychainaccess", "com.apple.systempreferences", "com.apple.passwords", "com.djl.computer-use"]
    guard !sensitive.contains(bundle), !bundle.contains("1password"), !bundle.contains("onepassword"), !bundle.contains("bitwarden"),
          !bundle.contains("lastpass"), !bundle.contains("dashlane"), !bundle.contains("keepass"),
          !excludedApps.contains(bundle), includedApps.isEmpty || includedApps.contains(bundle),
          frontmost.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return nil }

    let deadline = Date().addingTimeInterval(2)
    // App policy is checked before any accessibility attribute is read.
    try checkCancellation()
    let identity = try ProcessIdentity(frontmost.processIdentifier)
    let app = AXUIElementCreateApplication(frontmost.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.15)
    guard let rootValue = read(app, kAXFocusedWindowAttribute), CFGetTypeID(rootValue) == AXUIElementGetTypeID() else { return nil }
    let root = unsafeBitCast(rootValue, to: AXUIElement.self)
    AXUIElementSetMessagingTimeout(root, 0.15)
    guard !protected(root), let windowBounds = rectangle(root) else { return nil }
    let title = clipped(read(root, kAXTitleAttribute) as? String)
    if passivePrivateMarker(title) { return nil }
    let candidates = windows().filter { window in
        guard window.pid == frontmost.processIdentifier else { return false }
        if let number = read(root, "AXWindowNumber") as? NSNumber { return window.id == number.uint32Value }
        return abs(window.rect.minX - windowBounds.minX) < 2 && abs(window.rect.minY - windowBounds.minY) < 2 &&
            abs(window.rect.width - windowBounds.width) < 2 && abs(window.rect.height - windowBounds.height) < 2 &&
            (window.title.isEmpty || window.title == title)
    }
    guard candidates.count == 1, let target = candidates.first else { return nil }
    if let focusedValue = read(app, kAXFocusedUIElementAttribute), CFGetTypeID(focusedValue) == AXUIElementGetTypeID() {
        var focused = unsafeBitCast(focusedValue, to: AXUIElement.self)
        for _ in 0..<30 {
            try checkCancellation()
            guard Date() < deadline else { return nil }
            if protected(focused) { return nil }
            guard let parentValue = read(focused, kAXParentAttribute), CFGetTypeID(parentValue) == AXUIElementGetTypeID() else { break }
            focused = unsafeBitCast(parentValue, to: AXUIElement.self)
        }
    }

    var webContext = passiveBrowser(bundle), domain = passiveHost(root, read: read)
    var privateState: Bool? = nil
    var domains = Set<String>()
    if let domain = domain { domains.insert(domain) }
    var queue: [(AXUIElement, Int)] = [(root, 0)], offset = 0
    // First pass reads only structure, URL and explicit privacy metadata. No static
    // text labels/values are collected until every domain/privacy rule has passed.
    while offset < queue.count && offset < 300 {
        try checkCancellation()
        guard Date() < deadline else { return nil }
        let (element, depth) = queue[offset]; offset += 1
        AXUIElementSetMessagingTimeout(element, 0.1)
        if protected(element) { continue }
        for name in ["AXPrivateBrowsing", "AXIncognito", "AXIsPrivate", "AXInPrivate"] {
            if let value = read(element, name) as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() {
                if value.boolValue { return nil }
                privateState = false
            }
        }
        let role = read(element, kAXRoleAttribute) as? String ?? ""
        if role == "AXWebArea" {
            webContext = true
            if let host = passiveHost(element, read: read) { domain = domain ?? host; domains.insert(host) }
            else if !includedDomains.isEmpty || !excludedDomains.isEmpty { return nil }
        }
        if passiveEditable(element, role, read: read, isCancelled: isCancelled) { continue }
        if depth < 24 && queue.count < 300 {
            var count: CFIndex = 0, children: CFArray?
            try checkCancellation()
            if AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count) == .success, count > 0 {
                let remaining = min(count, 300 - queue.count)
                try checkCancellation()
                if remaining > 0, AXUIElementCopyAttributeValues(element, kAXChildrenAttribute as CFString, 0, remaining, &children) == .success,
                   let children = children as? [AXUIElement] { queue += children.map { ($0, depth + 1) } }
            }
        }
    }
    if webContext && privateState != false { return nil }
    if domains.contains(where: { host in excludedDomains.contains(where: { passiveDomainMatches(host, $0) }) }) { return nil }
    if !includedDomains.isEmpty && (domains.isEmpty || domains.contains(where: { host in !includedDomains.contains(where: { passiveDomainMatches(host, $0) }) })) { return nil }
    if webContext && domains.isEmpty && !excludedDomains.isEmpty { return nil }
    try checkCancellation()
    var labels: [String] = [], seenLabels = Set<String>()
    for (element, _) in queue {
        try checkCancellation()
        guard Date() < deadline else { return nil }
        if protected(element) { continue }
        let role = read(element, kAXRoleAttribute) as? String ?? ""
        if passiveEditable(element, role, read: read, isCancelled: isCancelled) { continue }
        if role == "AXStaticText" {
            let text = clipped((read(element, kAXValueAttribute) as? String) ?? (read(element, kAXTitleAttribute) as? String), 256)
            if passivePrivateMarker(text) { return nil }
            if !text.isEmpty, labels.count < 32, let bounds = rectangle(element), bounds.intersects(windowBounds),
               read(element, "AXHidden") as? Bool != true, seenLabels.insert(text).inserted { labels.append(text) }
        }
    }
    try checkCancellation()
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == frontmost.processIdentifier,
          (try? ProcessIdentity(frontmost.processIdentifier)) == identity,
          let currentValue = read(app, kAXFocusedWindowAttribute), CFEqual(currentValue, root),
          let currentRect = rectangle(root), currentRect == windowBounds,
          clipped(read(root, kAXTitleAttribute) as? String) == title else { return nil }
    try checkCancellation()
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var result: Object = ["id": UUID().uuidString, "capturedAt": formatter.string(from: Date()),
                          "target": ["bundleId": bundleId, "pid": frontmost.processIdentifier, "windowId": target.id],
                          "appName": clipped(frontmost.localizedName), "windowTitle": title,
                          "webContext": webContext, "labels": labels]
    if let domain = domain { result["domain"] = domain }
    return result
}
