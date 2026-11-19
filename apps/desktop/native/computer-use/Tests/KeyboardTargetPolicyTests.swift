import Darwin

@main struct KeyboardTargetPolicyTests {
    static func main() {
        var failures = 0
        func check(_ condition: Bool, line: Int = #line) {
            if !condition { failures += 1; print("FAIL keyboard policy at line \(line)") }
        }
        check(KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: nil, valueSettable: true, editable: nil, readOnly: nil, typing: true))
        check(!KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: nil, valueSettable: false, editable: nil, readOnly: nil, typing: true))
        check(KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: nil, valueSettable: false, editable: nil, readOnly: nil, typing: false))
        check(!KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: false, valueSettable: true, editable: true, readOnly: false, typing: false))
        check(!KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: false, valueSettable: true, editable: true, readOnly: false, typing: true))
        check(!KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: true, valueSettable: true, editable: nil, readOnly: true, typing: true))
        check(!KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: true, valueSettable: true, editable: false, readOnly: nil, typing: true))
        check(KeyboardTargetPolicy.permits(role: "AXButton", enabled: true, valueSettable: false, editable: nil, readOnly: nil, typing: false))
        check(!KeyboardTargetPolicy.permits(role: "AXButton", enabled: true, valueSettable: true, editable: true, readOnly: false, typing: true))
        check(!KeyboardTargetPolicy.permits(role: "AXWebArea", enabled: true, valueSettable: true, editable: true, readOnly: false, typing: true))
        check(!KeyboardTargetPolicy.permits(role: "AXTextField", enabled: nil, valueSettable: true, editable: true, readOnly: false, typing: true))
        check(KeyboardTargetPolicy.permits(role: "AXTextArea", enabled: nil, valueSettable: false, editable: true, readOnly: false, typing: true))
        check(KeyboardTargetPolicy.permitsFocus(.matches, isPreflight: false, requestedFieldFocused: true, appLocallyActive: true))
        check(!KeyboardTargetPolicy.permitsFocus(.different, isPreflight: true, requestedFieldFocused: true, appLocallyActive: false))
        check(!KeyboardTargetPolicy.permitsFocus(.different, isPreflight: false, requestedFieldFocused: true, appLocallyActive: true))
        check(!KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: false, requestedFieldFocused: true, appLocallyActive: false))
        check(!KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: true, requestedFieldFocused: false, appLocallyActive: false))
        check(!KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: true, requestedFieldFocused: nil, appLocallyActive: false))
        check(!KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: true, requestedFieldFocused: true, appLocallyActive: true))
        check(!KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: true, requestedFieldFocused: true, appLocallyActive: nil))
        check(KeyboardTargetPolicy.permitsFocus(.unavailable, isPreflight: true, requestedFieldFocused: true, appLocallyActive: false))
        print("KeyboardTargetPolicy: \(21 - failures)/21 checks passed")
        if failures > 0 { exit(1) }
    }
}
