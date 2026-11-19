// Disposable native preview: real Root/drawer, memory session/settings/HTTP only.
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../../test/core/cloud_client_test.dart' show TestCredentials;
import '../../test/features/desktop_root_routing_test.dart' show RoutingDesktop;
import '../../test/features/desktop_subagents_test.dart' show SubagentTransport;
import '../../test/features/settings/app_lock_controller_test.dart'
    show FakeOwnerAuth;
import '../../test/features/settings/settings_controller_test.dart'
    show MemorySettingsStore;
import '../../test/features/remote_notifications/remote_push_test.dart'
    show PushNative, PushStore;
import '../../test/features/status/status_coordinator_test.dart'
    show FakeSurface;

CloudChatActionsPreviewFixture? lastFixture;

class CloudChatActionsPreviewFixture {
  CloudChatActionsPreviewFixture({required bool dark}) {
    settings = SettingsController(
      MemorySettingsStore()
        ..values['djl.appearance.mode'] = dark ? 'dark' : 'light',
    );
    client = CloudClient(
      baseUrl: Uri.parse('https://memory-preview.invalid'),
      credentials: TestCredentials()..values['cloud.session'] = 'memory-only',
      client: MockClient((request) async {
        final path = request.url.path;
        if (request.method == 'DELETE' &&
            path == '/v1/conversations/source-cloud-delete89') {
          deletes++;
          deleted = true;
          debugPrint('CLOUD89_MEMORY_DELETE $deletes');
        }
        return http.Response(
          jsonEncode(switch (path) {
            '/v1/auth/token' => {'token': 'memory-only'},
            '/v1/me' => {
              'user': {'id': 'memory-user89'},
              'activeOrgId': 'memory-org89',
            },
            '/v1/models' => {'models': []},
            '/v1/conversations' => {
              'conversations': [if (!deleted) conversation],
              'nextCursor': null,
            },
            '/v1/conversations/source-cloud-delete89' => {
              'conversation': conversation,
              'messages': [],
            },
            _ => <String, Object?>{},
          }),
          200,
        );
      }),
    );
  }
  final conversation = {
    'id': 'source-cloud-delete89',
    'title': 'Owned Cloud Delete QA89',
  };
  int deletes = 0;
  bool deleted = false;
  late final CloudClient client;
  late final SettingsController settings;
  Widget app() => DjlApp(
    client: client,
    settings: settings,
    desktop: RoutingDesktop(SubagentTransport()),
    appLock: AppLockController(FakeOwnerAuth()),
    remotePushNative: PushNative(),
    remotePushStore: PushStore(),
    statusSurface: FakeSurface(),
    linkStream: const Stream<Uri>.empty(),
    initialLink: Future.value(Uri.parse('djl://cloud/c/source-cloud-delete89')),
  );
}

void main() => runApp(const _CloudActionsPreview());

class _CloudActionsPreview extends StatefulWidget {
  const _CloudActionsPreview();
  @override
  State<_CloudActionsPreview> createState() => _CloudActionsPreviewState();
}

class _CloudActionsPreviewState extends State<_CloudActionsPreview> {
  CloudChatActionsPreviewFixture? _fixture;
  @override
  Widget build(BuildContext context) {
    if (_fixture case final fixture?) return fixture.app();
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: djlTheme(Brightness.light),
      home: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              for (final dark in [false, true])
                TextButton(
                  onPressed: () {
                    final fixture = CloudChatActionsPreviewFixture(dark: dark);
                    lastFixture = fixture;
                    setState(() => _fixture = fixture);
                  },
                  child: Text(
                    dark
                        ? 'Dark Cloud actions fixture'
                        : 'Light Cloud actions fixture',
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
