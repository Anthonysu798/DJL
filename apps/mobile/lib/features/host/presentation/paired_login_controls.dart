import 'package:flutter/material.dart';
import 'paired_login_controller.dart';

class PairedLoginControls extends StatelessWidget {
  const PairedLoginControls({super.key, required this.controller});
  final PairedLoginController controller;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final login = controller;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (login.busy) ...[
            const LinearProgressIndicator(),
            const Text('Starting or checking paired sign-in…'),
          ],
          if (!login.loaded && login.storageError == null)
            const Text('Loading secure sign-in recovery…'),
          if (!login.live)
            const Text(
              'Connect to your paired device to finish ChatGPT sign-in.',
            ),
          if (login.host.snapshot?.advertised?.hostBrowserLogin != true)
            const Text(
              'Host-browser sign-in is not advertised by this bridge. Finish sign-in on your paired device.',
            ),
          if (login.pending != null)
            Text(
              login.pending!.expiresAt == null
                  ? 'A sign-in is pending. The host did not supply an expiry.'
                  : 'A sign-in is pending until ${login.pending!.expiresAt!.toLocal()}.',
            ),
          if (login.uncertainStart)
            const Text(
              'A previous sign-in start has an unknown result. Check paired status before starting another.',
            ),
          FilledButton.icon(
            onPressed: login.canOpen ? login.openOnHost : null,
            icon: const Icon(Icons.open_in_browser),
            label: Text(
              login.pending == null
                  ? 'Sign in on paired Mac'
                  : 'Reopen sign-in on paired Mac',
            ),
          ),
          if (login.pending != null || login.uncertainStart)
            TextButton(
              onPressed: login.allowed && !login.busy ? login.cancel : null,
              child: const Text('Cancel pending sign-in'),
            ),
          if (login.hasCallback) ...[
            const Text(
              'A sign-in return is saved securely for this paired device. Status will be checked before retrying.',
            ),
            OutlinedButton(
              onPressed:
                  login.allowed &&
                      login.live &&
                      !login.busy &&
                      login.storageError == null
                  ? login.retryCallback
                  : null,
              child: const Text('Retry saved sign-in return'),
            ),
          ],
          if (login.error != null) Text(login.error!),
          if (login.storageError != null) ...[
            Text(
              login.storageError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            TextButton(
              onPressed: login.allowed && !login.busy
                  ? login.retryStorage
                  : null,
              child: const Text('Retry secure sign-in storage'),
            ),
          ],
          if (login.uncertainStart || login.remoteUnconfirmed)
            TextButton(
              onPressed: login.allowed && login.live && !login.busy
                  ? login.checkStatus
                  : null,
              child: const Text('Check paired sign-in status'),
            ),
          OutlinedButton(
            onPressed:
                login.allowed &&
                    login.loaded &&
                    !login.busy &&
                    !login.remoteUnconfirmed
                ? () => _confirmLogout(context, login)
                : null,
            child: const Text('Sign out paired ChatGPT'),
          ),
        ],
      );
    },
  );
}

Future<void> _confirmLogout(
  BuildContext context,
  PairedLoginController login,
) async {
  final identity = login.identity, revision = login.operationRevision;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      scrollable: true,
      title: const Text('Sign out ChatGPT on the paired device?'),
      content: const Text(
        'This clears the saved paired ChatGPT sign-in recovery on this phone and asks the paired host to sign out. If it is offline, remote sign-out remains unconfirmed. Your DJL Cloud account and pairing are preserved.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Sign out'),
        ),
      ],
    ),
  );
  if (confirmed == true &&
      login.allowed &&
      login.identity == identity &&
      login.operationRevision == revision) {
    await login.logout();
  }
}
