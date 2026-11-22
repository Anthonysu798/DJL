import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/cloud_client.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../remote_notifications/presentation/remote_push_controller.dart';
import 'settings_controller.dart';
import 'settings_group.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

class CloudSettingsPage extends StatefulWidget {
  const CloudSettingsPage({
    super.key,
    required this.client,
    required this.settings,
    required this.push,
    required this.onAccount,
    required this.onArchived,
    required this.onRemote,
    required this.onEnableBackgroundAlerts,
    this.email,
    this.onOpenNavigation,
  });
  final CloudClient client;
  final SettingsController settings;
  final RemotePushController push;
  final String? email;
  final VoidCallback? onOpenNavigation;
  final VoidCallback onAccount, onArchived, onRemote, onEnableBackgroundAlerts;
  @override
  State<CloudSettingsPage> createState() => _CloudSettingsPageState();
}

class _CloudSettingsPageState extends State<CloudSettingsPage>
    with WidgetsBindingObserver {
  static const _appInfo = MethodChannel('djl.mobile/app-info');
  String? _credits, _error, _version;
  Map<String, Uri> _policies = {};
  bool _pushConfigured = false, _loading = false;
  int _generation = 0;
  late final int _revision;
  bool _current(int generation) =>
      mounted &&
      generation == _generation &&
      widget.client.revision == _revision;

  @override
  void initState() {
    super.initState();
    _revision = widget.client.revision;
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    unawaited(_loadVersion());
  }

  Future<void> _loadVersion() async {
    try {
      final version = await _appInfo.invokeMethod<String>('version');
      if (mounted && widget.client.revision == _revision) {
        setState(() => _version = version);
      }
    } on PlatformException {
      // The source uses an em dash if bundle metadata is unavailable.
    } on MissingPluginException {
      // The installed native app supplies this; widget tests may omit it.
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Future.wait([
        widget.client.request('GET', 'v1/credits'),
        widget.client.request('GET', 'v1/client-config', authenticated: false),
      ]);
      if (!_current(generation)) return;
      final display = result[0]['display'];
      final rawPolicies = result[1]['policyUrls'];
      setState(() {
        _credits = display is Map && display['total'] is String
            ? display['total'] as String
            : null;
        _pushConfigured = result[1]['pushConfigured'] == true;
        _policies = {
          if (rawPolicies is Map)
            for (final name in ['terms', 'privacy'])
              if (_policy(rawPolicies[name]) case final Uri uri) name: uri,
        };
      });
    } catch (_) {
      if (_current(generation)) {
        setState(() => _error = context.l10n.settingsCloudRefreshFailed);
      }
    } finally {
      if (_current(generation)) setState(() => _loading = false);
    }
  }

  Uri? _policy(Object? value) {
    if (value is! String) return null;
    final uri = Uri.tryParse(value.trim());
    return uri != null &&
            {'https', 'http'}.contains(uri.scheme) &&
            uri.hasAuthority &&
            uri.host.isNotEmpty &&
            uri.userInfo.isEmpty
        ? uri
        : null;
  }

  Future<void> _openPolicy(Uri uri) async {
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      /* Keep the source destination available for retry. */
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(context.l10n.settingsLinkFailed)));
    }
  }

  Future<void> _openNotificationSettings() async {
    var opened = false;
    try {
      opened =
          await _appInfo.invokeMethod<bool>('openNotificationSettings') ??
          false;
    } on PlatformException {
      // Keep the action available if the OS cannot open Settings.
    } on MissingPluginException {
      // Android does not expose a Cloud APNs enrollment action.
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.settingsOpenNotificationsFailed)),
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _generation++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.settings, widget.push]),
    builder: (context, _) {
      final settings = widget.settings;
      final enabled = settings.ready && !settings.saving;
      final colors = Theme.of(context).colorScheme;
      final permission = widget.push.state;
      final l10n = context.l10n;
      final backgroundAlerts = !_pushConfigured || !permission.available
          ? 'Unavailable'
          : permission.permission == 'denied'
          ? 'Off'
          : permission.alerts && widget.push.enabled
          ? 'Enabled'
          : 'Not enabled';
      final backgroundAlertsLabel = switch (backgroundAlerts) {
        'Unavailable' => l10n.settingsAlertsUnavailable,
        'Off' => l10n.settingsAlertsOff,
        'Enabled' => l10n.settingsAlertsEnabled,
        _ => l10n.settingsAlertsNotEnabled,
      };
      Widget action(
        String label,
        IconData? icon,
        VoidCallback onTap, {
        Key? key,
        bool disclosure = false,
        bool tinted = false,
      }) => ListTile(
        key: key,
        minTileHeight: 52,
        minVerticalPadding: 16,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        leading: icon == null
            ? null
            : Icon(icon, size: 22, color: cloudActionColor(context)),
        title: Text(
          label,
          style: cloudBodyStyle.copyWith(
            color: tinted ? cloudActionColor(context) : colors.onSurface,
          ),
        ),
        trailing: disclosure
            ? Icon(
                DjlIcons.chevronRight,
                size: 15,
                color: colors.onSurfaceVariant,
              )
            : null,
        onTap: onTap,
      );
      Widget value(String label, String text) =>
          CloudValueRow(label: label, value: text);
      Widget toggle(
        String id,
        String label,
        bool selected,
        ValueChanged<bool> change,
      ) => MergeSemantics(
        key: Key('cloud.settings.$id'),
        child: ListTile(
          minTileHeight: 52,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16),
          enabled: enabled,
          title: Text(label, style: cloudBodyStyle),
          onTap: enabled ? () => change(!selected) : null,
          trailing: CloudSwitch(
            value: selected,
            onChanged: enabled ? change : null,
          ),
        ),
      );
      return Scaffold(
        backgroundColor: colors.brightness == Brightness.dark
            ? Colors.black
            : colors.surfaceContainerLow,
        body: CustomScrollView(
          slivers: [
            CloudLargeNavigationBar(
              title: l10n.settingsTitle,
              leading: CloudNavigationButton(
                icon: widget.onOpenNavigation == null
                    ? DjlIcons.back
                    : DjlIcons.menu,
                label: widget.onOpenNavigation == null
                    ? l10n.settingsBack
                    : l10n.settingsOpenNavigation,
                onPressed:
                    widget.onOpenNavigation ??
                    () => Navigator.maybePop(context),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              sliver: SliverList.list(
                children: [
                  if (_loading) const LinearProgressIndicator(),
                  if (_error != null)
                    ListTile(
                      title: Text(_error!),
                      trailing: TextButton(
                        onPressed: _load,
                        child: Text(l10n.settingsRetry),
                      ),
                    ),
                  SettingsGroup(
                    title: l10n.settingsAccount,
                    dividerIndent: 56,
                    children: [
                      action(
                        widget.email ?? l10n.settingsDjlAccount,
                        DjlIcons.account,
                        widget.onAccount,
                        key: const Key('cloud.settings.account'),
                        tinted: true,
                      ),
                      if (_credits != null)
                        value(l10n.settingsAvailableCredits, _credits!),
                    ],
                  ),
                  SettingsGroup(
                    title: l10n.settingsAppearance,
                    children: [
                      SettingsMenuRow<ThemeMode>(
                        key: const Key('theme-setting'),
                        label: l10n.settingsTheme,
                        valueLabel: switch (settings.theme) {
                          ThemeMode.system => l10n.settingsThemeSystem,
                          ThemeMode.light => l10n.settingsThemeLight,
                          ThemeMode.dark => l10n.settingsThemeDark,
                        },
                        value: settings.theme,
                        options: {
                          ThemeMode.system: l10n.settingsThemeSystem,
                          ThemeMode.light: l10n.settingsThemeLight,
                          ThemeMode.dark: l10n.settingsThemeDark,
                        },
                        onChanged: enabled ? settings.setTheme : null,
                      ),
                    ],
                  ),
                  SettingsGroup(
                    title: l10n.settingsConversations,
                    dividerIndent: 56,
                    children: [
                      action(
                        l10n.settingsArchivedChatsRow,
                        DjlIcons.archive,
                        widget.onArchived,
                        disclosure: true,
                      ),
                      action(
                        l10n.settingsRemoteAccess,
                        DjlIcons.laptop,
                        widget.onRemote,
                        tinted: true,
                      ),
                    ],
                  ),
                  SettingsGroup(
                    title: l10n.settingsNotifications,
                    children: [
                      toggle(
                        'In-app alerts',
                        l10n.settingsInAppAlerts,
                        settings.inAppAlerts,
                        settings.setInAppAlerts,
                      ),
                      value(
                        l10n.settingsBackgroundAlerts,
                        backgroundAlertsLabel,
                      ),
                      if (backgroundAlerts == 'Not enabled')
                        TextButton(
                          onPressed: widget.push.busy
                              ? null
                              : widget.onEnableBackgroundAlerts,
                          child: Text(l10n.settingsEnableBackgroundAlerts),
                        ),
                      if (backgroundAlerts == 'Off')
                        TextButton(
                          onPressed: _openNotificationSettings,
                          child: Text(l10n.settingsOpenNotificationSettings),
                        ),
                    ],
                  ),
                  SettingsGroup(
                    title: l10n.settingsVoice,
                    children: [
                      toggle(
                        'Speak new replies',
                        l10n.settingsSpeakReplies,
                        settings.spokenReplies,
                        settings.setSpokenReplies,
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 14,
                        ),
                        child: Text(
                          Theme.of(context).platform == TargetPlatform.iOS
                              ? l10n.settingsVoiceIos
                              : l10n.settingsVoiceDevice,
                          style: cloudBodyStyle.copyWith(
                            fontSize: 13,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                  SettingsGroup(
                    title: l10n.settingsAbout,
                    children: [
                      value(l10n.settingsVersion, _version ?? '—'),
                      if (_policies['terms'] case final Uri uri)
                        action(
                          l10n.settingsTerms,
                          null,
                          () => _openPolicy(uri),
                          tinted: true,
                        ),
                      if (_policies['privacy'] case final Uri uri)
                        action(
                          l10n.settingsPrivacy,
                          null,
                          () => _openPolicy(uri),
                          tinted: true,
                        ),
                    ],
                  ),
                  if (settings.error != null)
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        settings.error!,
                        style: TextStyle(color: colors.error),
                      ),
                    ),
                  const SafeArea(top: false, child: SizedBox.shrink()),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}
