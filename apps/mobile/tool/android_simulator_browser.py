"""Loopback native-screen/input surface for Computer Use on the owned QA emulator."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import argparse
from datetime import datetime, timezone
import os
import stat
import threading
import time
import uuid
import android_qa_device
import hashlib
from pathlib import Path
import secrets
import struct
import subprocess
import re
import xml.etree.ElementTree as ET
from android_native_frame import capture_owned_android_frame
from android_qa_device import PIXEL9_PROFILES, read_owned_profile
from android_native_pinch import native_pinch_command, record_native_pinch_result

ADB = str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
DEVICE = 'emulator-5556'
ORIGINS = {'http://127.0.0.1:8856', 'http://localhost:8856'}
TOKEN = secrets.token_urlsafe(32)
DIAGNOSTICS = None
CODE_PROVENANCE = {
    'viewer_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'profile_helper_sha256': hashlib.sha256(Path(android_qa_device.__file__).read_bytes()).hexdigest(),
}
SCREEN = (0, 0)
PROFILE = None
SKIN = {}
SKIN_ROOT = Path('/Applications/Android Studio.app/Contents/plugins/android/resources/device-art-resources/pixel_9')
SKIN_FILES = {
    '/skin/pixel9/back.webp': ('back.webp', 'd8ed1bcf314de2c293ee7ba7744349fa9233d24d47798189f9660369cae16f2d'),
    '/skin/pixel9/mask.webp': ('mask.webp', '6f4fb00c5147da694c4d0b3c45c0b580db94b81b77528985b6f30e4c944f1ac4'),
}

def load_pixel9_skin():
    # Only the installed public assets matching this measured layout are usable.
    # No arbitrary filesystem route, asset redistribution, or screenshot editing.
    try:
        layout = (SKIN_ROOT / 'layout').read_bytes()
        if hashlib.sha256(layout).hexdigest() != 'fd024b14e9d7c38042be3d2bd4dad0e93fb3d6cfe0e1884a1d15d23063103e4a':
            return {}
        assets = {}
        for route, (name, expected) in SKIN_FILES.items():
            data = (SKIN_ROOT / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != expected:
                return {}
            assets[route] = data
        return assets
    except OSError:
        return {}

def utc_now():
    return datetime.now(timezone.utc).isoformat()


class PrivateDiagnostics:
    def __init__(self, path):
        path = Path(path)
        if not path.is_absolute() or path.resolve() != path:
            raise ValueError('Diagnostics require an absolute, non-symlink private path')
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent = path.parent.stat()
        if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
            raise ValueError('Diagnostics directory must be owned and mode 0700')
        if path.exists() and not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError('Diagnostics output must be a regular file')
        fd = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            os.close(fd)
            raise ValueError('Diagnostics file must be owned, regular, and mode 0600')
        self.stream = os.fdopen(fd, 'a', encoding='utf8', buffering=1)
        self.lock = threading.Lock()
        self.instance = str(uuid.uuid4())
        try:
            self.emit({'schema': 1, 'event': 'startup', 'server_instance': self.instance,
                       'start_utc': utc_now(), 'pid': os.getpid(), **CODE_PROVENANCE})
        except Exception:
            self.close()
            raise

    def emit(self, record):
        with self.lock:
            self.stream.write(json.dumps(record, separators=(',', ':')) + '\n')

    def close(self):
        self.stream.close()


def configure_diagnostics(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--diagnostics-file', type=Path,
                        help='Optional private JSONL receipts; parent must be owned mode 0700')
    path = parser.parse_args(argv).diagnostics_file
    return PrivateDiagnostics(path) if path is not None else None


class InputReceipt:
    def __init__(self):
        self.sink = DIAGNOSTICS
        self.started = self.stage_started = time.monotonic()
        self.stage = 'authorization'
        self.substage = None
        self.request_id = str(uuid.uuid4())
        self.invoked = False
        self.outcome = 'not_invoked'
        self.status = None
        self.exception = None
        self.timeout = False
        self.returncode = None
        self.timeout_budget_s = 10

    def enter(self, stage, substage=None):
        self.stage, self.substage = stage, substage
        self.stage_started = time.monotonic()

    def failed(self, error):
        # Names are fixed here: never serialize arbitrary exception names or values.
        allowed = (ValueError, KeyError, RuntimeError, TypeError, OSError,
                   BrokenPipeError, ConnectionResetError, UnicodeDecodeError,
                   json.JSONDecodeError, subprocess.TimeoutExpired,
                   subprocess.CalledProcessError, subprocess.SubprocessError)
        self.exception = type(error).__name__ if type(error) in allowed else 'Exception'
        self.timeout = isinstance(error, subprocess.TimeoutExpired)
        self.returncode = error.returncode if isinstance(error, subprocess.CalledProcessError) and type(error.returncode) is int else self.returncode

    def emit(self):
        if self.sink is None:
            return
        now = time.monotonic()
        record = {'schema': 1, 'event': 'request', 'server_instance': self.sink.instance,
                  'request_id': self.request_id, 'utc': utc_now(), 'stage': self.stage,
                  'substage': self.substage, 'total_elapsed_s': now - self.started,
                  'stage_elapsed_s': now - self.stage_started,
                  'returncode': self.returncode, 'exception_class': self.exception,
                  'timeout': self.timeout, 'timeout_budget_s': self.timeout_budget_s,
                  'input_invoked': self.invoked, 'outcome': self.outcome,
                  'http_status_attempted': self.status}
        try:
            self.sink.emit(record)
        except Exception:
            pass  # A failed receipt must never change input/security behavior or replay input.


def verify_profile(receipt=None):
    def read(args):
        if receipt is not None:
            substage = {('emu', 'avd', 'name'): 'avd',
                        ('shell', 'getprop', 'ro.build.version.sdk'): 'api',
                        ('shell', 'wm', 'size'): 'geometry'}.get(tuple(args))
            receipt.enter('profile', substage)
        return adb(*args)
    if PROFILE is None or read_owned_profile(read) != PROFILE:
        raise RuntimeError('Owned Android QA profile changed')

def render_page(profile, framed):
    sdk = PIXEL9_PROFILES.get(profile['avd'])
    pixel9 = sdk is not None
    version = {35: 'Android 15 / API 35', 36: 'Android 16 / API 36'}.get(sdk, '')
    title = 'DJL Pixel9 QA · ' + version if pixel9 else 'DJL Android QA · ' + profile['avd']
    caption = ('Verified Pixel9 · ' + version + ' · physical 1080×2424 · ' +
               ('official installed skin' if framed else 'unframed native capture (skin unavailable)')) if pixel9 else 'Verified ' + profile['avd'] + ' · unframed native capture'
    return PAGE.replace('__TITLE__', title).replace('__CAPTION__', caption).replace('__FRAME_CLASS__', 'pixel9' if pixel9 and framed else 'unframed').replace('__CHROME__', '<img class="skin-mask" src="/skin/pixel9/mask.webp" alt="">' if pixel9 and framed else '').replace('__TOKEN__', TOKEN)


def adb(*args, timeout=10):
    return subprocess.check_output([ADB, '-s', DEVICE, *args], timeout=timeout, stderr=subprocess.DEVNULL)

def screen_size(text):
    sizes = dict(re.findall(r'^(Physical|Override) size:[ \t]*(.*)$', text, re.MULTILINE))
    match = re.fullmatch(r'([1-9]\d*)x([1-9]\d*)', sizes.get('Override', sizes.get('Physical', '')).strip())
    if match is None:
        raise ValueError('Native screen size unavailable')
    return tuple(int(value) for value in match.groups())

def input_command(value, width, height):
    if value.get('action') == 'pinch-public-preview':
        if set(value) != {'action'} or (width, height) != (1080, 2424):
            raise ValueError('Expected the fixed prepared Pixel9 pinch')
        return native_pinch_command(lambda args: adb(*args))
    def point(name):
        p = value.get(name)
        if not isinstance(p, list) or len(p) != 2 or any(type(n) is not int for n in p):
            raise ValueError('Invalid point')
        if not 0 <= p[0] < width or not 0 <= p[1] < height:
            raise ValueError('Point outside native screen')
        return [str(n) for n in p]
    if value.get('action') in ('swipe-up', 'swipe-down', 'hold-center'):
        if type(width) is not int or type(height) is not int or width <= 0 or height <= 0:
            raise ValueError('Native screen size unavailable')
        if value['action'] == 'hold-center':
            return ['shell', 'input', 'swipe', str(width // 2), str(height // 2), str(width // 2), str(height // 2), '1200']
        if value['action'] == 'swipe-down':
            return ['shell', 'input', 'swipe', str(width // 2), '0', str(width // 2), str(height * 4 // 5), '600']
        return ['shell', 'input', 'swipe', str(width // 2), str(height * 4 // 5), str(width // 2), str(height // 5), '600']
    if value.get('action') == 'tap':
        return ['shell', 'input', 'tap', *point('at')]
    if value.get('action') == 'long-press':
        at = point('at')
        return ['shell', 'input', 'swipe', *at, *at, '1500']
    if value.get('action') in ('drag', 'drag-and-drop'):
        gesture = 'draganddrop' if value['action'] == 'drag-and-drop' else 'swipe'
        return ['shell', 'input', gesture, *point('from'), *point('to'), '600']
    if value.get('action') in ('add-djl-tile', 'activate-djl-tile'):
        action = 'add-tile' if value['action'] == 'add-djl-tile' else 'click-tile'
        return ['shell', 'cmd', 'statusbar', action, 'app.djl.mobile/.DJLLaunchTileService']
    if value.get('action') == 'key' and value.get('key') == 'select-all':
        return ['shell', 'input', 'keycombination', '113', '29']
    if value.get('action') == 'key' and value.get('key') == 'paste':
        return ['shell', 'input', 'keycombination', '113', '50']
    keys = {'home': '3', 'back': '4', 'recents': '187', 'wake': '224', 'enter': '66', 'delete': '67',
            'space': '62', 'tab': '61', 'grave': '68', 'minus': '69', 'equals': '70',
            'left-bracket': '71', 'right-bracket': '72', 'backslash': '73',
            'semicolon': '74', 'apostrophe': '75', 'slash': '76', 'comma': '55', 'period': '56',
            **{str(n): str(n + 7) for n in range(10)},
            **{chr(n + 97): str(n + 29) for n in range(26)}}
    if value.get('action') == 'key' and value.get('key') in keys:
        if 'shift' in value and type(value['shift']) is not bool:
            raise ValueError('Invalid keyboard modifier')
        if value.get('shift'):
            return ['shell', 'input', 'keycombination', '59', keys[value['key']]]
        return ['shell', 'input', 'keyevent', keys[value['key']]]
    raise ValueError('Unsupported QA input')

class Surface(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def reply(self, body, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        global SCREEN
        if self.headers.get('Host') not in {'127.0.0.1:8856', 'localhost:8856'}:
            self.send_error(403); return
        if self.path in SKIN:
            self.reply(SKIN[self.path], 'image/webp'); return
        if self.path.split('?')[0] in {'/frame.png', '/accessibility'}:
            try: verify_profile()
            except RuntimeError:
                self.send_error(409, 'Owned QA profile changed'); return
        if self.path.split('?')[0] == '/frame.png':
            frame = capture_owned_android_frame()
            dimensions = struct.unpack('>II', frame[16:24])
            if PROFILE.get('physicalSize') and dimensions != PROFILE['physicalSize']:
                self.send_error(409, 'Native frame geometry changed'); return
            SCREEN = dimensions
            self.reply(frame, 'image/png'); return
        if self.path == '/accessibility':
            path = f'/data/local/tmp/djl-mobile-qa-window-{uuid.uuid4().hex}.xml'
            try:
                subprocess.check_output([ADB, '-s', DEVICE, 'shell', 'uiautomator', 'dump', '--windows', path], timeout=40, stderr=subprocess.DEVNULL)
                root = ET.fromstring(adb('exec-out', 'cat', path))
                nodes = []
                for node in root.iter('node'):
                    text_field = node.get('class') == 'android.widget.EditText'
                    enabled = node.get('enabled') != 'false'
                    label = 'Protected field' if node.get('password') == 'true' else node.get('content-desc') or node.get('text') or ((node.get('hint') or 'Text field') if text_field else None)
                    bounds = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
                    if label and len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                        entry = {'label': label[:500], 'bounds': bounds, 'clickable': enabled and (node.get('clickable') == 'true' or (text_field and node.get('focusable') == 'true'))}
                        if enabled and node.get('long-clickable') == 'true':
                            entry['longClickable'] = True
                        nodes.append(entry)
                self.reply(json.dumps(nodes).encode(), 'application/json')
            finally:
                adb('shell', 'rm', '-f', path)
            return
        if self.path != '/':
            self.send_error(404); return
        self.reply(render_page(PROFILE, bool(SKIN)).encode(), 'text/html; charset=utf-8')
    def do_POST(self):
        if self.path != '/input' or self.headers.get('Origin') not in ORIGINS or self.headers.get('X-QA-Token') != TOKEN:
            receipt = InputReceipt()
            receipt.status = 403
            try:
                self.send_error(403)
            except BaseException as error:
                receipt.enter('response')
                receipt.failed(error)
                raise
            finally:
                receipt.emit()
            return
        receipt = InputReceipt()
        try:
            receipt.enter('profile')
            verify_profile(receipt)
            receipt.enter('body')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size < 2048: raise ValueError('Invalid input length')
            body = self.rfile.read(size)
            receipt.enter('json')
            value = json.loads(body)
            receipt.enter('input_validation')
            if not isinstance(value, dict): raise ValueError('Invalid QA input')
            command = input_command(value, *SCREEN)
            receipt.enter('input_subprocess')
            receipt.invoked = True
            receipt.outcome = 'effect_unknown'
            if value.get('action') == 'pinch-public-preview':
                receipt.timeout_budget_s = 30
                output = adb(*command, timeout=30)
            else:
                output = adb(*command)
            receipt.returncode = 0
            if value.get('action') == 'pinch-public-preview':
                record_native_pinch_result(output)
            receipt.outcome = 'subprocess_completed'
            receipt.enter('response')
            receipt.status = 200
            self.reply(b'{}', 'application/json')
            receipt.enter('complete')
        except (ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            receipt.failed(error)
            receipt.status = 400
            try:
                self.send_error(400, 'Invalid QA input')
            except BaseException as response_error:
                receipt.enter('response')
                receipt.failed(response_error)
                raise
        except BaseException as error:
            receipt.failed(error)
            raise
        finally:
            receipt.emit()

PAGE = '''<!doctype html><meta charset="utf-8"><title>__TITLE__</title>
<style>body{background:#161616;color:#eee;font:16px system-ui;text-align:center}#device{position:relative;display:inline-block}#screen{height:82vh;touch-action:none;user-select:none;display:block}.pixel9{height:82vh;aspect-ratio:1198/2531;background:url('/skin/pixel9/back.webp') center/100% 100% no-repeat}.pixel9 #screen,.pixel9 .skin-mask{position:absolute;left:calc(55/1198*100%);top:calc(58/2531*100%);width:calc(1080/1198*100%);height:calc(2424/2531*100%);border-radius:8.055556%/3.589109%}.skin-mask{pointer-events:none}button{padding:10px;margin:8px}</style>
<h1>__TITLE__ · emulator-5556</h1><p>__CAPTION__</p><div><button onclick="key('home')">Home</button><button onclick="key('back')">Back</button><button onclick="key('recents')">Recents</button><button onclick="key('paste')">Paste native clipboard</button><button onclick="key('select-all')">Select native text</button><button onclick="key('wake')">Wake device</button><button onclick="send({action:'swipe-up'})">Swipe up</button><button onclick="send({action:'hold-center'})">Hold screen center</button><button onclick="send({action:'swipe-down'})">Swipe down</button><button onclick="send({action:'pinch-public-preview'})">Pinch public preview</button><button id="observer-toggle" onclick="setLive(!live)">Pause screenshots</button><button onclick="refresh(true)">Refresh once</button><span id="observer-state" role="status">Screenshots live</span><button onclick="accessibility()">Read native accessibility</button><button onclick="send({action:'add-djl-tile'})">Add DJL test tile</button><button onclick="send({action:'activate-djl-tile'})">Activate DJL test tile</button><label><input type="checkbox" id="held-drag">Hold before dragging</label></div><div id="device" class="__FRAME_CLASS__"><img id="screen" draggable="false" alt="Actual Android QA screen">__CHROME__</div><div id="native"></div><div id="keys"></div><div id="input-status" role="status" aria-live="polite"></div><div id="input-progress" role="status" aria-live="polite">Native actions: 0/0 complete, 0 failed</div>
<script>const screen=document.getElementById('screen');let start,startAt,timer,pending=Promise.resolve(),live=true,issued=0,completed=0,failed=0;
screen.tabIndex=0;
const keyboardKeys={Enter:'enter',Backspace:'delete',Tab:'tab',' ':'space','`':'grave','-':'minus','=':'equals','[':'left-bracket',']':'right-bracket',[String.fromCharCode(92)]:'backslash',';':'semicolon',[String.fromCharCode(39)]:'apostrophe','/':'slash',',':'comma','.':'period'};
const shiftedKeys={'!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','~':'grave','_':'minus','+':'equals','{':'left-bracket','}':'right-bracket','|':'backslash',':':'semicolon','"':'apostrophe','?':'slash','<':'comma','>':'period'};
screen.onkeydown=e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;let name,shift=!!e.shiftKey;if(/^[a-z0-9]$/.test(e.key))name=e.key;else if(/^[A-Z]$/.test(e.key)){name=e.key.toLowerCase();shift=true}else if(Object.hasOwn(keyboardKeys,e.key))name=keyboardKeys[e.key];else if(Object.hasOwn(shiftedKeys,e.key)){name=shiftedKeys[e.key];shift=true}else return;e.preventDefault();send({action:'key',key:name,...(shift?{shift:true}:{})})};
function inputProgress(){document.getElementById('input-progress').textContent=`Native actions: ${completed}/${issued} complete, ${failed} failed`}
function send(body){issued++;inputProgress();const action=pending.then(async()=>{const result=await fetch('/input',{method:'POST',headers:{'Content-Type':'application/json','X-QA-Token':'__TOKEN__'},body:JSON.stringify(body)});if(!result.ok)throw new Error('QA input rejected');document.getElementById('input-status').textContent='';refresh()});pending=action.then(()=>{completed++;inputProgress()},()=>{completed++;failed++;inputProgress();document.getElementById('input-status').textContent='QA input failed. Try again.'});return action}
function key(key){send({action:'key',key})}
for(const n of ['0','1','2','3','4','5','6','7','8','9','delete','enter']){const button=document.createElement('button');button.textContent='Key '+n;button.onclick=()=>key(n);document.getElementById('keys').append(button)}
async function accessibility(){const panel=document.getElementById('native');panel.textContent='Reading native accessibility…';try{const response=await fetch('/accessibility');if(!response.ok)throw new Error('Unavailable');const nodes=await response.json();panel.textContent='';for(const node of nodes){const element=document.createElement(node.clickable?'button':'p');element.textContent='Native: '+node.label;const at=[Math.floor((node.bounds[0]+node.bounds[2])/2),Math.floor((node.bounds[1]+node.bounds[3])/2)];if(node.clickable)element.onclick=()=>send({action:'tap',at});panel.append(element);if(node.longClickable){const hold=document.createElement('button');hold.textContent='Native hold: '+node.label;hold.onclick=()=>send({action:'long-press',at});panel.append(hold)}}}catch{panel.textContent='Native accessibility unavailable. Request a fresh snapshot.'}}
function point(e){const r=screen.getBoundingClientRect();return [Math.floor((e.clientX-r.left)*screen.naturalWidth/r.width),Math.floor((e.clientY-r.top)*screen.naturalHeight/r.height)]}
screen.onpointerdown=e=>{start=point(e);startAt=e.timeStamp;screen.setPointerCapture(e.pointerId)};
screen.onpointerup=e=>{const end=point(e);send(Math.hypot(end[0]-start[0],end[1]-start[1])<15?{action:e.timeStamp-startAt>=500?'long-press':'tap',at:end}:{action:document.getElementById('held-drag').checked?'drag-and-drop':'drag',from:start,to:end})};
function refresh(once=false){clearTimeout(timer);if(live||once)screen.src='/frame.png?t='+Date.now()}function schedule(){clearTimeout(timer);if(live)timer=setTimeout(refresh,1200)}function setLive(value){live=value;clearTimeout(timer);document.getElementById('observer-state').textContent=live?'Screenshots live':'Screenshots paused';document.getElementById('observer-toggle').textContent=live?'Pause screenshots':'Resume screenshots';if(live)refresh()}screen.onload=screen.onerror=schedule;refresh();</script>'''

if __name__ == '__main__':
    DIAGNOSTICS = configure_diagnostics()
    if adb('get-state').strip() != b'device': raise RuntimeError('Owned QA emulator is unavailable')
    PROFILE = read_owned_profile(lambda args: adb(*args))
    SCREEN = PROFILE.get('physicalSize') or screen_size(adb('shell', 'wm', 'size').decode())
    SKIN = load_pixel9_skin() if PROFILE['avd'] in PIXEL9_PROFILES else {}
    print('Owned Android QA surface on http://127.0.0.1:8856', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8856), Surface).serve_forever()
