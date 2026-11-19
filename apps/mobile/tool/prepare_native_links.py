"""Prepare two disposable Cloud conversations for actual native URL delivery tests."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import uuid4

private = Path('/private/tmp/djl-mobile-qa')
credentials = json.loads((private / 'credentials.json').read_text())
base = credentials['endpoint'].rstrip('/') + '/'
if urlparse(base).hostname not in {'127.0.0.1', 'localhost', '::1'}:
    raise RuntimeError('Native link fixtures require the local QA API')

def request(method, route, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request(base + route, data=data, headers=headers, method=method), timeout=30) as response:
        return json.load(response), response.headers

login, headers = request('POST', 'v1/auth/sign-in/email', {
    'email': credentials['email'], 'password': credentials['password'],
})
session = headers.get('set-auth-token') or login['token']
access, _ = request('GET', 'v1/auth/token', token=session)
token = access['token']
config = json.loads((private / 'native-config.json').read_text())
for kind in ['COLD', 'WARM']:
    conversation, _ = request('POST', 'v1/conversations', {
        'clientConversationId': str(uuid4()),
    }, token)
    identity = conversation['id']
    request('PATCH', f'v1/conversations/{identity}', {'title': f'Native {kind.lower()} link QA'}, token)
    config[f'DJL_QA_LINK_{kind}'] = identity
output = private / 'link-native-config.json'
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump(config, stream)
print('Prepared two disposable Cloud link conversations; private defines saved.')
