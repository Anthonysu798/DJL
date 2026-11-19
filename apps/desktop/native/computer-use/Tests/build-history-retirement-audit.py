#!/usr/bin/env python3
"""Build-only finite post-decision traces for owned main-window continuity diagnosis."""
from pathlib import Path
import hashlib, json, difflib, shutil, subprocess, sys
base=Path(__file__).resolve().parents[1]
staged='--stage-audit' in sys.argv
normal_key='--normal-key' in sys.argv
assert not (staged and normal_key)
inputs=Path('/private/tmp/djl-cua-focus-stage-audit') if staged else base/'Sources'
out=Path('/private/tmp/djl-cua-normal-key-diagnostic' if normal_key else '/private/tmp/djl-cua-focus-stage-retirement' if staged else '/private/tmp/djl-cua-history-retirement-audit');out.mkdir(exist_ok=True)
patch=[];hashes={}
for p in sorted(inputs.glob('*.swift')):
    original=p.read_text();source=original
    def replace(old,new,count=1):
        global source
        assert source.count(old)==count,old
        source=source.replace(old,new)
    if p.name=='InteractionHistory.swift':
        replace('    private var privacyAuthorized = false','    private var privacyAuthorized = false\n    private var expiryReported = false')
        old='              session["CGSSessionScreenIsLocked"] as? Bool != true, session["kCGSessionOnConsoleKey"] as? Bool != false else { return false }'
        replace(old,'''              session["CGSSessionScreenIsLocked"] as? Bool != true, session["kCGSessionOnConsoleKey"] as? Bool != false else {
            if !expiryReported { expiryReported = true; HistoryRetirementAudit.trace("valid-denied", deadline: deadline) }
            return false
        }''')
        replace('        current?.stop()','        current?.stop()\n        HistoryRetirementAudit.trace("attachment-retired")')
        replace('            if !reader.owned(value) { clearAttachment(value); current = nil }','            if !reader.owned(value) { HistoryRetirementAudit.trace("tick-ownership-denied", deadline: reader.deadline); clearAttachment(value); current = nil }')
        replace('            guard let result = try reader.preflight(current, allowFocusRecovery: true, allowNavigation: true) else { clearAttachment(current); return }','            guard let result = try reader.preflight(current, allowFocusRecovery: true, allowNavigation: true) else { HistoryRetirementAudit.trace("tick-preflight-denied", deadline: reader.deadline); clearAttachment(current); return }')
        replace('                guard reader.owned(current) else { clearAttachment(current); return }','                guard reader.owned(current) else { HistoryRetirementAudit.trace("tick-context-owned-denied", deadline: reader.deadline); clearAttachment(current); return }')
        replace('                snapshot = (nodes, web, domain)','                snapshot = (nodes, web, domain)\n                HistoryRetirementAudit.trace("context-preflight-complete", deadline: reader.deadline)')
        replace('            case .navigation(let input): recordNavigation(input, reader: reader, attachment: current); return','            case .navigation(let input):\n                HistoryRetirementAudit.trace("navigation-selected", deadline: reader.deadline)\n                recordNavigation(input, reader: reader, attachment: current); return')
        replace('        guard let proof = try? reader.navigation(attachment) else { clearAttachment(attachment); return }','        guard let proof = try? reader.navigation(attachment) else { HistoryRetirementAudit.trace("navigation-proof-denied", deadline: reader.deadline); clearAttachment(attachment); return }')
        navigation_commit='        let result = attachment.commitNavigation(proof.0, binding: proof.1, time: proof.2, writer: writer, record: record)'
        replace(navigation_commit,navigation_commit+'\n        HistoryRetirementAudit.trace(result.accepted ? "navigation-admitted" : result.state == .queueChanged ? "navigation-queue-only" : "navigation-rejected", deadline: reader.deadline)')
        replace('            recoverTab(change.recovery, reader: reader, attachment: current); return','            HistoryRetirementAudit.trace("typed-tab", deadline: reader.deadline)\n            recoverTab(change.recovery, reader: reader, attachment: current); return')
        replace('        } catch { clearAttachment(current); return }','        } catch { HistoryRetirementAudit.trace("tick-generic-error", deadline: reader.deadline); clearAttachment(current); return }')
        replace('        attachment.baseline.lost()','        attachment.baseline.lost()\n        HistoryRetirementAudit.trace(recordDropped ? "lose-record" : "lose-numeric-no-record-count")')
        replace('        if lost { current.gesture.discard(); lose(current, recordDropped: false) }','        if lost { current.gesture.discard(); lose(current, recordDropped: false); HistoryRetirementAudit.trace("numeric-queue-overflow") }')
        replace('                current.gesture.discard(); lose(current, recordDropped: false); continue','                current.gesture.discard(); lose(current, recordDropped: false); HistoryRetirementAudit.trace("numeric-age-expired"); continue')
        replace('            guard size + line.utf16.count + 1 <= 16_384 else { current.baseline.lost(); return }','            guard size + line.utf16.count + 1 <= 16_384 else { current.baseline.lost(); HistoryRetirementAudit.trace("projection-size-overflow"); return }')
        replace('if success && attachment.valid { attachment.baseline.written(frame) } else { attachment.baseline.rejected(frame) }','if success && attachment.valid { attachment.baseline.written(frame) } else { attachment.baseline.rejected(frame); HistoryRetirementAudit.trace("write-completion-rejected") }')
        replace('if !accepted { if let frame = frame { attachment.baseline.rejected(frame) }; lose(attachment) }','if !accepted { if let frame = frame { attachment.baseline.rejected(frame) }; lose(attachment); HistoryRetirementAudit.trace("enqueue-rejected") }')
        old='            guard let current = element(read(attachment.axApp, kAXFocusedUIElementAttribute).1), CFEqual(current, boundFocused) else { return false }'
        replace(old, '            let observed = element(read(attachment.axApp, kAXFocusedUIElementAttribute).1)\n            guard let current = observed, CFEqual(current, boundFocused) else {\n                let stamp = attachment.focusStamp()\n                HistoryRetirementAudit.trace("owned-focus-denied", deadline: deadline, detail: "present=\\(observed == nil ? 0 : 1) root=\\(observed.map { CFEqual($0, attachment.root) } == true ? 1 : 0) generation=\\(stamp.generation) sequence=\\(stamp.sequence)")\n                return false\n            }')
        # This is after the existing AX call/error decision; unsupported optional attributes are not logged.
        old='        return valid() ? (error, value) : (.cannotComplete, nil)'
        replace(old, '        if [.failure, .cannotComplete, .invalidUIElement].contains(error) { HistoryRetirementAudit.trace("ax-error", deadline: deadline, detail: "attribute=\\(name) error=\\(error.rawValue)") }\n        return valid() ? (error, value) : (.cannotComplete, nil)')
        old='            lock.withLock { loop = runLoop; tap = input; observer = ax }'
        replace(old,old+'\n            HistoryRetirementAudit.trace("attachment-tap-installed")')
        old='            if notification as String == kAXFocusedWindowChangedNotification { owner.windowGeneration += 1 }'
        # No callback trace: diagnostic state remains on the capture lane; existing stamp snapshots suffice.
        old='            recoverTab(change.recovery, reader: reader, attachment: current); return'
        # The earlier typed branch already has its trace; add the cached endpoint/callback facts there.
        source=source.replace('            HistoryRetirementAudit.trace("typed-tab", deadline: reader.deadline)', '            HistoryRetirementAudit.trace("typed-tab", deadline: reader.deadline, detail: "startGen=\\(change.recovery.start.generation) endGen=\\(change.recovery.end.generation) startSeq=\\(change.recovery.start.sequence) endSeq=\\(change.recovery.end.sequence)")')
        old=r'        lock.withLock { recovery.packet(inputs.map(\.tabPacket), stamp: stampLocked(), window: windowID, now: Date().timeIntervalSince1970, clock: clock, authorized: alive && lease.valid) }'
        replace(old, '        lock.withLock {\n            let result = recovery.packet(inputs.map(\\.tabPacket), stamp: stampLocked(), window: windowID, now: Date().timeIntervalSince1970, clock: clock, authorized: alive && lease.valid)\n            if result == nil { HistoryRetirementAudit.trace("recovery-packet-denied", deadline: recovery.deadline, detail: "keys=\\(inputs.map { String($0.key) }.joined(separator: ",")) generation=\\(focusGeneration) sequence=\\(inputSequence)") }\n            return result\n        }')
        source+='''
enum HistoryRetirementAudit {
    private static var count=0, armed=true
    private static let counterLock = NSLock()
    static func arm() { counterLock.withLock { armed = true } }
    static func trace(_ branch: String, deadline: UInt64? = nil, revision: UInt64? = nil, frameRevision: UInt64? = nil, detail: String = "") {
        let admitted = counterLock.withLock { () -> Bool in
            guard armed, count < 200 else { return false }; count += 1; return true
        }
        guard admitted else { return }
        let now = DispatchTime.now().uptimeNanoseconds
        let remaining = deadline.map { now < $0 ? $0-now : 0 } ?? 0
        let expired = deadline.map { now >= $0 } ?? false
        fputs("fixture-retirement branch=\\(branch) ns=\\(now) remainingNs=\\(remaining) expired=\\(expired ? 1 : 0) revision=\\(revision.map(String.init) ?? "none") frameRevision=\\(frameRevision.map(String.init) ?? "none") \\(detail)\\n", stderr)
    }
}
'''
    if p.name=='InteractionHistory.swift' and normal_key:
        replace('    private static var count=0, armed=true','    private static var count=0, armed=false')
        old='            else { owner.inputs.append(sample) }\n            owner.changed = true'
        replace(old,old+'\n            if type == .keyDown && sample.key == 124 {\n                HistoryRetirementAudit.arm()\n                HistoryRetirementAudit.trace("numeric-124-receipt", detail: "key=\\(sample.key) type=\\(sample.type.rawValue) window=\\(sample.window) attachmentWindow=\\(owner.windowID) sequence=\\(sample.sequence) queue=\\(owner.inputs.count) lost=\\(owner.lost ? 1 : 0) flags=\\(sample.flags.rawValue)")\n            }')
    if p.name=='InteractionHistoryCore.swift':
        replace('    func lost() { revision &+= 1; baseline = nil }','    func lost() { revision &+= 1; baseline = nil; HistoryRetirementAudit.trace("continuity-lost", revision: revision) }')
        replace('        pending = frame.id; return frame','        pending = frame.id; HistoryRetirementAudit.trace("continuity-prepare-" + frame.mode, revision: revision, frameRevision: frame.revision); return frame')
        replace('        if revision == frame.revision { baseline = frame.lines }','        if revision == frame.revision { baseline = frame.lines; HistoryRetirementAudit.trace("continuity-written", revision: revision, frameRevision: frame.revision) }')
        replace('        guard pending == frame.id else { return }','        guard pending == frame.id else { HistoryRetirementAudit.trace("write-stale-pending", revision: revision, frameRevision: frame.revision); return }')
        replace('    func rejected(_ frame: Frame) { if pending == frame.id { pending = nil }; lost() }','    func rejected(_ frame: Frame) { if pending == frame.id { pending = nil }; lost(); HistoryRetirementAudit.trace("continuity-rejected", revision: revision, frameRevision: frame.revision) }')
        replace('        guard text.utf16.count <= 16_384 else { lost(); return nil }','        guard text.utf16.count <= 16_384 else { lost(); HistoryRetirementAudit.trace("continuity-text-size-overflow", revision: revision); return nil }')
        replace('        guard pending == nil else { return nil }','        guard pending == nil else { HistoryRetirementAudit.trace("continuity-pending", revision: revision); return nil }')
    (out/p.name).write_text(source)
    hashes[p.name]={'original':hashlib.sha256(original.encode()).hexdigest(),'instrumented':hashlib.sha256(source.encode()).hexdigest()}
    patch.extend(difflib.unified_diff(original.splitlines(True),source.splitlines(True),fromfile='Sources/'+p.name,tofile='retirement/'+p.name))
(out/'source.patch').write_text(''.join(patch));(out/'hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
app=out/'DJL Computer Use.app';binary=app/'Contents/MacOS/DJLComputerUse';binary.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(base/'Info.plist',app/'Contents/Info.plist')
command=['xcrun','swiftc','-swift-version','5','-O','-module-cache-path',str(base/'.build/module-cache'),*[str(p) for p in sorted(out.glob('*.swift'))],'-framework','AppKit','-framework','ApplicationServices','-framework','CoreGraphics','-framework','ScreenCaptureKit','-o',str(binary)]
(out/'build-command.json').write_text(json.dumps(command)+'\n');subprocess.run(command,check=True);subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
if normal_key:
    original=(base/'Tests/native-history-fixture-e2e.mjs').read_text()
    old='/private/tmp/djl-cua-history-build/'
    assert original.count(old)==1
    harness=original.replace(old,str(out)+'/')
    (out/'normal-diagnostic.mjs').write_text(harness)
    (out/'harness.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),harness.splitlines(True),fromfile='Tests/native-history-fixture-e2e.mjs',tofile='normal-diagnostic.mjs')))
    (out/'harness-hashes.json').write_text(json.dumps({'original':hashlib.sha256(original.encode()).hexdigest(),'instrumented':hashlib.sha256(harness.encode()).hexdigest()})+'\n')
    print(out)
    sys.exit(0)
if staged:
    shutil.copy2(inputs/'staged-tab-driver',out/'staged-tab-driver')
    print(out)
    sys.exit(0)
# Preserve the compiled current host test's predicates, cadence and default manager spawn.
original=Path('/private/tmp/djl-history-host-e2e.mjs').read_text();host=original
old='/private/tmp/djl-cua-history-build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse';assert host.count(old)==1
host=host.replace(old,str(binary))
anchor='  const nativeRows = [];';assert host.count(anchor)==1
host=host.replace(anchor,anchor+'\n  checks.nativeDenials = [];\n  native.stderr?.on("data", chunk => { if (checks.nativeDenials.length < 200) checks.nativeDenials.push(chunk.toString().slice(0, 4096)); });')
(out/'host-diagnostic.mjs').write_text(host);(out/'host.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),host.splitlines(True),fromfile='host-e2e.mjs',tofile='host-diagnostic.mjs')))
(out/'host-hashes.json').write_text(json.dumps({'original':hashlib.sha256(original.encode()).hexdigest(),'instrumented':hashlib.sha256(host.encode()).hexdigest()})+'\n')
print(out)
