// Static native UI comparison. No account, network, credentials or app settings.
import 'package:djl_mobile/app/cloud_navigation.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_chat_actions.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_navigation_menu.dart';
import 'package:djl_mobile/features/conversations/presentation/conversation_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';
import 'package:flutter/material.dart';

class _NoCredentials implements CredentialStore {
  @override
  Future<String?> read(String key) async => null;
  @override
  Future<void> write(String key, String? value) async =>
      throw StateError('This UI probe cannot save credentials.');
}

void main() => runApp(const CloudMenuParityApp());

class CloudMenuParityApp extends StatefulWidget {
  const CloudMenuParityApp({super.key});
  @override
  State<CloudMenuParityApp> createState() => _CloudMenuParityAppState();
}

class _CloudMenuParityAppState extends State<CloudMenuParityApp> {
  final drawer = GlobalKey<DesktopPhoneDrawerState>();
  final navigation = CloudNavigationController()
    ..bindOwner('cloud-menu156')
    ..open('cloud-recent');
  late final client = CloudClient(
    baseUrl: Uri.parse('https://no-network.invalid/'),
    credentials: _NoCredentials(),
  );
  late final repository = CloudRepository(client);
  late final history = ConversationController(repository)
    ..items = const [
      Conversation(id: 'cloud-pinned', title: 'Cloud pinned QA', pinned: true),
      Conversation(id: 'cloud-recent', title: 'Cloud recent QA'),
    ];
  bool dark = false;
  int actions = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) drawer.currentState?.toggle();
    });
  }

  @override
  void dispose() {
    history.dispose();
    navigation.dispose();
    repository.modelSelection.dispose();
    client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    theme: djlTheme(dark ? Brightness.dark : Brightness.light),
    home: Builder(
      builder: (context) => Scaffold(
        body: DesktopPhoneDrawer(
          key: drawer,
          menu: CloudNavigationMenu(
            history: history,
            navigation: navigation,
            onDestination: (_) {},
            onConversation: (_) {},
            onNewChat: () {},
            onRemote: () {},
            onAction: (item, action, anchor) async {
              final confirmed =
                  action != 'delete' ||
                  await showCloudChatDeleteConfirmation(context, anchor);
              if (confirmed && mounted) setState(() => actions++);
            },
          ),
          child: ColoredBox(
            color: Theme.of(context).colorScheme.surface,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextButton(
                    onPressed: () => drawer.currentState?.toggle(),
                    child: const Text('Open navigation'),
                  ),
                  const Text('Read-only native source reference'),
                  Text('Fixture actions: $actions'),
                  TextButton(
                    onPressed: () => setState(() => dark = !dark),
                    child: const Text('Toggle QA appearance'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
