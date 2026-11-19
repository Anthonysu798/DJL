"""TEST ONLY: protected native status phases and exact-owned-process suspension.

Root operates OS surfaces through Computer Use. This tool captures but never
interprets pixels, auto-acknowledges visuals, builds, installs or grants access.
"""
import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import subprocess
import threading
import time
from urllib.request import Request, urlopen

from prepare_native_status_qa import TARGET, digest
from android_qa_device import read_owned_profile, validate_owned_profile

IOS_DEVICE='CD2EB9C1-619A-4C48-8EE8-F970FC4E9C9C'
PACKAGE='app.djl.mobile'
PHASES=('permission_discovery','permission_denied','permission_allowed','generic','generic_updated',
        'generic_ended','detailed_tap','privacy_barrier','malformed_retracted','deadline','deadline_verified','end_verified','finished')
BOOLS={'genericSafe','detailedCanary','orderMatches','deadlineMatches','permissionAllowed','permissionDenied',
       'coordinatorRetried','linkDelivered','samePid','noWritesWhileStopped','stale'}

class Refused(RuntimeError):
    def __init__(self): super().__init__('Native status QA guard refused.')

def require(value):
    if not value: raise Refused()

def validate_android_identity(value, expected_sha, expected_pid, background_required=True):
    try: validate_owned_profile(value, {'DJLFlutterAOSP35QA'})
    except RuntimeError: raise Refused() from None
    require(value.get('device')=='emulator-5556' and value.get('package')==PACKAGE)
    require(value.get('sha256')==expected_sha and value.get('pid')==expected_pid and expected_pid>1)
    require(value.get('uid')==value.get('processUid') and value.get('uid',0)>=10000 and value.get('name')==PACKAGE)
    require(value.get('systemUiPid',0)>1 and value['systemUiPid']!=expected_pid and value.get('systemUiState','')[:1] in {'R','S','I','D','U'})
    if background_required: require(value.get('backgrounded') is True)
    return value

def validate_ios_identity(value, expected_sha, expected_pid):
    require(value.get('simulator')==IOS_DEVICE and value.get('runtime','').startswith('com.apple.CoreSimulator.SimRuntime.iOS-26-') and value.get('booted') is True)
    require(value.get('bundle')==PACKAGE and value.get('sha256')==expected_sha and value.get('pid')==expected_pid and value.get('launchPid')==expected_pid and expected_pid>1)
    require(value.get('uid')==value.get('expectedUid') and value.get('uid',0)>0)
    require(value.get('executable')==value.get('containerExecutable') and value.get('executable','').endswith('/Runner.app/Runner'))
    require(value.get('systemUiPid',0)>1 and value['systemUiPid']!=expected_pid and value.get('systemUiState','')[:1] in {'R','S','I','D','U'})
    return value

class PhaseState:
    def __init__(self, platform):
        require(platform in {'ios','android'})
        self.platform=platform;self.index=-1;self.acked=True;self.meta={};self.frames={}
        self.stopped=False;self.resumed=False;self.paused=False;self.failed=False;self.deadline=0;self.pid=None
        self.driver_connected=False;self.marker=False
    @property
    def phase(self): return PHASES[self.index] if self.index>=0 else 'waiting'
    def submit(self, phase, meta):
        require(not self.failed and not self.stopped and self.acked and self.index+1<len(PHASES) and phase==PHASES[self.index+1])
        require(isinstance(meta,dict) and set(meta)<=BOOLS|{'pid','count','deadlineEpochMs'})
        require(all(type(v) is bool for k,v in meta.items() if k in BOOLS))
        require(type(meta.get('pid')) is int and meta['pid']>1 and type(meta.get('count')) is int and 0<=meta['count']<=1)
        if self.pid is not None: require(meta['pid']==self.pid)
        if phase in {'permission_discovery','permission_denied','generic_ended','malformed_retracted','end_verified','finished'}: require(meta['count']==0)
        if phase=='permission_denied': require(meta.get('permissionDenied') is True)
        if phase=='permission_allowed': require(meta['count']==1 and all(meta.get(k) is True for k in ['permissionAllowed','coordinatorRetried','genericSafe']))
        if phase in {'generic','generic_updated'}: require(meta['count']==1 and meta.get('genericSafe') is True and meta.get('orderMatches') is True)
        if phase=='detailed_tap': require(meta['count']==1 and meta.get('detailedCanary') is True)
        if phase=='privacy_barrier': require(meta['count']==1 and meta.get('genericSafe') is True and meta.get('linkDelivered') is True)
        if phase=='deadline':
            require(meta['count']==1 and meta.get('deadlineMatches') is True and meta.get('permissionAllowed') is True and type(meta.get('deadlineEpochMs')) is int)
            require(15_000<=meta['deadlineEpochMs']-int(time.time()*1000)<=45_000)
            self.deadline=meta['deadlineEpochMs'];self.paused=False
        if phase=='deadline_verified':
            require(self.resumed and meta.get('samePid') is True and meta.get('noWritesWhileStopped') is True and meta.get('permissionAllowed') is True)
            require(meta['count']==(0 if self.platform=='android' else 1))
            if self.platform=='ios': require(meta.get('stale') is True)
        self.index+=1;self.meta=dict(meta);self.pid=meta['pid'];self.acked=phase=='finished'
        if phase=='finished': self.marker=True
    def ack(self, phase, visual):
        require(phase==self.phase and phase!='deadline' and not self.acked and visual is True and phase in self.frames and not self.failed and not self.stopped)
        self.acked=True
    def complete(self, driver_code): return self.marker and self.phase=='finished' and self.acked and not self.failed and not self.stopped and self.driver_connected and driver_code==0
    def public(self):
        return {'phase':self.phase,'ack':self.acked,'driverConnected':self.driver_connected,'failed':self.failed,'stopped':self.stopped,'resumed':self.resumed}

def read_private(path):
    require(not path.is_symlink() and path.is_file() and path.stat().st_mode&0o777==0o600 and path.stat().st_uid==os.getuid())
    return json.loads(path.read_text())

def preparation(project):
    project=Path(project)
    require(project.absolute()==project.resolve() and project.parent==Path('/private/tmp') and re.fullmatch(r'djl-mobile-status-native-[a-z0-9-]{8,80}',project.name))
    require(project.stat().st_uid==os.getuid() and project.stat().st_mode&0o777==0o700)
    manifest=read_private(project/'native-status-manifest.json');control=read_private(project/'native-status-control.json')
    require(manifest.get('testOnly') is True and manifest.get('target')==TARGET and control.get('target')==TARGET and manifest.get('platform')==control.get('platform'))
    require(isinstance(control.get('token'),str) and re.fullmatch(r'[0-9a-f]{64}',control['token']))
    require(hashlib.sha256(control['token'].encode()).hexdigest()==manifest.get('nonceSha256'))
    for item in manifest['files']:
        file=project/item['path']
        require(file.resolve().is_relative_to(project) and not file.is_symlink() and digest(file)==item['after'])
    if manifest['platform']=='android':
        require(digest(project/'android/app/src/main/kotlin/app/djl/djl_mobile/NativeStatusQAObserver.kt')==manifest['addedObserverSha256'])
        require(digest(project/'android/app/src/main/kotlin/app/djl/djl_mobile/NativeStatusDeadline.kt')==manifest['addedDeadlineSha256'])
    return manifest,control

class Device:
    def __init__(self,platform,artifact,sha,run=subprocess.run):
        require(platform in {'ios','android'} and re.fullmatch(r'[0-9a-f]{64}',sha) is not None)
        self.platform=platform;self.artifact=Path(artifact);self.sha=sha;self.run=run
        self.adb=[str(Path.home()/'Library/Android/sdk/platform-tools/adb'),'-s','emulator-5556']
        self.sim=['xcrun','simctl']
    @classmethod
    def android(cls,artifact,sha,run=subprocess.run): return cls('android',artifact,sha,run)
    def read(self,command):
        result=self.run(command,capture_output=True,timeout=12,check=False)
        require(result.returncode==0)
        return result.stdout.decode('utf8','strict').strip()
    def android_identity(self):
        try: profile=read_owned_profile(lambda args:self.read(self.adb+args), {'DJLFlutterAOSP35QA'})
        except RuntimeError: raise Refused() from None
        path=self.read(self.adb+['shell','pm','path',PACKAGE]);require(re.fullmatch(r'package:/data/app/[A-Za-z0-9_=/~+.\-]+/base\.apk',path) is not None)
        sha=self.read(self.adb+['shell','sha256sum',path[8:]]).split()[0]
        pid=self.read(self.adb+['shell','pidof',PACKAGE]);require(re.fullmatch(r'[1-9]\d*',pid) is not None);pid=int(pid)
        uid=int(self.read(self.adb+['shell','run-as',PACKAGE,'id','-u']))
        status=self.read(self.adb+['shell','cat',f'/proc/{pid}/status'])
        process_uid=re.search(r'^Uid:\s+(\d+)',status,re.M);state=re.search(r'^State:\s+(\w)',status,re.M);require(process_uid and state)
        name=self.read(self.adb+['shell','cat',f'/proc/{pid}/cmdline']).strip('\x00');require('\x00' not in name)
        system=self.read(self.adb+['shell','pidof','com.android.systemui']);require(re.fullmatch(r'[1-9]\d*',system) is not None)
        system_status=self.read(self.adb+['shell','cat',f'/proc/{system}/status']);system_state=re.search(r'^State:\s+(\w)',system_status,re.M);require(system_state)
        resumed=self.read(self.adb+['shell','dumpsys','activity','activities'])
        top=[line for line in resumed.splitlines() if 'mResumedActivity:' in line or 'topResumedActivity=' in line or 'mResumedActivity=' in line]
        require(top)
        return {**profile,'device':'emulator-5556','package':PACKAGE,'sha256':sha,'pid':pid,'uid':uid,'processUid':int(process_uid[1]),'name':name,'state':state[1],
                'systemUiPid':int(system),'systemUiState':system_state[1],'backgrounded':all(PACKAGE not in line for line in top)}
    def ps(self,pid):
        line=self.read(['ps','-ww','-p',str(pid),'-o','pid=,uid=,state=,comm='])
        match=re.fullmatch(r'\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)',line);require(match)
        return {'pid':int(match[1]),'uid':int(match[2]),'state':match[3],'executable':match[4]}
    def ios_identity(self):
        inventory=json.loads(self.read(self.sim+['list','devices','--json']))
        found=[(runtime,device) for runtime,devices in inventory['devices'].items() for device in devices if device['udid']==IOS_DEVICE];require(len(found)==1)
        runtime,device=found[0]
        listing=self.read(self.sim+['spawn',IOS_DEVICE,'launchctl','list'])
        app=re.findall(r'^(\d+)\s+\S+\s+UIKitApplication:app\.djl\.mobile\[',listing,re.M)
        system=re.findall(r'^(\d+)\s+\S+\s+com\.apple\.SpringBoard\s*$',listing,re.M);require(len(app)==1 and len(system)==1)
        pid=int(app[0]);proc=self.ps(pid);system_proc=self.ps(int(system[0]))
        container=Path(self.read(self.sim+['get_app_container',IOS_DEVICE,PACKAGE,'app']))
        require(str(container).find('/'+IOS_DEVICE+'/')>=0 and not container.is_symlink())
        info=plistlib.loads((container/'Info.plist').read_bytes());require(info.get('CFBundleIdentifier')==PACKAGE and info.get('CFBundleExecutable')=='Runner')
        executable=container/'Runner';require(not executable.is_symlink())
        return dict(proc,simulator=IOS_DEVICE,runtime=runtime,booted=device['state']=='Booted',bundle=PACKAGE,sha256=digest(executable),launchPid=pid,expectedUid=os.getuid(),
                    containerExecutable=str(executable),systemUiPid=system_proc['pid'],systemUiState=system_proc['state'])
    def identify(self,pid,background_required=True):
        require(digest(self.artifact)==self.sha)
        value=self.android_identity() if self.platform=='android' else self.ios_identity()
        if self.platform=='android': validate_android_identity(value,self.sha,pid,background_required)
        else: validate_ios_identity(value,self.sha,pid)
        return value
    def verify(self,pid,stopped=False,background_required=True):
        value=self.identify(pid,background_required)
        require(value['state'].startswith('T') if stopped else value['state'][:1] in {'R','S','I','D','U'})
        return value
    def signal(self,pid,stop,*,deadline=None,owned=None,on_stop_dispatch=None):
        before=self.verify(pid,stopped=not stop,background_required=stop)
        if stop:
            # All potentially slow identity reads finish before the final clock
            # check. Ownership is recorded before dispatch can have any effect.
            require(type(deadline) is int and callable(on_stop_dispatch))
            owned={'pid':pid,'uid':before['uid'],'sha256':self.sha}
            if self.platform=='android': owned['profile']=validate_owned_profile(before, {'DJLFlutterAOSP35QA'})
            require(int(time.time()*1000)<deadline-1000)
            on_stop_dispatch(owned,before)
        else:
            require(isinstance(owned,dict) and owned.get('pid')==pid and owned.get('uid')==before['uid'] and owned.get('sha256')==self.sha)
        if self.platform=='android':
            require(owned.get('profile')==validate_owned_profile(before, {'DJLFlutterAOSP35QA'}))
        if self.platform=='android': self.read(self.adb+['shell','run-as',PACKAGE,'kill','-STOP' if stop else '-CONT',str(pid)])
        else: os.kill(pid,signal.SIGSTOP if stop else signal.SIGCONT)
        for _ in range(20):
            # Identity/read failures are uncertain dispatch, not a successful
            # state transition. The caller retains ownership for guarded abort.
            value=self.identify(pid,background_required=stop)
            require(value['uid']==owned['uid'])
            if self.platform=='android': require(owned['profile']==validate_owned_profile(value, {'DJLFlutterAOSP35QA'}))
            observed=int(time.time()*1000)
            if stop: require(observed<deadline)
            expected=value['state'].startswith('T') if stop else value['state'][:1] in {'R','S','I','D','U'}
            if expected:
                value['signalVerifiedAtEpochMs']=observed
                return value
            require(value['state'][:1] in {'R','S','I','D','U','T'})
            time.sleep(.05)
        raise Refused()
    def capture(self,output):
        require(not output.exists())
        if self.platform=='android':
            from android_native_frame import capture_owned_android_frame
            output.write_bytes(capture_owned_android_frame())
        else:
            self.read(self.sim+['io',IOS_DEVICE,'screenshot',str(output)])
            data=output.read_bytes();require(45<=len(data)<=16*1024*1024 and data.startswith(b'\x89PNG\r\n\x1a\n') and data[-12:]==b'\x00\x00\x00\x00IEND\xaeB\x60\x82')
        return digest(output)

class Session:
    def __init__(self,project,artifact,sha,device=None):
        self.project=Path(project);self.manifest,self.control=preparation(self.project)
        self.artifact=Path(artifact);require(self.artifact.resolve().is_relative_to(self.project/'build') and not self.artifact.is_symlink() and digest(self.artifact)==sha)
        self.device=device or Device(self.manifest['platform'],self.artifact,sha)
        self.state=PhaseState(self.manifest['platform']);self.lock=threading.RLock();self.proof={};self.captures=[];self.stop_owner=None
        self.output=self.project/'native-status-evidence';self.output.mkdir(mode=0o700,exist_ok=False)
    def own_stop_dispatch(self,owner,before):
        # Memory-only until the transaction returns/fails; do not insert slow
        # evidence I/O between the final clock check and the actual signal.
        self.stop_owner=owner
        self.proof={'pid':owner['pid'],'uid':owner['uid'],'systemUiPid':before['systemUiPid'],
                    'stopPossiblyDispatched':True,'stoppedVerified':False,
                    'stopDispatchedAtEpochMs':int(time.time()*1000)}
    def abort_recovery(self):
        if self.stop_owner is None: return
        self.state.failed=True
        self.proof['cleanupAttempted']=True
        try:
            owner=self.stop_owner
            self.device.signal(owner['pid'],False,owned=owner)
            self.stop_owner=None;self.state.stopped=False
            self.proof['cleanupResumedOwned']=True
        except Exception:
            # Never replace the original failure with cleanup failure, and never
            # CONT a changed PID/UID/artifact or a process not freshly proven T.
            self.proof['cleanupRefused']=True
        try: self.save()
        except OSError:
            if self.proof.get('diagnosticRecoveryRequested'):
                self.proof['diagnosticPersistenceFailed']=True
    def control_action(self,body):
        require(set(body)=={'operation','phase','visualConfirmed'} and body['phase']==self.state.phase)
        operation=body['operation'];visual=body['visualConfirmed'];require(type(visual) is bool and not self.state.failed)
        if operation=='capture':
            suffix=''
            if self.state.phase=='deadline':
                suffix='-after' if self.state.stopped else '-before'
                if self.state.stopped:
                    require(int(time.time()*1000)>=self.state.deadline+3000);self.device.verify(self.state.pid,True)
                else: require(int(time.time()*1000)<self.state.deadline-5000)
            output=self.output/(self.state.phase+suffix+f'-{len(self.captures)+1:02}.png')
            self.device.verify(self.state.pid,self.state.stopped,background_required=False)
            sha=self.device.capture(output)
            self.state.frames[self.state.phase+suffix]=sha
            self.captures.append({'file':output.name,'sha256':sha,'capturedAtEpochMs':int(time.time()*1000),
                                  'capturedAtMonotonicMs':int(time.monotonic()*1000),'appStopped':self.state.stopped})
            if self.state.stopped: self.proof['stoppedAtDeadlineCapture']=True
        elif operation=='ack': self.state.ack(body['phase'],visual)
        elif operation=='stop':
            require(self.state.phase=='deadline' and not self.state.stopped and not self.state.resumed and self.state.paused and visual and 'deadline-before' in self.state.frames)
            require(int(time.time()*1000)<self.state.deadline-3000)
            try:
                value=self.device.signal(self.state.pid,True,deadline=self.state.deadline,on_stop_dispatch=self.own_stop_dispatch)
            except BaseException:
                self.state.failed=True;self.abort_recovery()
                raise
            self.state.stopped=True
            self.proof.update(stoppedVerified=True,stoppedAtEpochMs=value['signalVerifiedAtEpochMs'],stoppedAtMonotonicMs=int(time.monotonic()*1000))
        elif operation=='diagnostic-recover':
            require(self.state.phase=='deadline' and self.state.stopped and not self.state.resumed and not self.state.acked and visual is False)
            require(self.proof.get('stoppedVerified') is True and self.proof.get('stoppedAtDeadlineCapture') is True)
            require(not self.proof.get('explicitDeadlineVisualAck') and not self.proof.get('diagnosticRecoveryRequested'))
            require(isinstance(self.stop_owner,dict) and self.stop_owner.get('pid')==self.state.pid==self.proof.get('pid'))
            sha=self.state.frames.get('deadline-after');require(isinstance(sha,str) and re.fullmatch(r'[0-9a-f]{64}',sha))
            frames=[frame for frame in self.captures if frame.get('sha256')==sha and frame.get('appStopped') is True and re.fullmatch(r'deadline-after-[0-9]{2,}\.png',frame.get('file',''))]
            require(len(frames)==1)
            frame=self.output/frames[0]['file'];require(frame.is_file() and not frame.is_symlink() and digest(frame)==sha)
            self.state.failed=True
            self.proof.update(diagnosticRecoveryRequested=True,failedFrameSha256=sha)
            try:
                # FAIL and the original stopped frame must precede guarded CONT.
                self.save()
            except OSError:
                self.proof['diagnosticPersistenceFailed']=True
                raise
            finally:
                # Even failed evidence storage must not strand an owned process.
                self.abort_recovery()
            if self.proof.get('diagnosticPersistenceFailed'):
                raise OSError('Native status diagnostic evidence unavailable.')
            return
        elif operation=='resume':
            require(self.state.phase=='deadline' and self.state.stopped and visual and 'deadline-after' in self.state.frames)
            try:
                value=self.device.signal(self.state.pid,False,owned=self.stop_owner)
            except BaseException:
                self.state.failed=True;self.abort_recovery()
                raise
            self.stop_owner=None;self.state.stopped=False;self.state.resumed=True;self.state.acked=True
            self.proof['resumedSamePid']=value['pid']==self.proof['pid']
            self.proof['resumedAtEpochMs']=int(time.time()*1000)
            self.proof['explicitDeadlineVisualAck']=True
            self.proof['confirmedFrameSha256']=self.state.frames['deadline-after']
        else: raise Refused()
        self.save()
    def save(self):
        # Only safe phase flags/frame hashes; never payloads, URLs or native dumps.
        value={'phase':self.state.phase,'ack':self.state.acked,'stopped':self.state.stopped,'resumedSamePid':self.state.resumed,'frames':self.state.frames,'failed':self.state.failed,'deadlineEpochMs':self.state.deadline,'processProof':self.proof,'captures':self.captures,'possiblyStopped':self.stop_owner is not None}
        path=self.output/'state.json';path.write_text(json.dumps(value,indent=2)+'\n');path.chmod(0o600)
    def handler(self):
        session=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def send(self,status,value):
                body=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def do_GET(self):
                with session.lock: self.send(200,session.state.public()) if self.path=='/status' else self.send(404,{})
            def do_POST(self):
                if self.headers.get('Origin') is not None or not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+session.control['token']): self.send(403,{});return
                try:
                    require(self.headers.get('Content-Type')=='application/json')
                    size=int(self.headers.get('Content-Length','0'));require(0<size<=4096)
                    body=json.loads(self.rfile.read(size))
                    with session.lock:
                        if self.path=='/stage':
                            require(set(body)=={'phase','meta'});session.state.submit(body['phase'],body['meta']);session.save()
                        elif self.path=='/lifecycle':
                            require(set(body)=={'state'} and body['state'] in {'resumed','inactive','hidden','paused','detached'})
                            if body['state']=='paused': session.state.paused=True
                            elif body['state']=='resumed': session.state.paused=False
                        elif self.path=='/failed': session.state.failed=True;session.save()
                        elif self.path=='/control': session.control_action(body)
                        else: raise Refused()
                        self.send(200,session.state.public())
                except (Refused,ValueError,TypeError,KeyError,OSError,subprocess.SubprocessError): self.send(409,{'refused':True})
        return Handler

def driver_markers(line):
    # Reconstruct fixed markers and bounded source coordinates only; never log
    # raw paths, function names, exception values, VM URLs or canary payloads.
    result=re.findall(r'DJL_STATUS_ADAPTER_(?:'+'|'.join(x.upper() for x in PHASES)+r'|FAILED)\b',line)
    if 'VMServiceFlutterDriver: Connected to Flutter application.' in line: result.append('DJL_STATUS_DRIVER_CONNECTED')
    if any(value in line for value in ['Some tests failed','Failure Details:','DriverError:','TimeoutException']): result.append('DJL_STATUS_DRIVER_FAILED')
    diagnostic=line.removesuffix('\n').removesuffix('\r').removeprefix('flutter: ')
    scalar=re.fullmatch(r'DJL_STATUS_DIAG_(BEFORE_HOLD|AFTER_FAILED_HOLD) nativeObservedAtEpochMs=([1-9][0-9]{0,15}) nativeStaleDateEpochMs=(0|[1-9][0-9]{0,15}) nativeActivityStateCode=([0-4])( samePid=(true|false) noWrites=(true|false))?',diagnostic)
    if scalar:
        phase,observed,stale,state,flags,same_pid,no_writes=scalar.groups()
        if int(observed)<=9007199254740991 and int(stale)<=9007199254740991 and (flags is not None)==(phase=='AFTER_FAILED_HOLD'):
            marker=f'DJL_STATUS_DIAG_{phase} nativeObservedAtEpochMs={int(observed)} nativeStaleDateEpochMs={int(stale)} nativeActivityStateCode={int(state)}'
            if flags: marker+=f' samePid={same_pid} noWrites={no_writes}'
            result.append(marker)
    elif diagnostic=='DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE':
        result.append('DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE')
    if len(line)<=4096 and '\\' not in line:
        frame=re.fullmatch(r'#[0-9]{1,4} [^()\x00-\x1f\x7f]{1,256} \(file://(/[A-Za-z0-9._~/-]{1,2048}):([0-9]{1,5}):([0-9]{1,4})\)',line.removesuffix('\n').removesuffix('\r'))
        if frame:
            path,row,column=frame.groups();row=int(row);column=int(column)
            if not any(part in {'','.','..'} for part in path.split('/')[1:]) and 1<=row<=10000 and 1<=column<=1024:
                for suffix,tag in [('/integration_test/status_native_adapter_test.dart','TARGET'),('/integration_test/support/native_status_acceptance.dart','SUPPORT')]:
                    if path.endswith(suffix): result.append(f'DJL_STATUS_DIAG_FRAME_{tag}_{row}_{column}')
    return result

def driver(project,device_id,vm_uri):
    project=Path(project);manifest,control=preparation(project)
    from urllib.parse import urlparse
    url=urlparse(vm_uri)
    require(url.scheme=='http' and url.hostname in {'127.0.0.1','localhost'} and url.port is not None and not url.username and not url.fragment and not url.query)
    require(device_id==('emulator-5556' if manifest['platform']=='android' else IOS_DEVICE))
    result_path=project/'native-status-driver-exit.json';require(not result_path.exists())
    command=[str(Path.home()/'flutter/bin/flutter'),'drive','--no-pub','--use-existing-app='+vm_uri,'--device-id='+device_id,'--driver=test_driver/integration_test.dart','--target='+TARGET,'--keep-app-running']
    log=project/'native-status-driver-markers.log'
    require(not log.exists())
    with log.open('x') as stream:
        log.chmod(0o600)
        process=subprocess.Popen(command,cwd=project,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        assert process.stdout is not None
        for line in process.stdout:
            for marker in driver_markers(line): stream.write(marker+'\n');stream.flush()
        code=process.wait()
    from prepare_native_status_qa import private_json
    private_json(result_path,{'exitCode':code,'markerSha256':digest(log),'nonceSha256':manifest['nonceSha256']})
    return code

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='mode',required=True)
    serve=sub.add_parser('serve');serve.add_argument('project',type=Path);serve.add_argument('--artifact',type=Path,required=True);serve.add_argument('--sha256',required=True);serve.add_argument('--timeout',type=int,default=1800)
    control=sub.add_parser('control');control.add_argument('project',type=Path);control.add_argument('operation',choices=['capture','ack','stop','resume','diagnostic-recover']);control.add_argument('--phase',required=True,choices=PHASES);control.add_argument('--visual-confirmed',action='store_true')
    run=sub.add_parser('driver');run.add_argument('project',type=Path);run.add_argument('--device',required=True);run.add_argument('--vm-uri',required=True)
    args=parser.parse_args();os.umask(0o077)
    try:
        if args.mode=='control':
            _,data=preparation(args.project)
            body=json.dumps({'operation':args.operation,'phase':args.phase,'visualConfirmed':args.visual_confirmed}).encode()
            request=Request('http://127.0.0.1:8857/control',body,headers={'Content-Type':'application/json','Authorization':'Bearer '+data['token']},method='POST')
            with urlopen(request,timeout=45) as response: require(response.status==200)
            print('Explicit native status control accepted.');return
        if args.mode=='driver': raise SystemExit(driver(args.project,args.device,args.vm_uri))
        require(60<=args.timeout<=3600)
        session=Session(args.project,args.artifact,args.sha256)
        server=ThreadingHTTPServer(('127.0.0.1',8857),session.handler());threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            until=time.monotonic()+args.timeout
            while time.monotonic()<until:
                with session.lock:
                    marker_log=args.project/'native-status-driver-markers.log'
                    if marker_log.exists():
                        markers=marker_log.read_text();session.state.driver_connected='DJL_STATUS_DRIVER_CONNECTED' in markers
                        require('DJL_STATUS_DRIVER_FAILED' not in markers and 'DJL_STATUS_ADAPTER_FAILED' not in markers)
                    require(not session.state.failed)
                    result=args.project/'native-status-driver-exit.json'
                    if result.exists():
                        observed=read_private(result)
                        require(observed['nonceSha256']==session.manifest['nonceSha256'] and marker_log.exists() and digest(marker_log)==observed['markerSha256'])
                        require(session.state.complete(observed['exitCode']) and 'DJL_STATUS_ADAPTER_FINISHED' in marker_log.read_text())
                        print('Native adapter phases acknowledged and actual driver exit zero observed.');return
                time.sleep(.2)
            raise Refused()
        finally:
            server.shutdown()
            session.abort_recovery()
    except (Refused,OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError): raise SystemExit('Native status QA guard refused; acceptance remains unproven.')

if __name__=='__main__': main()
