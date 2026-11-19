import AppKit
import libxml2
import Darwin

enum PasteRepresentationError: Error { case invalid, unavailable, tooLarge }
enum PasteRepresentations {
    private typealias MarkdownToHTML = @convention(c) (UnsafePointer<CChar>, Int, Int32) -> UnsafeMutablePointer<CChar>?
    private static let markdown: MarkdownToHTML? = {
        guard let library = dlopen("/usr/lib/libcmark-gfm.dylib", RTLD_NOW | RTLD_LOCAL),
              let symbol = dlsym(library, "cmark_markdown_to_html") else { return nil }
        return unsafeBitCast(symbol, to: MarkdownToHTML.self)
    }()
    static func make(text: String, format: String) throws -> [NSPasteboard.PasteboardType: Data] {
        guard !text.isEmpty, text.utf16.count <= 16_384, !text.contains("\0") else { throw PasteRepresentationError.invalid }
        if format == "text" { return [.string: Data(text.utf8)] }
        let html: String
        switch format {
        case "html": html = text
        case "md":
            guard let render = markdown,
                  let buffer = text.withCString({ render($0, text.utf8.count, 0) }) else { throw PasteRepresentationError.unavailable }
            defer { free(buffer) }
            html = String(cString: buffer)
        default: throw PasteRepresentationError.invalid
        }
        guard html.utf8.count <= 4_194_304 else { throw PasteRepresentationError.tooLarge }
        let plain = try plainText(html)
        guard html.utf8.count + plain.utf8.count <= 4_194_304 else { throw PasteRepresentationError.tooLarge }
        return [.html: Data(html.utf8), .string: Data(plain.utf8)]
    }
    private static func plainText(_ html: String) throws -> String {
        // A local HTML parser, not WebKit: do not load DTDs, external entities,
        // images or stylesheets. Suppress parser diagnostics containing input.
        let options = Int32(HTML_PARSE_NONET.rawValue | HTML_PARSE_NOERROR.rawValue | HTML_PARSE_NOWARNING.rawValue)
        guard let document = html.withCString({ htmlReadMemory($0, Int32(html.utf8.count), nil, "UTF-8", options) }) else { throw PasteRepresentationError.invalid }
        defer { xmlFreeDoc(document) }
        let blocks: Set<String> = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "pre", "blockquote"]
        let hidden: Set<String> = ["head", "script", "style", "template"]
        var result = "", nodes = 0
        func visit(_ start: xmlNodePtr?, depth: Int, pre: Bool) throws {
            guard depth <= 64 else { throw PasteRepresentationError.tooLarge }
            var current = start
            while let node = current {
                nodes += 1
                guard nodes <= 10_000 else { throw PasteRepresentationError.tooLarge }
                if node.pointee.type == XML_TEXT_NODE || node.pointee.type == XML_CDATA_SECTION_NODE {
                    if let content = node.pointee.content {
                        let text = String(cString: content)
                        if pre || !text.contains("\n") || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { result += text }
                    }
                } else if node.pointee.type == XML_ELEMENT_NODE, let rawName = node.pointee.name {
                    let name = String(cString: rawName).lowercased()
                    if !hidden.contains(name) {
                        if name == "br" { result += "\n" }
                        if name == "img", let alt = xmlGetProp(node, "alt") {
                            result += String(cString: alt); xmlFree(alt)
                        }
                        try visit(node.pointee.children, depth: depth + 1, pre: pre || name == "pre")
                        if blocks.contains(name), !result.hasSuffix("\n") { result += "\n" }
                    }
                }
                current = node.pointee.next
            }
        }
        try visit(xmlDocGetRootElement(document), depth: 0, pre: false)
        return result.trimmingCharacters(in: .newlines)
    }
}
