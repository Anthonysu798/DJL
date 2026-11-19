import Foundation

enum SelectionOperation {
    enum Failure: Error { case missingOrAmbiguous, valueChanged }
    static func perform(text: String, prefix: String?, suffix: String?, mode: SelectionText.Mode,
                        readValue: () throws -> String, focus: () throws -> Void,
                        validate: () throws -> Void, write: (NSRange) throws -> Void,
                        checkpoint: () throws -> Void) throws -> NSRange {
        try checkpoint()
        let original = try readValue()
        try checkpoint()
        guard let range = try SelectionText.resolve(original, text: text, prefix: prefix, suffix: suffix,
                                                     mode: mode, checkpoint: checkpoint) else { throw Failure.missingOrAmbiguous }
        try checkpoint()
        try focus()
        try checkpoint()
        try validate()
        try checkpoint()
        let current = try readValue()
        try checkpoint()
        guard original.utf16.elementsEqual(current.utf16) else { throw Failure.valueChanged }
        try validate()
        try checkpoint()
        try write(range)
        return range
    }
}
