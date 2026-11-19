import AppKit

@main struct PasteRepresentationsTests {
    static func main() {
        do { try run() }
        catch { print("FAIL paste representations: \(error)"); exit(1) }
    }
    static func run() throws {
        let literal = "  **literal** café ✓\n"
        let text = try PasteRepresentations.make(text: literal, format: "text")
        assert(text.count == 1 && text[.string] == Data(literal.utf8))

        let html = "<p>A &amp; café<br>next</p><p><b>Bold</b></p><script>hidden-secret</script><style>hidden-style</style>"
        let rich = try PasteRepresentations.make(text: html, format: "html")
        assert(rich[.html] == Data(html.utf8))
        assert(String(data: rich[.string]!, encoding: .utf8) == "A & café\nnext\nBold")

        let markdown = try PasteRepresentations.make(text: "# Heading\n\n**Bold** and *italic* [link](https://example.test)\n\n- one\n- two\n\n`<code>`", format: "md")
        let rendered = String(data: markdown[.html]!, encoding: .utf8)!
        assert(rendered.contains("<h1>Heading</h1>") && rendered.contains("<strong>Bold</strong>") && rendered.contains("<em>italic</em>"))
        assert(rendered.contains("<a href=\"https://example.test\">link</a>") && rendered.contains("<li>one</li>") && rendered.contains("<code>&lt;code&gt;</code>"))
        assert(String(data: markdown[.string]!, encoding: .utf8) == "Heading\nBold and italic link\none\ntwo\n<code>")

        let sentinel = "DJL-owned-external-entity-must-not-be-loaded"
        let path = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("djl-paste-entity-\(UUID().uuidString).txt")
        try sentinel.write(to: path, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: path) }
        let external = "<!DOCTYPE html [<!ENTITY owned SYSTEM '\(path.absoluteString)'>]><html><body>&owned;</body></html>"
        if let result = try? PasteRepresentations.make(text: external, format: "html") {
            assert(!String(data: result[.string]!, encoding: .utf8)!.contains(sentinel))
        }
        let image = "<p>Visible</p><img src='https://example.invalid/remote.png' alt='description'>"
        let imageResult = try PasteRepresentations.make(text: image, format: "html")
        assert(String(data: imageResult[.string]!, encoding: .utf8) == "Visible\ndescription")
        for (text, format) in [("", "text"), (String(repeating: "x", count: 16_385), "text"), ("value", "rtf"), ("a\0b", "md")] {
            do { _ = try PasteRepresentations.make(text: text, format: format); fatalError("Accepted invalid representation") }
            catch is PasteRepresentationError {}
        }
        print("Paste representations: text, rich Markdown/HTML, plain fallback, external-entity and input bounds passed")
    }
}
