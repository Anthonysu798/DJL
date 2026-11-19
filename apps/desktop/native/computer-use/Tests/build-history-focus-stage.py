#!/usr/bin/env python3
"""Build-only controlled owned-fixture stage. Original authority/deadline remain active."""
from pathlib import Path
import difflib, hashlib, json, shutil, subprocess, sys
base = Path(__file__).resolve().parents[1]
audit = '--audit' in sys.argv
out = Path('/private/tmp/djl-cua-focus-stage-audit' if audit else '/private/tmp/djl-cua-focus-stage-normal')
out.mkdir(exist_ok=True)
patches, hashes = [], {}
for path in sorted((base / 'Sources').glob('*.swift')):
    original = path.read_text(); source = original
    def insert(anchor, replacement, expected=1):
        global source
        assert source.count(anchor) == expected, anchor
        source = source.replace(anchor, replacement)
    if path.name == 'InteractionHistory.swift':
        anchor = '                owner.latestFocusNotice = HistoryFocusNotice(generation: owner.focusGeneration, sequence: owner.inputSequence, subject: HistoryElementKey(element: element))'
        insert(anchor, anchor + '\n                fputs("fixture-stage-callback generation=\\(owner.focusGeneration) sequence=\\(owner.inputSequence) root=\\(CFEqual(element, owner.root) ? 1 : 0) app=\\(CFEqual(element, owner.axApp) ? 1 : 0)\\n", stderr)')
        anchor = '        current?.stop()'
        insert(anchor, anchor + '\n        if HistoryFixtureStage.used { HistoryFixtureStage.phase = "retired"; fputs("fixture-stage-retired\\n", stderr) }')
        anchor = '        recoveryArmed = allowFocusRecovery && recoveryBinding != nil'
        insert(anchor, anchor + '\n        if recoveryArmed { HistoryFixtureStage.synchronize(self, attachment) }')
        anchor = '                      candidateNodes.contains(where: { CFEqual($0.element, current) }) else { return false }'
        insert(anchor, '                      candidateNodes.contains(where: { CFEqual($0.element, current) }) else {\n                    if HistoryFixtureStage.used {\n                        fputs("fixture-stage-denied candidate armed=\\(recoveryArmed ? 1 : 0) old=\\(candidateNodes.contains(where: { CFEqual($0.element, boundFocused) }) ? 1 : 0) new=\\(candidateNodes.contains(where: { CFEqual($0.element, current) }) ? 1 : 0)\\n", stderr)\n                    }\n                    return false\n                }')
        anchor = '                      AXUIElementGetPid(current, &newPID) == .success, newPID == pid, valid() else { return false }'
        insert(anchor, '                      AXUIElementGetPid(current, &newPID) == .success, newPID == pid, valid() else {\n                    if HistoryFixtureStage.used { fputs("fixture-stage-denied owner old=\\(oldPID) new=\\(newPID) expected=\\(pid)\\n", stderr) }\n                    return false\n                }')
        anchor = '                    deadline: deadline, now: DispatchTime.now().uptimeNanoseconds, visits: structuralVisits, completedScan: !candidateNodes.isEmpty, titleAdmitted: true) else { return false }'
        insert(anchor, '                    deadline: deadline, now: DispatchTime.now().uptimeNanoseconds, visits: structuralVisits, completedScan: !candidateNodes.isEmpty, titleAdmitted: true) else {\n                    if HistoryFixtureStage.used {\n                        let subjectNew = end.subject.map { CFEqual($0.element, current) } ?? false\n                        let subjectApp = end.subject.map { CFEqual($0.element, attachment.axApp) } ?? false\n                        let subjectRoot = end.subject.map { CFEqual($0.element, attachment.root) } ?? false\n                        fputs("fixture-stage-denied constructor startSeq=\\(start.sequence) beforeSeq=\\(before.sequence) endSeq=\\(end.sequence) startGen=\\(start.generation) beforeGen=\\(before.generation) endGen=\\(end.generation) subjectNew=\\(subjectNew ? 1 : 0) subjectApp=\\(subjectApp ? 1 : 0) subjectRoot=\\(subjectRoot ? 1 : 0) startOverflow=\\(start.overflow) endOverflow=\\(end.overflow) endLost=\\(end.lost ? 1 : 0) startWindow=\\(start.windowGeneration) endWindow=\\(end.windowGeneration)\\n", stderr)\n                        attachment.fixtureSubjectTrace(old: boundFocused, new: current)\n                        HistoryFixtureStage.trace("constructor-denied", deadline: deadline, visits: structuralVisits)\n                    }\n                    return false\n                }')
        anchor = '                throw HistoryFocusChange(recovery: recovery)'
        insert(anchor, '                attachment.fixtureSubjectTrace(old: boundFocused, new: current)\n                HistoryFixtureStage.trace("mismatch", deadline: deadline, visits: structuralVisits)\n' + anchor)
        anchor = '        guard !continuationUsed else { return nil }; continuationUsed = true; recoveryArmed = false'
        insert(anchor, anchor + '\n        HistoryFixtureStage.phase = "recover"; HistoryFixtureStage.trace("consumed", deadline: deadline, visits: structuralVisits)')
        anchor = '            CGEvent.tapEnable(tap: input, enable: true)'
        insert(anchor, anchor + '\n            fputs("fixture-stage-tap-ready pid=\\(pid) window=\\(windowID) valid=\\(CFMachPortIsValid(input) ? 1 : 0) enabled=\\(CGEvent.tapIsEnabled(tap: input) ? 1 : 0)\\n", stderr)')
        anchor = '    private func recoverTab(_ recovery: HistoryTabRecovery<HistoryElementKey>, reader: HistoryReader, attachment: HistoryAttachment) {'
        insert(anchor, anchor + '\n        defer { HistoryFixtureStage.phase = "idle" }')
        anchor = '            owner.inputSequence += 1; sample.sequence = owner.inputSequence'
        insert(anchor, anchor + '\n            fputs("fixture-stage-input sequence=\\(owner.inputSequence) key=\\(sample.key) ns=\\(DispatchTime.now().uptimeNanoseconds)\\n", stderr)')
        anchor = '        let outcome = attachment.commitTab(recovery, writer: writer, record: record)'
        insert(anchor, anchor + '\n        HistoryFixtureStage.trace(outcome.accepted ? "accepted" : "rejected", deadline: reader.deadline, visits: recovery.visits)')
        anchor = '        attachment.previousValueRead = nil; attachment.previousSelection = nil'
        insert(anchor, anchor + '\n        HistoryFixtureStage.phase = "complete"; HistoryFixtureStage.trace("reset", deadline: reader.deadline, visits: recovery.visits)')
        anchor = '    private func emit(_ record: Object, attachment: HistoryAttachment, frame: HistoryContinuity.Frame? = nil) {'
        insert(anchor, anchor + '\n        if HistoryFixtureStage.phase == "recover" { fputs("fixture-stage-forbidden emit\\n", stderr) }')
        if audit:
            anchor = '        let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)'
            insert(anchor, '''        if HistoryFixtureStage.readerID == ObjectIdentifier(self), ["stage", "recover"].contains(HistoryFixtureStage.phase), [kAXValueAttribute, kAXSelectedTextAttribute, kAXSelectedTextRangeAttribute].contains(name) {
            let role = candidateNodes.first(where: { CFEqual($0.element, element) })?.role ?? ""
            let editable = HistorySecurity.textRoles.contains(role)
            fputs("fixture-stage-read editable=\\(editable ? 1 : 0) attribute=\\(name)\\n", stderr)
        }
''' + anchor)
        source += '''
private extension HistoryAttachment {
    func fixtureSubjectTrace(old: AXUIElement, new: AXUIElement) {
        let stamp = focusStamp()
        for fact in [stamp.previousNotice, stamp.latestNotice].compactMap({ $0 }) {
            let generation = fact.generation, sequence = fact.sequence, subject = fact.subject
            fputs("fixture-stage-subject generation=\\(generation) sequence=\\(sequence) old=\\(CFEqual(subject.element, old) ? 1 : 0) new=\\(CFEqual(subject.element, new) ? 1 : 0) app=\\(CFEqual(subject.element, axApp) ? 1 : 0) root=\\(CFEqual(subject.element, root) ? 1 : 0) overflow=\\(stamp.overflow)\\n", stderr)
        }
    }
}
// This synchronization exists only in the separately signed disposable test copy.
private extension HistoryReader { var stageVisits: Int { structuralVisits } }
private enum HistoryFixtureStage {
    static var used = false, phase = "idle"
    static var readerID: ObjectIdentifier?
    static func trace(_ event: String, deadline: UInt64, visits: Int) {
        guard used else { return }
        let now = DispatchTime.now().uptimeNanoseconds
        let remaining = now < deadline ? deadline - now : 0
        fputs("fixture-stage {\\"event\\":\\"\\(event)\\",\\"remainingNs\\":\\(remaining),\\"elapsedNs\\":\\(now - (deadline - 750_000_000)),\\"visits\\":\\(visits)}\\n", stderr)
    }
    static func synchronize(_ reader: HistoryReader, _ attachment: HistoryAttachment) {
        guard !used, attachment.app.bundleIdentifier == "com.djl.history-fixture",
              let data = try? Data(contentsOf: URL(fileURLWithPath: "/private/tmp/djl-cua-focus-stage-arm.json")),
              let command = (try? JSONSerialization.jsonObject(with: data)) as? Object,
              command["pid"] as? Int32 == attachment.pid, command["window"] as? UInt32 == attachment.windowID,
              command["epoch"] as? String == attachment.lease.epoch else { return }
        guard attachment.valid, reader.valid() else { return }
        used = true; phase = "stage"; readerID = ObjectIdentifier(reader)
        let before = attachment.focusStamp(), start = DispatchTime.now().uptimeNanoseconds
        let limit = min(reader.deadline, start + 100_000_000)
        trace("pre-valid", deadline: reader.deadline, visits: reader.stageVisits)
        trace("ready", deadline: reader.deadline, visits: reader.stageVisits)
        while DispatchTime.now().uptimeNanoseconds < limit, attachment.valid,
              LiveForeground.pid() == attachment.pid, (try? ProcessIdentity(attachment.pid)) == attachment.identity,
              HistorySecureInput.enabled() == false, AXIsProcessTrusted() {
            let current = attachment.focusStamp()
            if current.windowGeneration != before.windowGeneration || current.lost || current.overflow != before.overflow { break }
            if current.sequence > before.sequence && current.generation > before.generation { break }
            let now = DispatchTime.now().uptimeNanoseconds
            if now >= limit || limit - now <= 2_000_000 { break }
            Thread.sleep(forTimeInterval: 0.001)
        }
        let waited = DispatchTime.now().uptimeNanoseconds - start
        let after = attachment.focusStamp()
        let afterValid = reader.valid() // No new eligibility; all original preflight guards follow.
        trace(afterValid ? "post-valid" : "post-invalid", deadline: reader.deadline, visits: reader.stageVisits)
        fputs("fixture-stage {\\"event\\":\\"wait-end\\",\\"inputDelta\\":\\(after.sequence - before.sequence),\\"focusDelta\\":\\(after.generation - before.generation),\\"waitNs\\":\\(waited)}\\n", stderr)
        trace("stage-end", deadline: reader.deadline, visits: reader.stageVisits)
    }
}
'''
    if path.name == 'InteractionHistoryCore.swift':
        anchor = '    func prepare(_ lines: [String]) -> Frame? {'
        insert(anchor, anchor + '\n        if HistoryFixtureStage.phase == "recover" { fputs("fixture-stage-forbidden continuity\\n", stderr) }')
    # Only this test module needs the numeric tracer visible to Core.
    if path.name == 'InteractionHistory.swift': source = source.replace('private enum HistoryFixtureStage {', 'enum HistoryFixtureStage {').replace('    static func synchronize(_ reader:', '    fileprivate static func synchronize(_ reader:')
    (out / path.name).write_text(source)
    hashes[path.name] = {'original': hashlib.sha256(original.encode()).hexdigest(), 'instrumented': hashlib.sha256(source.encode()).hexdigest()}
    patches += list(difflib.unified_diff(original.splitlines(True), source.splitlines(True), fromfile='Sources/' + path.name, tofile='stage/' + path.name))
(out / 'stage.patch').write_text(''.join(patches)); (out / 'hashes.json').write_text(json.dumps(hashes, indent=2)+'\n')
app = out / 'DJL Computer Use.app'; binary = app / 'Contents/MacOS/DJLComputerUse'; binary.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(base / 'Info.plist', app / 'Contents/Info.plist')
command = ['xcrun','swiftc','-swift-version','5','-O','-module-cache-path',str(base / '.build/module-cache'),*[str(p) for p in sorted(out.glob('*.swift'))],'-framework','AppKit','-framework','ApplicationServices','-framework','CoreGraphics','-framework','ScreenCaptureKit','-o',str(binary)]
(out / 'build-command.json').write_text(json.dumps(command)+'\n'); subprocess.run(command, check=True)
subprocess.run(['codesign','--force','--sign','-',str(app)], check=True)
print(binary)

# A separately compiled, prestarted driver accepts exactly one known Tab command.
original = (base / 'Tests/HistoryInputDriver.swift').read_text()
driver = original.replace('let point = CGPoint(x: bounds.minX + 60, y: bounds.maxY - 25)', 'let point = CGPoint(x: bounds.minX + 60, y: bounds.maxY - 25)\nguard args[3] == "tab" else { abort() }\nprint("fixture-driver-ready"); fflush(stdout)\nguard readLine() == "dispatch-tab" else { abort() }\nfputs("fixture-driver-go \\(DispatchTime.now().uptimeNanoseconds)\\n", stderr)')
anchor = '    event.postToPid(pid)'
assert driver.count(anchor) == 1
driver = driver.replace(anchor, '    guard let fresh = NSRunningApplication(processIdentifier: pid), fresh.bundleIdentifier == "com.djl.history-fixture",\n          fresh.executableURL?.resolvingSymlinksInPath() == URL(fileURLWithPath: "/private/tmp/djl-cua-history-fixture/History Fixture.app/Contents/MacOS/HistoryFixture").resolvingSymlinksInPath(),\n          (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []).contains(where: { $0[kCGWindowOwnerPID as String] as? Int32 == pid && $0[kCGWindowNumber as String] as? UInt32 == windowID }) else { abort() }\n    fputs("fixture-driver-post type=\\(event.type.rawValue) ns=\\(DispatchTime.now().uptimeNanoseconds)\\n", stderr)\n    event.postToPid(pid)')
(out / 'driver').mkdir(exist_ok=True); (out / 'driver/main.swift').write_text(driver)
(out / 'driver.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True), driver.splitlines(True), fromfile='Tests/HistoryInputDriver.swift', tofile='stage/driver/main.swift')))
(out / 'driver-hashes.json').write_text(json.dumps({'original': hashlib.sha256(original.encode()).hexdigest(), 'instrumented': hashlib.sha256(driver.encode()).hexdigest()})+'\n')
subprocess.run(['xcrun','swiftc','-swift-version','5','-module-cache-path',str(base / '.build/module-cache'),str(base / 'Sources/LiveForeground.swift'),str(out / 'driver/main.swift'),'-framework','AppKit','-framework','CoreGraphics','-framework','ApplicationServices','-o',str(out / 'staged-tab-driver')],check=True)
