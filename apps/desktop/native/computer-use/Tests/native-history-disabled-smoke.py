#!/usr/bin/env python3
"""No UI/content/input: enable requests have no activity FD and must fail closed."""
import json, pathlib, subprocess, sys, uuid
helper = sys.argv[1]
base = dict(enabled=True, paused=False, interactionCaptureEnabled=True, retentionDays=7,
            intervalSeconds=30, includedBundleIds=['com.djl.history-fixture'], excludedBundleIds=[], excludedDomains=[])
requests = [
    ('wrong-owner', 'ordinary-thread', dict(method='activity.observe', epoch=str(uuid.uuid4()), settings=base)),
    ('missing-pipe', 'desktop:recorder', dict(method='activity.observe', epoch=str(uuid.uuid4()), settings=base)),
    ('disabled', 'desktop:recorder', dict(method='activity.observe', epoch=str(uuid.uuid4()), settings={**base, 'enabled': False})),
    ('paused', 'desktop:recorder', dict(method='activity.observe', epoch=str(uuid.uuid4()), settings={**base, 'paused': True})),
    ('legacy-consent', 'desktop:recorder', dict(method='activity.observe', epoch=str(uuid.uuid4()), settings={k:v for k,v in base.items() if k!='interactionCaptureEnabled'})),
    ('stop', 'desktop:recorder', dict(method='stop')),
]
frames = ''.join(json.dumps(dict(id=i,threadId=owner,request=req))+'\n' for i,owner,req in requests)
result = subprocess.run([helper], input=frames, text=True, capture_output=True, timeout=15,
                        env={'PATH':'/usr/bin:/bin','HOME':'/private/tmp/djl-cua-history-inert'})
assert result.returncode == 0, (result.returncode,result.stderr)
lines = [json.loads(line) for line in result.stdout.splitlines()]
responses = {line['id']:line['response'] for line in lines if 'id' in line}
assert responses['wrong-owner']['error']['code']=='unauthorized-session', responses
for key in ['missing-pipe','disabled','paused','legacy-consent']:
    assert responses[key]['result']['observing'] is False, (key,responses)
assert not any('event' in x and x['event'].get('type','').startswith('activity-') for x in lines)
assert responses['stop']['result']['stoppedSessionIds']==[]
print(json.dumps(dict(test='native-history-disabled-smoke',passed=True,responses=responses),sort_keys=True))
