#!/usr/bin/env python3
"""Build-only: copy current sources and insert synthetic-identifier-only read-attempt audit.
Never enables capture or runs a helper. Production Sources stay uninstrumented.
"""
from pathlib import Path
import shutil, subprocess
base=Path(__file__).resolve().parents[1]
out=Path('/private/tmp/djl-cua-history-audit');out.mkdir(exist_ok=True)
for path in (base/'Sources').glob('*.swift'):
    source=path.read_text()
    if path.name=='InteractionHistory.swift':
        anchor='        let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)'
        assert source.count(anchor)==1
        audit='''        if [kAXValueAttribute, kAXSelectedTextAttribute, kAXSelectedTextRangeAttribute].contains(name),
           NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.djl.history-fixture" {
            var identifier: CFTypeRef?
            _ = AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &identifier)
            let known = ["fixture-editor", "api-key", "fixture-associated", "fixture-associated-descendant", "fixture-associated-subtree", "fixture-associated-linked-label", "fixture-cycle-label", "password", "fixture-second"]
            let label = identifier as? String ?? ""
            if let root = boundRoot {
                var title: CFTypeRef?
                if AXUIElementCopyAttributeValue(root, kAXTitleAttribute as CFString, &title) == .success,
                   title as? String == "Private Window" { fputs("fixture-read-under-private-title \\(name)\\n", stderr) }
            }
            fputs("fixture-read-attempt \\(name) \\(known.contains(label) ? label : "other")\\n", stderr)
        }
'''
        source=source.replace(anchor,audit+anchor)
        associationAnchor='            if linkedInfo.0 != "AXStaticText" {'
        associationAudit="""            if linkedInfo.0 != "AXStaticText" {
                let known = linkedInfo.0.range(of: "^AX[A-Za-z]{1,48}$", options: .regularExpression) != nil ? linkedInfo.0 : "unrecognized"
                fputs("fixture-association excluded-role=\\(known)\\n", stderr)
"""
        assert source.count(associationAnchor)==1
        source=source.replace(associationAnchor,associationAudit)
        scopeAnchor='            if excluded { excludedPaths.insert(node.path) }'
        scopeAudit="""            if excluded {
                let knownIDs = ["fixture-associated", "fixture-associated-subtree", "fixture-associated-descendant", "fixture-associated-linked-label", "password"]
                let identifier = read(node.element, kAXIdentifierAttribute).1 as? String ?? ""
                if knownIDs.contains(identifier) {
                    let parent = element(read(node.element, kAXParentAttribute).1)
                    let parentID = parent.flatMap { read($0, kAXIdentifierAttribute).1 as? String } ?? ""
                    fputs("fixture-excluded-scope id=\\(identifier) parent=\\(knownIDs.contains(parentID) ? parentID : "other") path=\\(node.path)\\n", stderr)
                }
            }
"""
        assert source.count(scopeAnchor)==1
        source=source.replace(scopeAnchor,scopeAudit+scopeAnchor)
        source=source.replace('        privacyAuthorized = true', '        privacyAuthorized = true\n        fputs("fixture-private-proof-complete\\n", stderr)')
        source=source.replace('            fputs("fixture-read-attempt', '            if !privacyAuthorized { fputs("fixture-read-before-private-proof\\n", stderr) }\n            fputs("fixture-read-attempt')
        source=source.replace('            dropped = min(1_000_000_000, dropped + 1)', '            dropped = min(1_000_000_000, dropped + 1)\n            fputs("fixture-drop-count \\(dropped)\\n", stderr)')
        tapAnchor='        let point = event.location'
        tapAudit="""        fputs("fixture-input-metadata type=\\(type.rawValue) at=\\(Date().timeIntervalSince1970) window51=\\(event.getIntegerValueField(CGEventField(rawValue: 51)!)) window91=\\(event.getIntegerValueField(.mouseEventWindowUnderMousePointer)) window92=\\(event.getIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent))\\n", stderr)
"""
        assert source.count(tapAnchor)==1
        source=source.replace(tapAnchor,tapAudit+tapAnchor)
        source=source.replace('        guard proof.budget.enter(key) else { return .denied }', '        guard proof.budget.enter(key) else { let role = metadata(element)?.0 ?? "unknown"; fputs("fixture-proof-entry-denied role=\\(HistorySecurity.ordinaryRoles.contains(role) ? role : "unknown")\\n", stderr); return .denied }')
        source=source.replace('        guard currentPrivacy(), path(attachment.root, to: attachment.root), path(focused, to: attachment.root) else { return nil }', '        guard currentPrivacy() else { fputs("fixture-admission private-witness\\n", stderr); return nil }\n        guard path(attachment.root, to: attachment.root) else { fputs("fixture-admission root-label-proof\\n", stderr); return nil }\n        guard path(focused, to: attachment.root) else { fputs("fixture-admission focused-label-proof\\n", stderr); return nil }')
        ageAnchor='        for input in inputs {'
        ageAudit="""        for sample in inputs { fputs("fixture-input-age type=\\(sample.type.rawValue) age=\\(Date().timeIntervalSince(sample.at))\\n", stderr) }
"""
        assert source.count(ageAnchor)==1
        source=source.replace(ageAnchor,ageAudit+ageAnchor)

    (out/path.name).write_text(source)
app=out/'DJL Computer Use.app';binary=app/'Contents/MacOS/DJLComputerUse';binary.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(base/'Info.plist',app/'Contents/Info.plist')
subprocess.run(['xcrun','swiftc','-swift-version','5','-O','-module-cache-path','/private/tmp/djl-cua-history-inert/module-cache',
 *[str(p) for p in sorted(out.glob('*.swift'))],'-framework','AppKit','-framework','ApplicationServices','-framework','CoreGraphics','-framework','ScreenCaptureKit','-o',str(binary)],check=True)
subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
print(binary)
