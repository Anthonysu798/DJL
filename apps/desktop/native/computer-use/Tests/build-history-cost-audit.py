#!/usr/bin/env python3
"""Finite source-copy cost measurement; never runs the helper or changes product Sources."""
from pathlib import Path
import hashlib,json,difflib,shutil,subprocess,re
base=Path(__file__).resolve().parents[1];out=Path('/private/tmp/djl-cua-history-cost');out.mkdir(exist_ok=True)
patch=[];hashes={}
for p in sorted((base/'Sources').glob('*.swift')):
    original=p.read_text();source=original
    if p.name=='InteractionHistory.swift':
        a=source.index('private final class HistoryReader {');b=source.index('\nfinal class InteractionHistory {',a)
        before,reader,after=source[:a],source[a:b],source[b:]
        def r(old,new,count=1):
            global reader
            assert reader.count(old)==count,(old,reader.count(old));reader=reader.replace(old,new)
        r('    let deadline = DispatchTime.now().uptimeNanoseconds + 750_000_000','    let deadline = DispatchTime.now().uptimeNanoseconds + 750_000_000\n    let costs = HistoryCostReader()')
        r('self.lease = lease; self.pid = pid; self.identity = identity }','self.lease = lease; self.pid = pid; self.identity = identity; costs.bind(deadline) }\n    deinit { costs.finish(visits: structuralVisits) }')
        for signature,kind in [('func valid() -> Bool {','valid'),('func owned(_ attachment: HistoryAttachment) -> Bool {','owned'),('private func currentPolicy() throws -> Bool {','policy'),('private func structuralAncestry(_ element: AXUIElement, to root: AXUIElement, nativeOnly: Bool = false) -> [AXUIElement]? {','ancestry'),('private func collectLabels(_ element: AXUIElement, proof: HistoryLabelProof) throws -> HistoryLabelAssessment {','labels')]:
            r(signature,signature+f'\n        let costStart = DispatchTime.now().uptimeNanoseconds; defer {{ costs.inclusive(.{kind}, from: costStart) }}')
        r('LiveForeground.pid()', '(self.costs.measure(.foreground) { LiveForeground.pid() })',3)
        r('(try? ProcessIdentity(pid))','(try? self.costs.measure(.identity) { try ProcessIdentity(pid) })')
        r('HistorySecureInput.enabled()', '(self.costs.measure(.secure) { HistorySecureInput.enabled() })',4)
        r('AXIsProcessTrusted()', '(self.costs.measure(.trust) { AXIsProcessTrusted() })')
        r('CGSessionCopyCurrentDictionary()', '(self.costs.measure(.session) { CGSessionCopyCurrentDictionary() })')
        r('AXUIElementCreateApplication(pid)', '(self.costs.measure(.appReference) { AXUIElementCreateApplication(pid) })',2)
        calls=[('AXUIElementSetMessagingTimeout(application, 0.05)', 'timeout'),('AXUIElementSetMessagingTimeout(element, 0.05)', 'timeout'),
               ('AXUIElementGetPid(element, &owner)', 'pid'),('AXUIElementGetPid(boundFocused, &oldPID)', 'pid'),('AXUIElementGetPid(current, &newPID)', 'pid')]
        for call,kind in calls:
            count={'AXUIElementSetMessagingTimeout(element, 0.05)':2,'AXUIElementGetPid(element, &owner)':2}.get(call,1)
            r(call,f'(self.costs.ax(.{kind}) {{ {call} }})',count)
        r('AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &focused)', '(self.costs.ax(.guardWindow) { AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &focused) })')
        r('AXUIElementCopyAttributeValue(element, name as CFString, &value)', '(self.costs.ax(HistoryCostLeaf.attribute(name)) { AXUIElementCopyAttributeValue(element, name as CFString, &value) })')
        r('AXUIElementCopyMultipleAttributeValues(element, names as CFArray, [], &values)', '(self.costs.ax(group == .structural ? .structuralBatch : .privacyBatch) { AXUIElementCopyMultipleAttributeValues(element, names as CFArray, [], &values) })')
        r('AXUIElementGetAttributeValueCount(node, kAXChildrenAttribute as CFString, &count)', '(self.costs.ax(.childrenCount) { AXUIElementGetAttributeValueCount(node, kAXChildrenAttribute as CFString, &count) })')
        r('AXUIElementCopyAttributeValues(node, kAXChildrenAttribute as CFString, 0, count, &children)', '(self.costs.ax(.childrenArray) { AXUIElementCopyAttributeValues(node, kAXChildrenAttribute as CFString, 0, count, &children) })')
        r('        HistoryMetadata.read(group, current: {','        var bulkNotImplemented = false\n        let measuredResult = HistoryMetadata.read(group, current: {')
        r('            return (error, values)','            bulkNotImplemented = error == .notImplemented\n            return (error, values)')
        r('        }, scalar: { self.read(element, $0) })','        }, scalar: { name in\n            self.costs.fallback(group, name: name, notImplemented: bulkNotImplemented)\n            return self.read(element, name)\n        }, decoded: { index, error in self.costs.decoded(group, index: index, error: error) })\n        return measuredResult')
        r('        if own.descriptionFailed && !structuralPath(element, to: root, nativeOnly: true) { return .denied }','        if own.descriptionFailed { costs.descriptionNativePaths += 1 }\n        if own.descriptionFailed && !structuralPath(element, to: root, nativeOnly: true) { return .denied }')
        r('        defer { recoveryArmed = false }','        costs.phase(.binding); costs.preflightStart = DispatchTime.now().uptimeNanoseconds\n        defer { costs.preflightEnd = DispatchTime.now().uptimeNanoseconds }\n        defer { recoveryArmed = false }')
        r('        while index < queue.count {','        costs.phase(.scan)\n        while index < queue.count {')
        r('        // An embedded web area\'s own explicit false', '        costs.phase(.initialProofs)\n        // An embedded web area\'s own explicit false')
        r('        guard let nodes = try classify(structuralNodes) else { return nil }','        costs.phase(.classification)\n        guard let nodes = try classify(structuralNodes) else { return nil }')
        r('        return .context(nodes, web, domains.sorted().first)','        costs.preflightReturned = true\n        return .context(nodes, web, domains.sorted().first)')
        r('if let input = navigationInput { recoveryArmed = false; return .navigation(input) }','if let input = navigationInput { recoveryArmed = false; costs.preflightReturned = true; return .navigation(input) }',3)
        source=before+reader+after
        def s(old,new,count=1):
            global source
            assert source.count(old)==count,(old,source.count(old));source=source.replace(old,new)
        s('            else { owner.inputs.append(sample) }\n            owner.changed = true','            else { owner.inputs.append(sample) }\n            owner.changed = true\n            if type == .keyDown && sample.key == 124 { HistoryCostOutput.arm(key: sample.key, window: sample.window, attachmentWindow: owner.windowID, sequence: sample.sequence, queue: owner.inputs.count, lost: owner.lost, flags: sample.flags.rawValue) }')
        s('        writer?.close()','        writer?.close()\n        HistoryCostOutput.footer()')
        s('        let reader = HistoryReader(lease: lease, pid: pid, identity: identity)','        let reader = HistoryReader(lease: lease, pid: pid, identity: identity)\n        reader.costs.purpose = .attach')
        s('            let reader = HistoryReader(lease: lease, pid: value.pid, identity: value.identity)','            let reader = HistoryReader(lease: lease, pid: value.pid, identity: value.identity)\n            reader.costs.purpose = .ownership')
        old='            guard let result = try reader.preflight(current, allowFocusRecovery: true, allowNavigation: true) else { clearAttachment(current); return }'
        s(old,'            guard let result = try reader.preflight(current, allowFocusRecovery: true, allowNavigation: true) else { reader.costs.result = .preflightDenied; clearAttachment(current); return }')
        s('            case .context(let nodes, let web, let domain):','            case .context(let nodes, let web, let domain):\n                reader.costs.preflightReturned = true; reader.costs.phase(.postPreflightOwned)')
        s('                guard reader.owned(current) else { clearAttachment(current); return }','                guard reader.owned(current) else { reader.costs.result = .ownedDenied; clearAttachment(current); return }')
        s('            case .navigation(let input): recordNavigation(input, reader: reader, attachment: current); return','            case .navigation(let input):\n                reader.costs.preflightReturned = true; reader.costs.phase(.navigation); reader.costs.result = .navigation\n                recordNavigation(input, reader: reader, attachment: current); return')
        s('            recoverTab(change.recovery, reader: reader, attachment: current); return','            reader.costs.result = .recovery\n            recoverTab(change.recovery, reader: reader, attachment: current); return')
        s('        } catch { clearAttachment(current); return }','        } catch { reader.costs.result = .genericError; clearAttachment(current); return }')
        s('        let (nodes, web, domain) = snapshot','        reader.costs.phase(.titlePrivacy)\n        let (nodes, web, domain) = snapshot')
        s('guard let title = nodes.first(where: { $0.path == "0" })?.title, reader.owned(current), reader.contentPermitted() else { return }','guard let title = nodes.first(where: { $0.path == "0" })?.title, reader.owned(current), reader.contentPermitted() else { reader.costs.result = .titlePrivacyDenied; return }')
        s('        let (inputs, changed, valueChanged, selectionChanged, lost) = current.take()','        reader.costs.phase(.drain)\n        let (inputs, changed, valueChanged, selectionChanged, lost) = current.take()\n        reader.costs.drained = true; reader.costs.phase(.ordinary)')
        s('        var lines: [String] = [], size = 0','        reader.costs.phase(.projection)\n        var lines: [String] = [], size = 0')
        s('        guard reader.owned(current), reader.contentPermitted(), let frame = current.baseline.prepare(lines) else { return }','        reader.costs.phase(.final)\n        guard reader.owned(current), reader.contentPermitted(), let frame = current.baseline.prepare(lines) else { reader.costs.result = .finalCompositeNoFrame; return }')
        s('        emit(event, attachment: current, frame: frame)','        emit(event, attachment: current, frame: frame)\n        reader.costs.result = .submitted')
    if p.name=='InteractionHistoryMetadata.swift':
        def m(old,new):
            global source
            assert source.count(old)==1,(old,source.count(old));source=source.replace(old,new)
        m('bulk: ([String]) -> (AXError, CFArray?), scalar: (String) -> Result) -> [Result]?', 'bulk: ([String]) -> (AXError, CFArray?), scalar: (String) -> Result, decoded: (Int, AXError) -> Void) -> [Result]?')
        m('            let result = scalar(names[index])','            let result = scalar(names[index])\n            decoded(index, result.0)')
        m('                result = (slotError, nil)','                result = (slotError, nil)\n                decoded(index, slotError)')
        m('            } else { result = (.success, value) }','            } else { result = (.success, value); decoded(index, .success) }')
    (out/p.name).write_text(source)
    hashes[p.name]={'original':hashlib.sha256(original.encode()).hexdigest(),'generated':hashlib.sha256(source.encode()).hexdigest()}
    patch.extend(difflib.unified_diff(original.splitlines(True),source.splitlines(True),fromfile='Sources/'+p.name,tofile='cost/'+p.name))
audit=(base/'Tests/HistoryCostAudit.swift').read_text();(out/'HistoryCostAudit.swift').write_text(audit)
hashes['HistoryCostAudit.swift']={'testSource':hashlib.sha256(audit.encode()).hexdigest()}
patch.extend(difflib.unified_diff([],audit.splitlines(True),fromfile='/dev/null',tofile='cost/HistoryCostAudit.swift'))
(out/'source.patch').write_text(''.join(patch));(out/'hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
original=(base/'Tests/native-history-fixture-e2e.mjs').read_text();old='/private/tmp/djl-cua-history-build/';assert original.count(old)==1
harness=original.replace(old,str(out)+'/');(out/'normal-cost.mjs').write_text(harness)
(out/'harness.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),harness.splitlines(True),fromfile='Tests/native-history-fixture-e2e.mjs',tofile='normal-cost.mjs')))
(out/'harness-hashes.json').write_text(json.dumps({'original':hashlib.sha256(original.encode()).hexdigest(),'generated':hashlib.sha256(harness.encode()).hexdigest()})+'\n')
app=out/'DJL Computer Use.app';binary=app/'Contents/MacOS/DJLComputerUse';binary.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(base/'Info.plist',app/'Contents/Info.plist')
command=['xcrun','swiftc','-swift-version','5','-O','-module-cache-path',str(base/'.build/module-cache'),*[str(p) for p in sorted(out.glob('*.swift'))],'-framework','AppKit','-framework','ApplicationServices','-framework','CoreGraphics','-framework','ScreenCaptureKit','-o',str(binary)]
(out/'build-command.json').write_text(json.dumps(command)+'\n')
result=subprocess.run(command,capture_output=True,text=True);(out/'build.txt').write_text(result.stdout+result.stderr)
if result.returncode:print(result.stdout+result.stderr);raise SystemExit(result.returncode)
subprocess.run(['codesign','--force','--sign','-',str(app)],check=True);print(out)
