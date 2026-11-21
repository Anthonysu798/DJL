import 'dart:async';
import 'dart:ui' show ImageFilter, SemanticsRole;
import 'dart:math' as math;
import '../../../core/presentation/djl_glass.dart';
import '../../settings/presentation/settings_group.dart';
import 'package:flutter/cupertino.dart'
    show CupertinoActivityIndicator, CupertinoButton;
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LogicalKeyboardKey;
import 'package:flutter/semantics.dart' show CustomSemanticsAction;
import 'package:flutter_svg/flutter_svg.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../desktop/presentation/desktop_controller.dart';
import '../../host/presentation/host_controls.dart';
import '../../settings/presentation/device_name_sheet.dart';
import '../../settings/domain/appearance.dart';
import '../../desktop/presentation/desktop_chat_page.dart';
import '../../desktop/presentation/desktop_phone_drawer.dart';
import '../../desktop/presentation/desktop_navigation_menu.dart';
import '../../status/domain/run_status.dart';
import '../../desktop/presentation/desktop_overview.dart';
import '../../workspace/data/workspace_repository.dart';
import '../../workspace/presentation/project_picker_page.dart';
import '../data/pairing_repository.dart';
import 'device_recency_text.dart';
import 'device_visibility_switch.dart';

import '../../../core/design/djl_icons.dart';
import '../../groups/presentation/groups_controller.dart';
import '../../../core/design/djl_tokens.dart';
part 'pairing_entries.dart';
part 'connections_sheet.dart';

Future<void> _selectSavedDevice(
  BuildContext context,
  DesktopController desktop,
  Pairing pair,
) async {
  if (desktop.busy) return;
  if (!desktop.connected || desktop.isActiveDevice(pair)) {
    await desktop.selectSaved(pair);
    return;
  }
  final intent = desktop.prepareSavedSwitch(pair);
  if (intent == null) return;
  var confirmed = false;
  if (desktop.switchNeedsConfirmation) {
    confirmed =
        await showDialog<bool>(
          context: context,
          barrierColor: Colors.transparent,
          builder: (context) {
            final theme = Theme.of(context), colors = theme.colorScheme;
            final style = TextStyle(
              fontFamily: theme.platform == TargetPlatform.iOS
                  ? 'CupertinoSystemText'
                  : 'Roboto',
              fontSize: 17,
              fontWeight: FontWeight.w600,
              height: 20.333 / 17,
              letterSpacing: 0,
              color: colors.onSurface,
            );
            return Dialog(
              backgroundColor: Colors.transparent,
              surfaceTintColor: Colors.transparent,
              shadowColor: Colors.transparent,
              elevation: 0,
              insetPadding: const EdgeInsets.all(16),
              constraints: const BoxConstraints.tightFor(width: 240),
              child: DjlGlassSurface(
                radius: 34,
                useNativeView: false,
                child: Material(
                  key: const Key('saved_switch_review'),
                  color: colors.surfaceContainerLow.withValues(
                    alpha: colors.brightness == Brightness.dark ? .85 : .70,
                  ),
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(34),
                    side: BorderSide(
                      color: Colors.white.withValues(
                        alpha: colors.brightness == Brightness.dark ? .14 : .65,
                      ),
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(30, 22, 30, 0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Semantics(
                                header: true,
                                child: Text('Switch device?', style: style),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'DJL will try to stop in-progress runs on this Mac and reload chats for the other device.',
                                style: style.copyWith(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w400,
                                  height: 19.333 / 15,
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 20.333),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        child: SizedBox(
                          width: double.infinity,
                          child: TextButton(
                            onPressed: () => Navigator.pop(context, true),
                            style: TextButton.styleFrom(
                              foregroundColor: DjlColors.of(context).danger,
                              backgroundColor: colors.onSurface.withValues(
                                alpha: colors.brightness == Brightness.dark
                                    ? .10
                                    : .14,
                              ),
                              minimumSize: const Size(0, 48),
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 12,
                              ),
                              shape: const StadiumBorder(),
                              textStyle: style,
                            ),
                            child: const Text('Switch'),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ) ==
        true;
    if (!context.mounted || !confirmed) return;
  }
  await desktop.switchSaved(intent, confirmed: confirmed);
}

class _DeviceSwitchOverlay extends StatelessWidget {
  const _DeviceSwitchOverlay({required this.desktop, required this.onCancel});
  final DesktopController desktop;
  final VoidCallback onCancel;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final cancel = desktop.cancellingSwitch ? null : onCancel;
    return ColoredBox(
      color: Colors.black.withValues(alpha: .12),
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 20),
          child: IntrinsicWidth(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: ColoredBox(
                  key: const Key('device_switch_progress'),
                  color: colors.surfaceContainerLow.withValues(alpha: .9),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 20,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ExcludeSemantics(
                          child: CupertinoActivityIndicator(
                            radius: 10,
                            animating: !MediaQuery.disableAnimationsOf(context),
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Semantics(
                          header: true,
                          liveRegion: true,
                          child: Text(
                            desktop.cancellingSwitch
                                ? 'Cancelling switch…'
                                : 'Switching device…',
                            textAlign: TextAlign.center,
                            style: settingsTextStyle(
                              context,
                              14,
                              weight: FontWeight.w600,
                              color: colors.onSurface,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          desktop.deviceName(desktop.switchingDevice!.pairing),
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: settingsTextStyle(
                            context,
                            11,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Semantics(
                          label: 'Cancel switch',
                          excludeSemantics: true,
                          button: true,
                          enabled: cancel != null,
                          onTap: cancel,
                          child: CupertinoButton(
                            padding: EdgeInsets.zero,
                            minimumSize: const Size(44, 44),
                            onPressed: cancel,
                            child: Text(
                              'Cancel',
                              style: settingsTextStyle(
                                context,
                                15,
                                weight: FontWeight.w500,
                                color: colors.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PairingPage extends StatefulWidget {
  const PairingPage({
    super.key,
    required this.controller,
    this.onCloud,
    this.onSettings,
    this.runStatus,
  });
  final DesktopController controller;
  final RunStatusProjector? runStatus;
  final VoidCallback? onCloud, onSettings;
  @override
  State<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends State<PairingPage> {
  String _payload = '', _code = '';
  late final _groups = GroupsController(DesktopGroupsLink(widget.controller));

  @override
  void dispose() {
    _groups.dispose();
    super.dispose();
  }

  String _relay = defaultRelayUrl();

  bool get _canAdd => widget.controller.canEnterManualPairing;

  Future<String?> _pair(String text) async {
    if (!_canAdd) return null;
    try {
      await widget.controller.pair(text);
      return widget.controller.error;
    } catch (e) {
      return e.toString();
    }
  }

  Future<void> _scan() async {
    if (!_canAdd) return;
    widget.controller.pauseForManualPairing();
    final code = await Navigator.push<String>(
      context,
      MaterialPageRoute(builder: (_) => const _ScannerPage()),
    );
    if (!mounted) return;
    if (code == _ScannerPage.pasteFallback) {
      await _secureDetails();
    } else if (code != null && _canAdd) {
      final error = await _pair(code);
      if (mounted && error != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error)));
      }
    }
  }

  Future<void> _connections() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: false,
      builder: (_) => _ConnectionsSheet(desktop: widget.controller),
    );
    if (!mounted || !_canAdd) return;
    if (action == 'scan') await _scan();
    if (action == 'code') await _pairWithCode();
  }

  Future<void> _secureDetails() async {
    if (!_canAdd) return;
    widget.controller.pauseForManualPairing();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => _SecurePairingSheet(
        desktop: widget.controller,
        initialPayload: _payload,
        initialRelay: _relay,
        onPayloadChanged: (value) {
          if (mounted) _payload = value;
        },
        onRelayChanged: (value) {
          if (mounted) _relay = value;
        },
        onPair: _pair,
      ),
    );
  }

  Future<void> _pairWithCode() async {
    if (!_canAdd) return;
    widget.controller.pauseForManualPairing();
    final action = await showDialog<String>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: .42),
      animationStyle: MediaQuery.disableAnimationsOf(context)
          ? AnimationStyle.noAnimation
          : null,
      builder: (_) => _PairingCodeDialog(
        desktop: widget.controller,
        initialCode: _code,
        relay: _relay,
        onChanged: (value) {
          if (mounted) _code = value;
        },
      ),
    );
    if (mounted && action == 'relay' && _canAdd) {
      await _secureDetails();
      if (mounted && _canAdd) await _pairWithCode();
    }
  }

  bool _openingChat = false, _navigationOpen = false;
  final _drawer = GlobalKey<DesktopPhoneDrawerState>();

  Future<void> _chat(
    Map<String, dynamic>? thread, {
    String? cwd,
    DesktopDraftSource? source,
  }) async {
    if (_openingChat ||
        ModalRoute.of(context)?.isCurrent != true ||
        widget.controller.navigationTarget != null) {
      return;
    }
    _drawer.currentState?.close();
    _openingChat = true;
    final controller = widget.controller;
    final pair = controller.active,
        revision = controller.navigationRevision,
        selection = controller.selectionRevision,
        data = controller.threadList.data;
    bool current() =>
        mounted &&
        ModalRoute.of(context)?.isCurrent == true &&
        controller.active?.macDeviceId == pair?.macDeviceId &&
        controller.active?.data['macIdentityPublicKey'] ==
            pair?.data['macIdentityPublicKey'] &&
        controller.navigationRevision == revision &&
        controller.selectionRevision == selection &&
        identical(data, controller.threadList.data);
    try {
      DesktopNewChatDraft? draft;
      if (thread == null) {
        draft = controller.beginNewChatDraft(cwd: cwd, source: source);
        if (draft == null) return;
      } else {
        await controller.openThread(thread, isCurrent: current);
      }
      if (mounted &&
          (draft != null
              ? controller.isCurrentNewChatDraft(draft)
              : current() && controller.thread != null)) {
        await _showChat(controller, draft: draft);
      }
    } finally {
      _openingChat = false;
    }
  }

  Future<void> _showChat(
    DesktopController controller, {
    DesktopNewChatDraft? draft,
  }) => Navigator.push<void>(
    context,
    DesktopPhoneRoute(
      builder: (_) => DesktopChatPage(
        controller: controller,
        draft: draft,
        onSettings: widget.onSettings,
        onCloud: widget.onCloud,
        runStatus: widget.runStatus,
      ),
    ),
  );

  Future<void> _startChat({String? cwd}) async {
    final desktop = widget.controller;
    if (_openingChat ||
        !desktop.runtimeReady ||
        desktop.navigationTarget != null ||
        ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    _drawer.currentState?.close();
    _openingChat = true;
    final pair = desktop.active,
        navigation = desktop.navigationRevision,
        selection = desktop.selectionRevision,
        connection = desktop.transport.connectionRevision,
        data = desktop.threadList.data,
        sourceThread = desktop.thread?['id'];
    String? created;
    bool current() =>
        mounted &&
        ModalRoute.of(context)?.isCurrent == true &&
        desktop.active?.macDeviceId == pair?.macDeviceId &&
        desktop.active?.publicKey == pair?.publicKey &&
        desktop.navigationRevision == navigation &&
        desktop.selectionRevision == selection &&
        desktop.transport.connectionRevision == connection &&
        identical(desktop.threadList.data, data) &&
        desktop.thread?['id'] == (created ?? sourceThread);
    try {
      final opened = await desktop.createThread(
        cwd: cwd,
        canSelect: current,
        onCreated: (id) => created = id,
      );
      if (opened && current()) await _showChat(desktop);
    } finally {
      _openingChat = false;
    }
  }

  Future<void> _project() async {
    if (_openingChat ||
        !widget.controller.runtimeReady ||
        widget.controller.navigationTarget != null ||
        ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    _openingChat = true;
    final desktop = widget.controller, pair = widget.controller.active;
    final revision = desktop.navigationRevision,
        selection = desktop.selectionRevision,
        connection = desktop.transport.connectionRevision,
        data = desktop.threadList.data,
        selectedThread = desktop.thread?['id'];
    String? path;
    try {
      path = await showProjectPicker(
        context,
        repository: ProjectRepository(desktop.transport),
      );
    } finally {
      _openingChat = false;
    }
    if (path != null &&
        mounted &&
        desktop.navigationRevision == revision &&
        desktop.selectionRevision == selection &&
        desktop.transport.connectionRevision == connection &&
        identical(desktop.threadList.data, data) &&
        desktop.thread?['id'] == selectedThread &&
        ModalRoute.of(context)?.isCurrent == true &&
        desktop.active?.macDeviceId == pair?.macDeviceId &&
        desktop.active?.publicKey == pair?.publicKey &&
        desktop.runtimeReady) {
      await _startChat(cwd: path);
    }
  }

  Widget _navigation(DesktopController desktop) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        desktop.navigationError ??
            (desktop.navigationNeedsHost
                ? desktop.navigationTarget?.qualified == true
                      ? 'Choose the saved Mac matching this link’s verified identity.'
                      : 'Choose a saved Mac to open the linked conversation.'
                : 'Opening linked desktop conversation…'),
      ),
      Wrap(
        children: [
          if (!desktop.navigationNeedsHost && desktop.navigationTarget != null)
            TextButton(
              onPressed: () => desktop.routeNavigation(retry: true),
              child: const Text('Retry desktop link'),
            ),
          TextButton(
            onPressed: desktop.cancelNavigation,
            child: const Text('Cancel desktop link'),
          ),
        ],
      ),
      // An active verified-link choice stays on the root, where the controller
      // continues to reject a mismatched Mac or public key.
      if (desktop.navigationNeedsHost)
        for (final pair in desktop.trusted)
          ListTile(
            enabled: !desktop.busy,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(DjlIcons.shieldCheck),
            title: Text(desktop.deviceName(pair)),
            subtitle: Text(
              desktop.navigationTarget?.qualified == true
                  ? desktop.navigationTarget!.matchesHost(
                          pair.macDeviceId,
                          pair.publicKey,
                        )
                        ? 'Matches this link’s verified identity'
                        : 'Different desktop identity'
                  : 'Saved, verified desktop identity',
            ),
            onTap: desktop.busy
                ? null
                : () => _selectSavedDevice(context, desktop, pair),
          ),
    ],
  );

  void _openHost(DesktopController desktop) {
    Navigator.push<void>(
      context,
      MaterialPageRoute(builder: (_) => HostPage(controller: desktop.host)),
    );
  }

  Widget _pairingActions(DesktopController desktop) {
    final theme = Theme.of(context);
    final style = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(48, 0)),
      tapTargetSize: MaterialTapTargetSize.padded,
      textStyle: WidgetStatePropertyAll(
        theme.textTheme.bodyLarge!.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          height: 1.2,
        ),
      ),
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      ),
      shape: WidgetStatePropertyAll(
        RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
    );
    final secondaryStyle = style.copyWith(
      textStyle: WidgetStatePropertyAll(
        theme.textTheme.bodyLarge!.copyWith(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          height: 1.2,
        ),
      ),
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      ),
      side: WidgetStatePropertyAll(
        BorderSide(color: theme.colorScheme.onSurface.withValues(alpha: .14)),
      ),
    );
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 300),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (desktop.hasReconnectCandidate) ...[
              FilledButton(
                style: style,
                onPressed: desktop.busy ? null : desktop.reconnect,
                child: const Text('Reconnect', textAlign: TextAlign.center),
              ),
              const SizedBox(height: 20),
            ] else if (desktop.active == null &&
                desktop.trusted.isNotEmpty) ...[
              FilledButton(
                onPressed: _connections,
                style: style,
                child: const Text('Connections'),
              ),
              const SizedBox(height: 20),
            ],
            if (desktop.hasReconnectCandidate || desktop.trusted.isNotEmpty)
              OutlinedButton(
                style: secondaryStyle,
                onPressed: _canAdd ? _scan : null,
                child: const Text('Scan QR Code', textAlign: TextAlign.center),
              )
            else
              FilledButton(
                style: style,
                onPressed: _canAdd ? _scan : null,
                child: const Text('Scan QR Code', textAlign: TextAlign.center),
              ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              style: secondaryStyle,
              onPressed: _canAdd ? _pairWithCode : null,
              icon: const Icon(DjlIcons.keyboard, size: 14),
              label: const Text('Pair with Code', textAlign: TextAlign.center),
            ),
          ],
        ),
      ),
    );
  }

  Widget _feedback(DesktopController desktop) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (desktop.busy && desktop.switchingDevice == null)
        const LinearProgressIndicator(),
      if (desktop.error != null && ModalRoute.of(context)?.isCurrent == true)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: SelectableText(
            desktop.error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
    ],
  );

  Widget _emptyPanel(DesktopController desktop) {
    final theme = Theme.of(context);
    final tertiary = DjlColors.of(context).inkFaint;
    final firstPairing = desktop.active == null && desktop.trusted.isEmpty;
    final title =
        desktop.selectedDeviceName ??
        (desktop.trusted.isEmpty
            ? 'Connect to DJL Desktop'
            : 'Choose a saved Mac');
    final detail = firstPairing && !desktop.busy
        ? 'Open DJL on your Mac or Windows PC, then go to Settings → Remote.'
        : desktop.state;
    final warning =
        detail.toLowerCase().contains('not paired') ||
        detail.toLowerCase().contains('re-pair required') ||
        detail.toLowerCase().contains('update required');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 20),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 300),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                container: true,
                label: '$title. $detail',
                excludeSemantics: true,
                child: Column(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: tertiary.withValues(alpha: tertiary.a * .06),
                        border: Border.all(
                          color: tertiary.withValues(alpha: tertiary.a * .08),
                        ),
                      ),
                      child: Center(
                        child: SvgPicture.asset(
                          desktop.active != null
                              ? 'assets/icons/guide/central-imac.svg'
                              : 'assets/icons/command/central-scan-code.svg',
                          width: MediaQuery.textScalerOf(context).scale(28),
                          height: MediaQuery.textScalerOf(context).scale(28),
                          excludeFromSemantics: true,
                          colorFilter: ColorFilter.mode(
                            tertiary,
                            BlendMode.srcIn,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      title,
                      textAlign: TextAlign.center,
                      maxLines: firstPairing ? null : 1,
                      overflow: firstPairing
                          ? TextOverflow.clip
                          : TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium!.copyWith(
                        fontSize: firstPairing ? 22 : 15.5,
                        fontWeight: FontWeight.w600,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (warning) ...[
                            Icon(
                              DjlIcons.warningFill,
                              size: 10,
                              color: DjlColors.of(context).ink,
                            ),
                            const SizedBox(width: 6),
                          ],
                          Flexible(
                            child: Text(
                              detail,
                              textAlign: TextAlign.center,
                              maxLines: firstPairing ? null : 2,
                              overflow: firstPairing
                                  ? TextOverflow.clip
                                  : TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall!.copyWith(
                                fontSize: firstPairing ? 13 : 11,
                                height: 1.2,
                                color: firstPairing || warning
                                    ? theme.colorScheme.onSurfaceVariant
                                    : tertiary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              _feedback(desktop),
              _pairingActions(desktop),
              if (firstPairing && widget.onCloud != null)
                TextButton(
                  onPressed: widget.onCloud,
                  child: const Text('DJL Cloud'),
                ),
              if (firstPairing)
                TextButton(
                  key: const Key('pairing.getDesktop'),
                  onPressed: () => launchUrl(
                    Uri.parse('https://www.slcor.com/'),
                    mode: LaunchMode.externalApplication,
                  ),
                  child: const Text('Get DJL for your Mac or PC'),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final desktop = widget.controller;
      return DesktopPhoneDrawer(
        key: _drawer,
        onChanged: (open) => setState(() => _navigationOpen = open),
        menu: DesktopNavigationMenu(
          controller: desktop,
          visible: _navigationOpen,
          runStatus: widget.runStatus,
          remoteSelected: true,
          isCurrent: () =>
              mounted &&
              ModalRoute.of(context)?.isCurrent == true &&
              !_openingChat,
          onRemote: () => _drawer.currentState?.close(),
          onThread: (thread) => _chat(thread),
          onReview: () => _drawer.currentState?.close(),
          onNewChat: () => _chat(null),
          onSettings: widget.onSettings,
          onCloud: widget.onCloud == null
              ? null
              : () {
                  _drawer.currentState?.close();
                  widget.onCloud!();
                },
        ),
        child: DesktopOverview(
          desktop: desktop,
          onNavigation: () => _drawer.currentState?.toggle(),
          onConnections: _connections,
          onSecureDetails: _secureDetails,
          onHost: () => _openHost(desktop),
          onProject: _project,
          onQuickChat: _startChat,
          onChat: _chat,
          onSettings: widget.onSettings,
          groups: _groups,
          emptyPanel: _emptyPanel(desktop),
          feedback: _feedback(desktop),
          navigationNotice:
              desktop.navigationTarget != null ||
                  desktop.navigationError != null
              ? _navigation(desktop)
              : null,
          switchOverlay:
              desktop.switchingDevice != null &&
                  ModalRoute.of(context)?.isCurrent == true
              ? _DeviceSwitchOverlay(
                  desktop: desktop,
                  onCancel: desktop.cancelSavedSwitch,
                )
              : null,
        ),
      );
    },
  );
}

class _ScannerPage extends StatefulWidget {
  const _ScannerPage();
  static const pasteFallback = 'djl:paste-pairing-payload';
  @override
  State<_ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<_ScannerPage> {
  final _scanner = MobileScannerController(formats: [BarcodeFormat.qrCode]);
  bool _done = false;
  @override
  void dispose() {
    unawaited(_scanner.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Scan DJL desktop QR')),
    body: MobileScanner(
      controller: _scanner,
      onDetect: (capture) {
        final value = capture.barcodes.firstOrNull?.rawValue;
        if (!_done && value != null) {
          _done = true;
          Navigator.pop(context, value);
        }
      },
      errorBuilder: (context, error) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(switch (error.errorCode) {
                MobileScannerErrorCode.permissionDenied =>
                  'Camera access is denied. You can paste the pairing code instead.',
                MobileScannerErrorCode.unsupported =>
                  'QR scanning is not available on this device. You can paste the pairing code instead.',
                _ =>
                  'The camera is unavailable. You can paste the pairing code instead.',
              }),
              TextButton(
                onPressed: () =>
                    Navigator.pop(context, _ScannerPage.pasteFallback),
                child: const Text('Paste pairing code'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
