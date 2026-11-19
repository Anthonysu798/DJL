import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoIcons;
import '../core/presentation/cloud_chrome.dart';
import '../features/chat/data/cloud_repository.dart';
import '../features/chat/domain/cloud_models.dart';
import '../features/chat/presentation/chat_controller.dart';
import '../features/chat/presentation/chat_page.dart';
import '../features/conversations/presentation/conversation_controller.dart';
import '../features/conversations/presentation/cloud_navigation_menu.dart';
import '../features/desktop/presentation/desktop_phone_drawer.dart';
import '../features/images/data/image_repository.dart';
import '../features/images/domain/gallery_image.dart';
import '../features/images/presentation/image_controller.dart';
import '../features/images/presentation/image_gallery_page.dart';
import '../features/images/presentation/cloud_image_creation_sheet.dart';
import '../features/notifications/presentation/notification_controller.dart';
import '../features/notifications/presentation/notification_page.dart';
import '../features/settings/presentation/settings_controller.dart';
import 'cloud_navigation.dart';

class CloudShell extends StatefulWidget {
  const CloudShell({
    super.key,
    required this.navigation,
    required this.history,
    required this.repository,
    required this.settings,
    required this.accountScope,
    required this.settingsPage,
    required this.onRemote,
    required this.onAction,
    required this.onRefreshProfile,
    required this.contentAllowed,
    this.inbox,
    this.linkError,
    this.onRetryLink,
  });
  final CloudNavigationController navigation;
  final ConversationController history;
  final CloudRepository repository;
  final SettingsController settings;
  final String? accountScope;
  final bool contentAllowed;
  final Widget Function(BuildContext, VoidCallback) settingsPage;
  final VoidCallback onRemote, onRefreshProfile;
  final Future<void> Function(Conversation, String, Rect) onAction;
  final NotificationController? inbox;
  final String? linkError;
  final VoidCallback? onRetryLink;
  @override
  State<CloudShell> createState() => _CloudShellState();
}

class _CloudShellState extends State<CloudShell> {
  final _drawer = GlobalKey<DesktopPhoneDrawerState>();
  bool _menuOpen = false, _contentOpened = false;
  late int _presentation;
  late CloudDestination _destination;
  @override
  void initState() {
    super.initState();
    _presentation = widget.navigation.presentation;
    _destination = widget.navigation.destination;
    widget.navigation.addListener(_selectionChanged);
  }

  void _selectionChanged() {
    final nav = widget.navigation;
    if (_presentation != nav.presentation || _destination != nav.destination) {
      _presentation = nav.presentation;
      _destination = nav.destination;
      _drawer.currentState?.close();
    }
  }

  @override
  void dispose() {
    widget.navigation.removeListener(_selectionChanged);
    super.dispose();
  }

  void _show(CloudDestination destination) {
    _drawer.currentState?.close();
    widget.navigation.show(destination);
    if (destination == CloudDestination.chat) widget.history.refresh();
  }

  void _open(Conversation item, {Json? image}) {
    _drawer.currentState?.close();
    widget.navigation.open(item.id, image: image);
  }

  void _newChat({bool createImage = false}) {
    _drawer.currentState?.close();
    widget.navigation.newChat(createImage: createImage);
  }

  void _toggle() {
    if (_drawer.currentState?.isOpen == false) {
      widget.history.refresh();
    }
    _drawer.currentState?.toggle();
  }

  Widget _profilePending([String? title]) => Scaffold(
    appBar: AppBar(
      toolbarHeight: 44,
      leadingWidth: 60,
      leading: Padding(
        padding: const EdgeInsets.only(left: 16),
        child: CloudNavigationButton(
          icon: CupertinoIcons.line_horizontal_3,
          label: 'Open navigation',
          onPressed: _toggle,
        ),
      ),
      title: title == null ? null : Text(title),
    ),
    body: SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Account details are unavailable.',
                textAlign: TextAlign.center,
              ),
              TextButton(
                onPressed: widget.onRefreshProfile,
                child: const Text('Retry account'),
              ),
            ],
          ),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.navigation,
    builder: (context, _) {
      _contentOpened = _contentOpened || widget.contentAllowed;
      if (!_contentOpened) return const Scaffold();
      final nav = widget.navigation;
      final child = switch (nav.destination) {
        CloudDestination.chat =>
          widget.accountScope == null || nav.owner == null
              ? _profilePending()
              : _CloudChatDestination(
                  key: ValueKey('${nav.owner}:${nav.presentation}'),
                  navigation: nav,
                  repository: widget.repository,
                  settings: widget.settings,
                  accountScope: widget.accountScope!,
                  exposed: !_menuOpen,
                  onOpenNavigation: _toggle,
                ),
        CloudDestination.settings => widget.settingsPage(context, _toggle),
        CloudDestination.images =>
          widget.accountScope == null || nav.owner == null
              ? _profilePending('Images')
              : _CloudImagesDestination(
                  key: ValueKey(nav.owner),
                  repository: widget.repository,
                  accountScope: widget.accountScope!,
                  onOpenNavigation: _toggle,
                  onOpen: (image, edit) => _open(
                    Conversation(id: image.conversationId),
                    image: edit ? image.part : null,
                  ),
                  onCreated: (id) => _open(Conversation(id: id)),
                ),
        CloudDestination.notifications =>
          widget.inbox == null
              ? _profilePending('Notifications')
              : NotificationPage(
                  key: ObjectKey(widget.inbox),
                  controller: widget.inbox!,
                  ownsController: false,
                  onOpenNavigation: _toggle,
                  onOpen: (id) => _open(Conversation(id: id)),
                ),
      };
      return PopScope<void>(
        canPop:
            !_menuOpen &&
            nav.destination == CloudDestination.chat &&
            nav.conversationId == null,
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          if (_menuOpen) {
            _drawer.currentState?.close();
          } else if (nav.destination != CloudDestination.chat) {
            _show(CloudDestination.chat);
          } else {
            _newChat();
          }
        },
        child: DesktopPhoneDrawer(
          key: _drawer,
          handlesBack: false,
          onChanged: (value) => setState(() => _menuOpen = value),
          menu: CloudNavigationMenu(
            history: widget.history,
            navigation: nav,
            onDestination: _show,
            onConversation: _open,
            onNewChat: _newChat,
            onRemote: () {
              _drawer.currentState?.close();
              widget.onRemote();
            },
            onAction: widget.onAction,
            unreadCount: widget.inbox?.unreadCount ?? 0,
          ),
          child: Column(
            children: [
              if (widget.linkError != null)
                SafeArea(
                  bottom: false,
                  child: MaterialBanner(
                    content: Text(widget.linkError!),
                    actions: [
                      TextButton(
                        onPressed: widget.onRetryLink,
                        child: const Text('Retry linked conversation'),
                      ),
                    ],
                  ),
                ),
              Expanded(child: child),
            ],
          ),
        ),
      );
    },
  );
}

/// The ChatPage owns this stable controller and disposes it with the page.
/// A server-created conversation promotes the selection without replacing it.
class _CloudChatDestination extends StatefulWidget {
  const _CloudChatDestination({
    super.key,
    required this.navigation,
    required this.repository,
    required this.settings,
    required this.accountScope,
    required this.exposed,
    required this.onOpenNavigation,
  });
  final CloudNavigationController navigation;
  final CloudRepository repository;
  final SettingsController settings;
  final String accountScope;
  final bool exposed;
  final VoidCallback onOpenNavigation;
  @override
  State<_CloudChatDestination> createState() => _CloudChatDestinationState();
}

class _CloudChatDestinationState extends State<_CloudChatDestination> {
  late final String _owner;
  late final int _presentation;
  late final CloudChatLaunch _launch;
  late final ChatController _chat;
  @override
  void initState() {
    super.initState();
    _owner = widget.navigation.owner!;
    _presentation = widget.navigation.presentation;
    _launch = widget.navigation.takeLaunch(
      owner: _owner,
      presentation: _presentation,
    );
    final id = widget.navigation.conversationId;
    _chat = ChatController(
      widget.repository,
      accountScope: widget.accountScope,
      conversation: id == null ? null : Conversation(id: id),
      initialImage: _launch.image,
    );
  }

  @override
  Widget build(BuildContext context) => ChatPage(
    controller: _chat,
    settings: widget.settings,
    exposed: widget.exposed,
    onOpenNavigation: widget.onOpenNavigation,
    createImageOnOpen: _launch.createImage,
    onConversationChanged: (id) {
      if (id != null) {
        widget.navigation.acknowledge(
          id,
          owner: _owner,
          presentation: _presentation,
        );
      }
    },
  );
}

class _CloudImagesDestination extends StatefulWidget {
  const _CloudImagesDestination({
    super.key,
    required this.repository,
    required this.accountScope,
    required this.onOpenNavigation,
    required this.onOpen,
    required this.onCreated,
  });
  final CloudRepository repository;
  final String accountScope;
  final VoidCallback onOpenNavigation;
  final ValueChanged<String> onCreated;
  final void Function(GalleryImage image, bool edit) onOpen;
  @override
  State<_CloudImagesDestination> createState() =>
      _CloudImagesDestinationState();
}

class _CloudImagesDestinationState extends State<_CloudImagesDestination> {
  bool _creating = false;
  late final _images = ImageController(
    ImageRepository(widget.repository.client),
  );

  Future<void> _create() async {
    if (_creating || !mounted || ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    _creating = true;
    final chat = ChatController(
      widget.repository,
      accountScope: widget.accountScope,
    );
    try {
      await chat.initialize();
      if (!mounted || ModalRoute.of(context)?.isCurrent != true) return;
      final accepted = await showCloudImageCreationSheet(
        context,
        controller: chat,
      );
      if (accepted == true && mounted && chat.composerReady) {
        final id = chat.conversation?.id;
        if (id != null) widget.onCreated(id);
      }
    } finally {
      chat.dispose();
      _creating = false;
    }
  }

  @override
  Widget build(BuildContext context) => ImageGalleryPage(
    controller: _images,
    repository: widget.repository,
    onOpenNavigation: widget.onOpenNavigation,
    onOpen: widget.onOpen,
    onCreate: _create,
  );
}
