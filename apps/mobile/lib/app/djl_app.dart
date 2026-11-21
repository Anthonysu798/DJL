import 'dart:async';
import '../features/remote_notifications/data/remote_push_native.dart';
import '../features/remote_notifications/data/remote_push_store.dart';
import '../features/remote_notifications/domain/remote_notification.dart';
import '../features/remote_notifications/presentation/remote_push_controller.dart';
import '../features/remote_notifications/presentation/remote_push_controls.dart';
import 'root_route.dart';
import 'cloud_navigation.dart';
import 'cloud_shell.dart';
import 'desktop_deep_link.dart';
import '../features/desktop/presentation/desktop_chat_page.dart';
import '../features/desktop/presentation/desktop_phone_drawer.dart';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart'
    show CupertinoAlertDialog, CupertinoDialogAction, CupertinoTextField;
import '../core/network/cloud_client.dart';
import '../core/presentation/cloud_chrome.dart';
import '../features/auth/presentation/auth_controller.dart';
import '../features/auth/presentation/auth_page.dart';
import '../features/auth/presentation/auth_welcome_page.dart';
import '../features/auth/data/social_identity.dart';
import '../features/chat/data/cloud_repository.dart';
import '../features/chat/domain/cloud_models.dart';
import '../features/conversations/presentation/conversation_controller.dart';
import '../features/conversations/presentation/cloud_chat_actions.dart';
import '../features/conversations/presentation/cloud_archived_chats_page.dart';
import 'djl_theme.dart';
import '../features/settings/data/settings_store.dart';
import '../features/settings/domain/device_owner_auth.dart';
import '../features/settings/presentation/settings_controller.dart';
import '../features/settings/presentation/cloud_settings_page.dart';
import '../features/settings/presentation/local_settings_page.dart';
import '../features/settings/presentation/app_lock_controller.dart';
import '../features/settings/presentation/privacy_shield.dart';
import 'cloud_deep_link.dart';
import '../features/reports/data/content_reporter.dart';
import '../features/account/data/account_repository.dart';
import '../features/account/presentation/account_controller.dart';
import '../features/account/presentation/account_page.dart';
import '../features/notifications/data/notification_repository.dart';
import '../features/notifications/presentation/notification_controller.dart';
import '../features/notifications/presentation/notification_banner.dart';
import '../features/notifications/domain/cloud_notification.dart';

import 'package:flutter/foundation.dart';
import '../features/desktop/presentation/desktop_controller.dart';
import '../features/pairing/data/pairing_repository.dart';
import '../features/pairing/presentation/pairing_page.dart';
import '../features/releases/presentation/whats_new_presenter.dart';
import '../features/status/domain/run_status.dart';
import '../features/status/data/status_surface.dart';
import '../features/status/presentation/status_coordinator.dart';
import '../features/status/presentation/status_permission_controls.dart';

class DjlApp extends StatefulWidget {
  const DjlApp({
    super.key,
    required this.client,
    this.linkStream,
    this.initialLink,
    this.settings,
    this.appLock,
    this.desktop,
    this.statusSurface,
    this.socialIdentity,
    this.remotePushNative,
    this.remotePushStore,
  });
  final CloudClient client;
  final RemotePushNative? remotePushNative;
  final RemotePushStore? remotePushStore;
  final SettingsController? settings;
  final AppLockController? appLock;
  final DesktopController? desktop;
  final StatusSurface? statusSurface;
  final SocialIdentitySource? socialIdentity;
  final Stream<Uri>? linkStream;
  final Future<Uri?>? initialLink;
  @override
  State<DjlApp> createState() => _DjlAppState();
}

class _DjlAppState extends State<DjlApp> with WidgetsBindingObserver {
  late final AuthController _auth;
  late final RemotePushController _remotePush;
  bool _notificationIntent = false, _receivedNotification = false;
  bool _remoteCloudEntered = false;
  DateTime? _lastOrdinaryLink, _notificationReceivedAt;
  int? _notificationNavigationRevision;
  late final DesktopController _desktop;
  late final ConversationController _history;
  late final CloudRepository _repository;
  late final ContentReporter _reporter = ContentReporter(widget.client);
  final _navigator = GlobalKey<NavigatorState>();
  late final SettingsController _settingsController;
  late final AppLockController _appLock;
  late final RunStatusProjector _runStatus;
  late final StatusCoordinator _statusCoordinator;
  String? _startupError;
  bool _preparingStartup = false;
  StreamSubscription<Uri>? _linkSubscription;
  String? _pendingCloudLink, _openConversationId, _linkError;
  int _linkRevision = 0;
  final _cloudNavigation = CloudNavigationController();
  NotificationController? _cloudInbox;
  String? _cloudInboxScope;
  bool _openingCloudAlert = false;
  bool _routingLink = false;
  AppSection _section = AppSection.myMacs;
  bool _routingDesktop = false;
  String? _launchConnection;
  DesktopLinkTarget? _receivedDesktopLink, _openDesktopTarget;
  Pairing? _receivedDesktopHost;
  int? _receivedSelectionRevision;
  int? _receivedNavigationRevision;
  int _desktopLinkRevision = 0, _displayedDesktopRevision = -1;
  bool _startupRestored = false;
  bool _foreground = true;
  bool _welcomeOptionsRequested = false;
  bool _desktopHistoryRestored = false;
  RootRoute get _currentRootRoute =>
      resolveRootRoute(_section, signedIn: _auth.signedIn);
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _settingsController =
        widget.settings ?? SettingsController(SharedSettingsStore());
    _desktop =
        widget.desktop ??
        DesktopController(
          PairingRepository(widget.client.credentials, allowLocal: kDebugMode),
          settings: _settingsController,
        );
    _appLock = widget.appLock ?? AppLockController(NativeDeviceOwnerAuth());
    final lifecycle =
        WidgetsBinding.instance.lifecycleState ?? AppLifecycleState.resumed;
    _foreground = lifecycle == AppLifecycleState.resumed;
    _appLock.lifecycle(lifecycle);
    _runStatus = RunStatusProjector();
    _statusCoordinator = StatusCoordinator(
      _runStatus,
      widget.statusSurface ?? const MethodChannelStatusSurface(),
    );
    _desktop.attachRunStatus(_runStatus);
    _desktop.setRoutingAllowed(false);
    _settingsController.addListener(_settingsChanged);
    _appLock.addListener(_lockChanged);
    _desktop.addListener(_desktopChanged);
    _cloudNavigation.addListener(_cloudNavigationChanged);
    _repository = CloudRepository(widget.client);
    _history = ConversationController(_repository);
    _auth =
        AuthController(
            widget.client,
            socialIdentity: widget.socialIdentity,
            clearCloudPreferences: _repository.clearCloudPreferences,
          )
          ..addListener(_authChanged)
          ..setSocialAllowed(false);
    _remotePush = RemotePushController(
      widget.client,
      widget.remotePushNative ?? MethodChannelRemotePush(),
      widget.remotePushStore ?? SharedRemotePushStore(),
    )..onTap = _receiveNotification;
    unawaited(_remotePush.initialize());
    final links = AppLinks();
    _linkSubscription = (widget.linkStream ?? links.uriLinkStream).listen(
      _receiveLink,
      onError: (Object _) {},
    );
    unawaited(_initialLink(widget.initialLink ?? links.getInitialLink()));
    unawaited(_auth.restore());
    unawaited(_prepareStartup());
  }

  Future<void> _prepareStartup() async {
    if (_preparingStartup) return;
    _preparingStartup = true;
    if (mounted) setState(() => _startupError = null);
    try {
      final restored = await Future.wait<Object?>([
        _settingsController.load().then((_) => null),
        _desktop.pairings.trusted(),
        _desktop.pairings.credentials.read('desktop.active'),
      ]);
      if (!mounted) return;
      if (!_settingsController.ready) {
        setState(() => _startupError = _settingsController.error);
        return;
      }
      final trusted = restored[1] as List<Pairing>;
      _desktop.restoreSelection(trusted, restored[2] as String?);
      // App authentication is disabled; retain only inactive-preview shielding.
      _appLock.initialize(
        enabled: false,
        hasProtectedContent: trusted.isNotEmpty,
      );
      // Chat cache restoration must not block secure callback recovery.
      unawaited(
        _desktop.restore().whenComplete(() {
          if (mounted) {
            _desktopHistoryRestored = true;
            _scheduleDesktopLink();
          }
        }),
      );
      _startupRestored = true;
      _syncRemoteContext();
      _syncSocialAllowance();
      _desktop.setRoutingAllowed(!_appLock.shielded);
      _scheduleDesktopLink();
      if (_pendingCloudLink != null) _scheduleCloudLink();
    } catch (error) {
      if (mounted) {
        setState(
          () => _startupError = error is FormatException
              ? 'Saved desktop connection details could not be read. Your saved connections have been kept.'
              : 'Could not restore saved Macs. Unlock your device and retry.',
        );
      }
    } finally {
      _preparingStartup = false;
    }
  }

  void _settingsChanged() {
    if (!mounted) return;
    _statusCoordinator.configure(
      settingsReady: _settingsController.ready,
      lockEnabled: _settingsController.lockEnabled,
    );
    if (_appLock.ready) _appLock.setEnabled(false);
    _syncRemoteContext();
    setState(() {});
  }

  void _desktopChanged() {
    _syncRemoteContext();
    _scheduleDesktopLink();
    if (_appLock.ready) {
      _appLock.setProtectedContent(
        _desktop.trusted.isNotEmpty || _desktop.active != null,
      );
    }
  }

  void _lockChanged() {
    if (!mounted) return;
    setState(() {});
    _syncSocialAllowance();
    _syncRemoteContext();
    _desktop.setRoutingAllowed(_startupRestored && !_appLock.shielded);
    if (!_appLock.shielded && _startupRestored) {
      _desktop.resume();
      _scheduleDesktopLink();
      if (_pendingCloudLink != null) _scheduleCloudLink();
    }
  }

  void _syncSocialAllowance() => _auth.setSocialAllowed(
    _startupRestored && _foreground && !_appLock.shielded,
  );

  void _scheduleWelcomeOptions(RootRoute route) {
    if (route != RootRoute.welcome) {
      _welcomeOptionsRequested = false;
      return;
    }
    if (_welcomeOptionsRequested ||
        !_startupRestored ||
        !_foreground ||
        _appLock.shielded) {
      return;
    }
    _welcomeOptionsRequested = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_currentRootRoute != RootRoute.welcome ||
          !_foreground ||
          _appLock.shielded) {
        _welcomeOptionsRequested = false;
        return;
      }
      unawaited(_auth.loadSocialProviders());
    });
  }

  Future<void> _initialLink(Future<Uri?> value) async {
    try {
      final uri = await value;
      if (mounted && _linkRevision == 0 && uri != null) _receiveLink(uri);
    } catch (_) {
      // Some platforms have no native link source; ordinary navigation remains available.
    }
  }

  void _enterRemoteCloudContext() {
    _remoteCloudEntered = true;
    _syncRemoteContext();
  }

  void _syncRemoteContext() {
    if (!mounted) return;
    final user = _auth.account?['user'];
    final userId = user is Map ? user['id'] : null;
    final org = _auth.account?['activeOrgId'];
    final pair = _desktop.active, host = _desktop.host;
    _remotePush.updateContext(
      allowed: _startupRestored && _foreground && !_appLock.shielded,
      cloudOwner:
          (_currentRootRoute == RootRoute.cloud || _remoteCloudEntered) &&
              _auth.signedIn &&
              userId is String &&
              userId.isNotEmpty &&
              org is String &&
              org.isNotEmpty
          ? '$userId:$org'
          : null,
      paired:
          pair != null &&
              host.live &&
              host.trusted &&
              host.device == pair.macDeviceId
          ? PairedPushOwner(
              '${pair.macDeviceId}:${pair.publicKey}:${host.session}:${host.connectionRevision}',
              (method, params) => _desktop.transport.request(method, params),
            )
          : null,
    );
    _syncCloudInbox(
      _auth.signedIn &&
              userId is String &&
              userId.isNotEmpty &&
              org is String &&
              org.isNotEmpty
          ? '$userId:$org'
          : null,
    );
  }

  void _syncCloudInbox(String? owner) {
    final scope = owner != null && _startupRestored && _settingsController.ready
        ? '$owner:${widget.client.revision}'
        : null;
    if (_cloudInboxScope != scope) {
      _cloudInbox?.removeListener(_cloudInboxChanged);
      _cloudInbox?.dispose();
      _cloudInboxScope = scope;
      _cloudInbox = scope == null
          ? null
          : NotificationController(NotificationRepository(widget.client));
      _cloudInbox?.addListener(_cloudInboxChanged);
      _cloudInboxChanged();
    }
    _cloudInbox?.configure(
      foreground: _foreground && !_appLock.shielded,
      alerts: _settingsController.inAppAlerts,
      activeConversation: _openConversationId,
    );
  }

  void _cloudInboxChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _openCloudAlert(
    NotificationController inbox,
    CloudNotification item,
  ) async {
    if (!identical(inbox, _cloudInbox) ||
        _openingCloudAlert ||
        !_foreground ||
        _appLock.shielded) {
      return;
    }
    _openingCloudAlert = true;
    final revision = _linkRevision;
    final sessionRevision = widget.client.revision;
    try {
      await inbox.markRead(item);
      if (!mounted ||
          !identical(inbox, _cloudInbox) ||
          !_auth.signedIn ||
          !_foreground ||
          _appLock.shielded ||
          sessionRevision != widget.client.revision ||
          revision != _linkRevision) {
        return;
      }
      inbox.dismissBanner();
      _receiveLink(
        Uri(
          scheme: 'djl',
          host: 'cloud',
          pathSegments: ['c', item.conversationId],
        ),
      );
    } finally {
      _openingCloudAlert = false;
    }
  }

  void _cancelNotificationIntent() {
    if (!_notificationIntent) return;
    _notificationIntent = false;
    _notificationReceivedAt = null;
    _notificationNavigationRevision = null;
    _receivedNotification = false;
    _receivedDesktopLink = null;
    _pendingCloudLink = null;
    _desktopLinkRevision++;
    _linkRevision++;
    _desktop.cancelNavigation();
  }

  bool _receiveNotification(RemoteNotificationTap tap) {
    if (!mounted ||
        _lastOrdinaryLink != null &&
            tap.receivedAt.isBefore(_lastOrdinaryLink!)) {
      return false;
    }
    _cancelNotificationIntent();
    _notificationIntent = true;
    _notificationReceivedAt = tap.receivedAt;
    _notificationNavigationRevision = null;
    if (tap.cloudUri != null) {
      _receiveLink(tap.cloudUri!, notification: true);
    } else if (tap.desktop != null) {
      _auth.cancelSocialSignIn();
      _linkRevision++;
      _desktopLinkRevision++;
      _receivedDesktopLink = tap.desktop;
      _receivedNotification = true;
      _receivedDesktopHost = null;
      _receivedSelectionRevision = null;
      _receivedNavigationRevision = _desktop.navigationRevision;
      _notificationNavigationRevision = _desktop.navigationRevision;
      _displayedDesktopRevision = -1;
      setState(() => _section = AppSection.myMacs);
      _cloudNavigationChanged();
      _scheduleDesktopLink();
    }
    return true; // Intake accepted, never an access or delivery acknowledgement.
  }

  bool _notificationExpired() {
    final received = _notificationReceivedAt;
    if (!_notificationIntent ||
        received == null ||
        DateTime.now().difference(received) <= const Duration(seconds: 300)) {
      return false;
    }
    _cancelNotificationIntent();
    return true;
  }

  void _receiveLink(Uri uri, {bool notification = false}) {
    if (!notification &&
        (DesktopLinkTarget.parse(uri) != null ||
            cloudConversationId(uri) != null)) {
      _lastOrdinaryLink = DateTime.now();
      _cancelNotificationIntent();
    }
    final desktopTarget = DesktopLinkTarget.parse(uri);
    if (mounted && desktopTarget != null) {
      _auth.cancelSocialSignIn();
      _linkRevision++;
      _desktopLinkRevision++;
      _receivedDesktopLink = desktopTarget;
      _receivedDesktopHost = _desktop.hasReconnectCandidate
          ? _desktop.active
          : null;
      _receivedSelectionRevision = _startupRestored
          ? _desktop.selectionRevision
          : null;
      _receivedNavigationRevision = _desktop.navigationRevision;
      if (_openDesktopTarget != desktopTarget) _displayedDesktopRevision = -1;
      setState(() => _section = AppSection.myMacs);
      _cloudNavigationChanged();
      _scheduleDesktopLink();
      return;
    }
    final id = cloudConversationId(uri);
    if (!mounted || id == null) return;
    setState(() => _section = AppSection.cloud);
    _cloudNavigationChanged();
    _linkRevision++;
    if (_linkError != null) setState(() => _linkError = null);
    if (_openConversationId == id) {
      _pendingCloudLink = null;
      return;
    }
    _pendingCloudLink = id;
    _scheduleCloudLink();
  }

  void _scheduleDesktopLink() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_routeDesktopLink());
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  Future<void> _routeDesktopLink() async {
    if (_routingDesktop ||
        !_desktop.automaticConnectionAllowed ||
        !_startupRestored ||
        !_desktopHistoryRestored ||
        _appLock.shielded ||
        _navigator.currentState == null) {
      return;
    }
    if (_notificationIntent &&
        _notificationNavigationRevision != null &&
        _notificationNavigationRevision != _desktop.navigationRevision) {
      // Drop only the stale notification, before expiry can cancel a newer intent.
      _notificationIntent = false;
      _notificationReceivedAt = null;
      _notificationNavigationRevision = null;
      if (_receivedNotification) {
        _receivedNotification = false;
        _receivedDesktopLink = null;
        _receivedDesktopHost = null;
        _receivedSelectionRevision = null;
        _receivedNavigationRevision = null;
      }
    }
    if (_notificationExpired()) return;
    _routingDesktop = true;
    final revision = _desktopLinkRevision;
    try {
      final received = _receivedDesktopLink;
      if (received != null) {
        _receivedDesktopLink = null;
        final notification = _receivedNotification;
        _receivedNotification = false;
        final current =
            _receivedNavigationRevision == _desktop.navigationRevision &&
            (notification ||
                _receivedSelectionRevision == null ||
                _receivedSelectionRevision == _desktop.selectionRevision);
        if (current) {
          if (notification || _openDesktopTarget != received) {
            _navigator.currentState!.popUntil((route) => route.isFirst);
          }
          _desktop.queueNavigation(
            received,
            forceHostChoice: notification,
            selectedHost: notification
                ? null
                : _receivedSelectionRevision == null
                ? _desktop.active
                : _receivedDesktopHost,
            useActive: false,
          );
          if (notification) {
            _notificationNavigationRevision = _desktop.navigationRevision;
          }
        }
        _receivedDesktopHost = null;
        _receivedSelectionRevision = null;
        _receivedNavigationRevision = null;
      }
      final route = _currentRootRoute;
      final pair = _desktop.active;
      if (route == RootRoute.myMacs &&
          !((_desktop.navigationTarget?.qualified == true ||
                  _desktop.navigationForcesHostChoice) &&
              _desktop.navigationNeedsHost) &&
          pair != null &&
          _desktop.hasReconnectCandidate &&
          _desktop.threadList.macDeviceId == pair.macDeviceId) {
        final context = '${pair.macDeviceId}:${pair.publicKey}';
        if (_launchConnection != context && !_desktop.busy) {
          _launchConnection = context;
          if (!_desktop.connected) await _desktop.connect(pair);
        }
      }
      if (!mounted ||
          _appLock.shielded ||
          !_desktop.automaticConnectionAllowed ||
          revision != _desktopLinkRevision) {
        return;
      }
      if (_currentRootRoute != RootRoute.myMacs) return;
      await _desktop.routeNavigation();
      if (!mounted ||
          _appLock.shielded ||
          !_desktop.automaticConnectionAllowed ||
          revision != _desktopLinkRevision) {
        return;
      }
      if (_currentRootRoute != RootRoute.myMacs) return;
      final target = _desktop.navigationDisplayTarget;
      if (target == null ||
          _desktop.thread?['id'] != target.thread ||
          _displayedDesktopRevision == _desktop.navigationRevision) {
        return;
      }
      _displayedDesktopRevision = _desktop.navigationRevision;
      _openDesktopTarget = target;
      _notificationIntent = false;
      _notificationReceivedAt = null;
      final navigator = _navigator.currentState!;
      navigator.popUntil((route) => route.isFirst);
      unawaited(
        navigator
            .push<void>(
              DesktopPhoneRoute(
                builder: (context) => DesktopChatPage(
                  controller: _desktop,
                  focusTarget: target,
                  onSettings: _desktopSettings,
                  onCloud: _desktopCloud,
                  runStatus: _runStatus,
                ),
              ),
            )
            .whenComplete(() {
              if (_openDesktopTarget == target) _openDesktopTarget = null;
            }),
      );
    } finally {
      _routingDesktop = false;
      if (mounted &&
          (revision != _desktopLinkRevision ||
              (_currentRootRoute == RootRoute.myMacs &&
                  _desktop.navigationNeedsAttempt))) {
        _scheduleDesktopLink();
      }
    }
  }

  void _scheduleCloudLink() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_routeCloudLink());
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  Future<void> _routeCloudLink() async {
    final id = _pendingCloudLink, navigator = _navigator.currentState;
    if (_section != AppSection.cloud ||
        _appLock.shielded ||
        _routingLink ||
        id == null ||
        !_auth.ready ||
        !_auth.signedIn ||
        navigator == null ||
        _linkError != null) {
      return;
    }
    if (_notificationExpired()) return;
    _routingLink = true;
    final revision = _linkRevision;
    try {
      if (_auth.account == null) await _auth.refreshAccount();
      if (!mounted ||
          _section != AppSection.cloud ||
          _appLock.shielded ||
          !_auth.signedIn ||
          revision != _linkRevision) {
        return;
      }
      if (_auth.account == null) {
        setState(
          () => _linkError =
              'Could not open the linked conversation. Check your connection and retry.',
        );
        return;
      }
      navigator.popUntil((route) => route.isFirst);
      final opened = await _open(
        navigator.context,
        conversation: Conversation(id: id),
      );
      if (opened && revision == _linkRevision) {
        _pendingCloudLink = null;
        _notificationIntent = false;
        _notificationReceivedAt = null;
      }
      if (!opened && mounted && revision == _linkRevision) {
        setState(
          () => _linkError =
              'Account details are still unavailable. Retry the linked conversation when they load.',
        );
      }
    } finally {
      _routingLink = false;
      if (mounted && revision != _linkRevision && _pendingCloudLink != null) {
        _scheduleCloudLink();
      }
    }
  }

  bool _wasSignedIn = false, _accountWasReady = false;
  String? get _cloudAccountScope {
    final user = _auth.account?['user'];
    final id = user is Map ? user['id'] : null;
    final org = _auth.account?['activeOrgId'];
    return _auth.signedIn &&
            id is String &&
            id.isNotEmpty &&
            org is String &&
            org.isNotEmpty
        ? '$id:$org'
        : null;
  }

  void _cloudNavigationChanged() {
    _openConversationId = _currentRootRoute == RootRoute.cloud
        ? _cloudNavigation.visibleConversationId
        : null;
    _syncRemoteContext();
  }

  void _authChanged() {
    final becameSignedIn = _auth.signedIn && !_wasSignedIn;
    final accountBecameReady = _auth.account != null && !_accountWasReady;
    if (_auth.signedIn && !_wasSignedIn) unawaited(_history.refresh());
    if (!_auth.signedIn && _wasSignedIn) {
      _remoteCloudEntered = false;
      final previousRoot = resolveRootRoute(_section, signedIn: true);
      final closeAccountRoutes =
          _openConversationId != null || previousRoot != RootRoute.myMacs;
      _history.clear();
      _pendingCloudLink = null;
      _openConversationId = null;
      _linkError = null;
      _linkRevision++;
      if (closeAccountRoutes) {
        _navigator.currentState?.popUntil((route) => route.isFirst);
      }
    }
    final scope = _cloudAccountScope;
    if (_cloudNavigation.bindOwner(
      scope == null ? null : '${widget.client.revision}:$scope',
    )) {
      _history.query = '';
      _history.archived = false;
      _history.clear();
      if (scope != null) unawaited(_history.refresh());
    }
    _cloudNavigationChanged();
    _wasSignedIn = _auth.signedIn;
    _accountWasReady = _auth.account != null;
    if (_auth.signedIn &&
        _pendingCloudLink != null &&
        (becameSignedIn || accountBecameReady)) {
      _linkError = null;
      _scheduleCloudLink();
    }
  }

  @override
  void dispose() {
    _cloudInbox?.removeListener(_cloudInboxChanged);
    _cloudInbox?.dispose();
    _remotePush.dispose();
    unawaited(_linkSubscription?.cancel());
    _auth.removeListener(_authChanged);
    _auth.dispose();
    _cloudNavigation.removeListener(_cloudNavigationChanged);
    _cloudNavigation.dispose();
    _history.dispose();
    _repository.modelSelection.dispose();
    widget.client.close();
    WidgetsBinding.instance.removeObserver(this);
    _desktop.removeListener(_desktopChanged);
    _desktop.attachRunStatus(null);
    _statusCoordinator.dispose();
    _runStatus.dispose();
    if (widget.desktop == null) _desktop.dispose();
    _settingsController.removeListener(_settingsChanged);
    _appLock.removeListener(_lockChanged);
    if (widget.settings == null) _settingsController.dispose();
    if (widget.appLock == null) _appLock.dispose();
    super.dispose();
  }

  Future<bool> _open(
    BuildContext context, {
    Conversation? conversation,
    Json? initialImage,
    bool createImage = false,
  }) async {
    if (_appLock.shielded) return false;
    final revision = widget.client.revision;
    if (_auth.account == null) await _auth.refreshAccount();
    if (!context.mounted ||
        _appLock.shielded ||
        !_auth.signedIn ||
        revision != widget.client.revision) {
      return false;
    }
    final user = _auth.account?['user'] as Json?;
    final userId = user?['id'] as String?,
        orgId = _auth.account?['activeOrgId'] as String?;
    if (userId == null || orgId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Account details are still loading. Please try again.'),
        ),
      );
      return false;
    }
    if (conversation == null) {
      _cloudNavigation.newChat(createImage: createImage);
    } else {
      _cloudNavigation.open(conversation.id, image: initialImage);
    }
    return true;
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: _navigator,
    title: 'DJL',
    debugShowCheckedModeBanner: false,
    theme: djlTheme(
      Brightness.light,
      font: _settingsController.font,
      liquidGlass: _settingsController.liquidGlass,
    ),
    darkTheme: djlTheme(
      Brightness.dark,
      font: _settingsController.font,
      liquidGlass: _settingsController.liquidGlass,
    ),
    themeMode: _settingsController.theme,
    themeAnimationDuration:
        (MediaQuery.maybeOf(context)?.disableAnimations ??
            WidgetsBinding
                .instance
                .platformDispatcher
                .accessibilityFeatures
                .disableAnimations)
        ? Duration.zero
        : kThemeAnimationDuration,
    builder: (context, child) => ContentReportScope(
      reporter: _reporter,
      child: PrivacyShield(
        controller: _appLock,
        startupError: _startupError,
        onRetry: _prepareStartup,
        child: Overlay.wrap(
          child: Stack(
            fit: StackFit.expand,
            children: [
              child!,
              if (_cloudInbox case final inbox?)
                if (inbox.banner case final item?)
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: SafeArea(
                      bottom: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                        child: CloudNotificationBanner(
                          item: item,
                          onOpen: () => unawaited(_openCloudAlert(inbox, item)),
                          onDismiss: inbox.dismissBanner,
                        ),
                      ),
                    ),
                  ),
            ],
          ),
        ),
      ),
    ),
    home: ListenableBuilder(
      listenable: Listenable.merge([_auth, _desktop]),
      builder: (context, _) {
        if (_section == AppSection.cloud && !_auth.ready) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final route = _currentRootRoute;
        _scheduleWelcomeOptions(route);
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _syncRemoteContext(),
        );
        return switch (route) {
          RootRoute.cloud => _home(context),
          RootRoute.welcome => _welcome(context),
          RootRoute.myMacs => WhatsNewPresenter(
            store: _settingsController.store,
            isAllowed: () =>
                _startupRestored &&
                !_appLock.shielded &&
                _currentRootRoute == RootRoute.myMacs &&
                !_routingDesktop &&
                !_routingLink &&
                _desktop.navigationTarget == null &&
                !_desktop.busy &&
                _desktop.error == null &&
                _desktop.turnId == null &&
                _desktop.approvals.isEmpty &&
                _desktop.threadList.data.responseChanges.running.isEmpty,
            child: PairingPage(
              controller: _desktop,
              onSettings: _desktopSettings,
              onCloud: _desktopCloud,
              runStatus: _runStatus,
            ),
          ),
        };
      },
    ),
  );
  Widget _welcome(BuildContext context) => AuthWelcomePage(
    controller: _auth,
    onEmail: () {
      _auth.cancelSocialSignIn();
      Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => AuthPage(controller: _auth)),
      );
    },
    onPair: () => _pair(context),
  );
  Widget _home(BuildContext context) => CloudShell(
    key: ValueKey(_cloudNavigation.owner),
    navigation: _cloudNavigation,
    history: _history,
    repository: _repository,
    settings: _settingsController,
    accountScope: _cloudAccountScope,
    contentAllowed: _startupRestored && !_appLock.shielded,
    inbox: _cloudInbox,
    settingsPage: _settingsPage,
    onRemote: () => _pair(context),
    onAction: (item, action, anchor) =>
        _historyAction(context, item, action, anchor),
    onRefreshProfile: () => _auth.refreshAccount(),
    linkError: _linkError,
    onRetryLink: () {
      setState(() => _linkError = null);
      _scheduleCloudLink();
    },
  );
  Future<void> _historyAction(
    BuildContext context,
    Conversation item,
    String action,
    Rect anchor,
  ) async {
    final owner = _cloudNavigation.owner;
    final revision = widget.client.revision;
    bool current() =>
        mounted &&
        _auth.signedIn &&
        owner != null &&
        owner == _cloudNavigation.owner &&
        revision == widget.client.revision;
    if (!current()) return;
    switch (action) {
      case 'pin':
        await _history.update(item, {'pinned': !item.pinned});
      case 'archive':
        if (_cloudNavigation.conversationId == item.id) {
          _cloudNavigation.newChat();
        }
        await _history.update(item, {'archived': true});
      case 'rename':
        final title = await showDialog<String>(
          context: context,
          builder: (_) => _RenameCloudChatDialog(title: item.displayTitle),
        );
        if (current() && title?.isNotEmpty == true) {
          await _history.update(item, {'title': title});
        }
      case 'delete':
        final confirmed = await showCloudChatDeleteConfirmation(
          context,
          anchor,
        );
        if (current() && confirmed == true) {
          if (_cloudNavigation.conversationId == item.id) {
            _cloudNavigation.newChat();
          }
          await _history.delete(item);
        }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _appLock.lifecycle(state);
    _syncRemoteContext();
    _syncSocialAllowance();
    if (state == AppLifecycleState.resumed) {
      unawaited(_remotePush.refresh());
      if (_startupRestored && !_appLock.shielded) _desktop.resume();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _desktop.suspend();
    }
  }

  void _pair(BuildContext context) {
    _auth.cancelSocialSignIn();
    _navigator.currentState?.popUntil((route) => route.isFirst);
    setState(() => _section = AppSection.myMacs);
    _cloudNavigationChanged();
    _scheduleDesktopLink();
  }

  void _desktopCloud() {
    _navigator.currentState?.popUntil((route) => route.isFirst);
    setState(() => _section = AppSection.cloud);
    _cloudNavigationChanged();
  }

  void _desktopSettings() {
    final context = _navigator.currentState?.overlay?.context;
    if (context != null) _localSettings(context);
  }

  void _localSettings(BuildContext context) {
    Navigator.push<void>(
      context,
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (coverContext) => ListenableBuilder(
          listenable: _auth,
          builder: (context, _) {
            final user = _auth.account?['user'];
            final email = user is Map ? user['email'] : null;
            return LocalSettingsPage(
              controller: _settingsController,
              desktop: _desktop,
              signedIn: _auth.signedIn,
              email: email is String && email.isNotEmpty ? email : null,
              remoteNotifications: RemotePushControls(
                controller: _remotePush,
                onCloudEntry: _enterRemoteCloudContext,
              ),
              taskStatus: StatusPermissionControls(
                backend: _statusCoordinator.surface is StatusPermissionBackend
                    ? _statusCoordinator.surface as StatusPermissionBackend
                    : null,
                onRetry: _statusCoordinator.retryAvailability,
              ),
              onCloud: () {
                if (!coverContext.mounted ||
                    ModalRoute.of(coverContext)?.isCurrent != true) {
                  return;
                }
                _desktopCloud();
              },
              onMyMacs: () {
                if (!coverContext.mounted ||
                    ModalRoute.of(coverContext)?.isCurrent != true) {
                  return;
                }
                _navigator.currentState?.popUntil((route) => route.isFirst);
              },
            );
          },
        ),
      ),
    );
  }

  Widget _settingsPage(
    BuildContext settingsContext,
    VoidCallback onOpenNavigation,
  ) {
    final user = _auth.account?['user'];
    final email = user is Map ? user['email'] : null;
    return CloudSettingsPage(
      client: widget.client,
      settings: _settingsController,
      push: _remotePush,
      onOpenNavigation: onOpenNavigation,
      email: email is String && email.isNotEmpty ? email : null,
      onAccount: () {
        final account = AccountController(AccountRepository(widget.client));
        showModalBottomSheet<void>(
          context: settingsContext,
          useRootNavigator: true,
          isScrollControlled: true,
          useSafeArea: true,
          showDragHandle: false,
          barrierColor: Colors.black.withValues(alpha: .18),
          backgroundColor: cloudGroupedBackground(settingsContext),
          clipBehavior: Clip.antiAlias,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(38)),
          ),
          constraints: BoxConstraints(
            maxHeight:
                MediaQuery.sizeOf(settingsContext).height -
                MediaQuery.viewPaddingOf(settingsContext).top,
          ),
          builder: (sheetContext) => AccountPage(
            controller: account,
            onSignOut: _auth.signOut,
            onMyMacs: () => _pair(sheetContext),
          ),
        );
      },
      onArchived: () => Navigator.push<void>(
        settingsContext,
        MaterialPageRoute<void>(
          builder: (_) => CloudArchivedChatsPage(
            repository: _repository,
            onRestored: () => _history.refresh(),
          ),
        ),
      ),
      onRemote: () => _pair(settingsContext),
      onEnableBackgroundAlerts: () {
        _enterRemoteCloudContext();
        _remotePush.setEnabled(true);
      },
    );
  }
}

class _RenameCloudChatDialog extends StatefulWidget {
  const _RenameCloudChatDialog({required this.title});
  final String title;
  @override
  State<_RenameCloudChatDialog> createState() => _RenameCloudChatDialogState();
}

class _RenameCloudChatDialogState extends State<_RenameCloudChatDialog> {
  late final _text = TextEditingController(text: widget.title);
  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CupertinoAlertDialog(
    title: const Text('Rename chat'),
    content: Padding(
      padding: const EdgeInsets.only(top: 12),
      child: CupertinoTextField(
        controller: _text,
        autofocus: true,
        maxLength: 200,
        placeholder: 'Title',
      ),
    ),
    actions: [
      CupertinoDialogAction(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      CupertinoDialogAction(
        onPressed: () => Navigator.pop(context, _text.text.trim()),
        child: const Text('Save'),
      ),
    ],
  );
}
