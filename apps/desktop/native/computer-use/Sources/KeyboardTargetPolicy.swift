// Ownership, exact focus, window binding and secure ancestors are verified by the
// caller. A standard NSTextView omits AXEnabled even when keyboard-editable.
enum KeyboardTargetPolicy {
    enum FocusMatch { case matches, different, unavailable }
    static func permitsFocus(_ evidence: FocusMatch, isPreflight: Bool, requestedFieldFocused: Bool?, appLocallyActive: Bool?) -> Bool {
        switch evidence {
        case .matches: return true
        case .different: return false
        case .unavailable: return isPreflight && requestedFieldFocused == true && appLocallyActive == false
        }
    }
    static func permits(role: String, enabled: Bool?, valueSettable: Bool, editable: Bool?, readOnly: Bool?, typing: Bool) -> Bool {
        guard enabled != false else { return false }
        if !typing { return true }
        guard ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(role),
              enabled == true || role == "AXTextArea", editable != false, readOnly != true else { return false }
        return valueSettable || editable == true
    }
}
