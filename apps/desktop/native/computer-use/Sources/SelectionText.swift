import Foundation

enum SelectionText {
    enum Mode { case text, before, after }
    struct Mapping {
        let offsets: [Int?]
        let sourceLength: Int
    }
    static func resolve(_ value: String, text: String, prefix: String? = nil, suffix: String? = nil,
                        mode: Mode = .text, mapping: Mapping? = nil, checkpoint: () throws -> Void = {}) throws -> NSRange? {
        let source = value as NSString
        guard !text.isEmpty, source.length <= 1_048_576 else { return nil }
        try checkpoint()
        if let mapping = mapping {
            guard mapping.offsets.count == source.length, mapping.sourceLength >= 0 else { return nil }
            var previous = -1
            for (index, value) in mapping.offsets.enumerated() {
                if index % 64 == 0 { try checkpoint() }
                guard let offset = value else { continue }
                guard offset >= previous, offset >= 0, offset < mapping.sourceLength else { return nil }
                previous = offset
            }
        }
        var search = NSRange(location: 0, length: source.length)
        var match: NSRange?
        while search.length > 0 {
            try checkpoint()
            let found = source.range(of: text, options: [], range: search)
            if found.location == NSNotFound { break }
            let end = found.location + found.length
            var matches = true
            if let prefix = prefix {
                let count = (prefix as NSString).length
                matches = found.location >= count && source.substring(with: NSRange(location: found.location - count, length: count)) == prefix
            }
            if matches, let suffix = suffix {
                let count = (suffix as NSString).length
                matches = count <= source.length - end && source.substring(with: NSRange(location: end, length: count)) == suffix
            }
            if matches {
                guard match == nil else { return nil }
                match = found
            }
            let next = found.location + 1
            search = NSRange(location: next, length: source.length - next)
        }
        guard var result = match else { return nil }
        try checkpoint()
        if let mapping = mapping {
            let offsets = mapping.offsets[result.location..<(result.location + result.length)].compactMap { $0 }
            guard let first = offsets.first, let last = offsets.last else { return nil }
            result = NSRange(location: first, length: last - first + 1)
        }
        switch mode {
        case .text: return result
        case .before: return NSRange(location: result.location, length: 0)
        case .after: return NSRange(location: result.location + result.length, length: 0)
        }
    }
}
