part of 'pairing_page.dart';

class _ConnectionsSheet extends StatefulWidget {
  const _ConnectionsSheet({required this.desktop});
  final DesktopController desktop;
  @override
  State<_ConnectionsSheet> createState() => _ConnectionsSheetState();
}

class _ConnectionsSheetState extends State<_ConnectionsSheet> {
  bool _forgetting = false;
  String? _error;
  (String, String)? _revealedDevice;

  @override
  void initState() {
    super.initState();
    if (!widget.desktop.devicePreferencesReady &&
        !widget.desktop.devicePreferencesLoading &&
        widget.desktop.devicePreferencesError == null) {
      scheduleMicrotask(() {
        if (mounted) unawaited(widget.desktop.loadDevicePreferences());
      });
    }
  }

  String _name(Pairing pair) => widget.desktop
      .deviceName(pair)
      .replaceFirst(RegExp(r'\.local$', caseSensitive: false), '');

  List<Pairing> get _devices {
    final desktop = widget.desktop;
    final previous = desktop.previousDevice;
    int priority(Pairing pair) => desktop.isActiveDevice(pair)
        ? 0
        : previous?.macDeviceId == pair.macDeviceId &&
              previous?.publicKey == pair.publicKey
        ? 1
        : 2;
    final rows = desktop.managedDevices.indexed.toList();
    rows.sort((a, b) {
      final rank = priority(a.$2).compareTo(priority(b.$2));
      if (rank != 0) return rank;
      final first = desktop.devicePreferences(a.$2)?.lastActivityAt;
      final second = desktop.devicePreferences(b.$2)?.lastActivityAt;
      if (first != null && second != null) {
        final date = second.compareTo(first);
        if (date != 0) return date;
      } else if (first != null || second != null) {
        return first != null ? -1 : 1;
      }
      return a.$1.compareTo(b.$1);
    });
    return rows.map((row) => row.$2).toList();
  }

  List<Pairing> get _menuDevices {
    final eligible = widget.desktop.menuDevices;
    return _devices
        .where(
          (pair) => eligible.any(
            (candidate) =>
                candidate.macDeviceId == pair.macDeviceId &&
                candidate.publicKey == pair.publicKey,
          ),
        )
        .toList();
  }

  final _scroll = ScrollController();
  final _switcher = GlobalKey();
  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _select(Pairing pair) async {
    if (_forgetting) return;
    await _selectSavedDevice(context, widget.desktop, pair);
    if (mounted && _scroll.hasClients && widget.desktop.switchNotice != null) {
      _scroll.jumpTo(0);
    }
  }

  Future<void> _cancelSwitch() async {
    await widget.desktop.cancelSavedSwitch();
    if (mounted && _scroll.hasClients) _scroll.jumpTo(0);
  }

  Future<void> _chooseDevice() async {
    final desktop = widget.desktop;
    if (desktop.busy || _forgetting || desktop.navigationNeedsHost) return;
    if (_revealedDevice != null) setState(() => _revealedDevice = null);
    final anchor = _switcher.currentContext?.findRenderObject();
    final overlay = Navigator.of(context).overlay?.context.findRenderObject();
    if (anchor is! RenderBox || overlay is! RenderBox) return;
    final origin = anchor.localToGlobal(Offset.zero, ancestor: overlay);
    final row = origin & anchor.size;
    final devices = _menuDevices;
    final themes = InheritedTheme.capture(
      from: context,
      to: Navigator.of(context).context,
    );
    final selected = await showGeneralDialog<Pairing>(
      context: context,
      useRootNavigator: false,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      transitionDuration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 150),
      pageBuilder: (context, _, _) => themes.wrap(
        Builder(
          builder: (context) {
            final theme = Theme.of(context);
            final colors = theme.colorScheme;
            final nativeGlass = theme.platform == TargetPlatform.iOS;
            final body = TextStyle(
              fontFamily: theme.platform == TargetPlatform.iOS
                  ? 'CupertinoSystemText'
                  : 'Roboto',
              fontSize: 17,
              fontWeight: FontWeight.w400,
              height: 20 / 17,
              letterSpacing: 0,
            );
            return CustomSingleChildLayout(
              delegate: _DeviceSwitchMenuLayout(row, MediaQuery.of(context)),
              child: Semantics(
                role: SemanticsRole.menu,
                scopesRoute: true,
                explicitChildNodes: true,
                namesRoute: true,
                label: context.l10n.pairingSwitchDevice,
                child: DjlGlassSurface(
                  radius: 34,
                  useNativeView: nativeGlass,
                  child: Material(
                    key: const Key('device_switch_menu'),
                    color: nativeGlass
                        ? Colors.transparent
                        : colors.surfaceContainerLow.withValues(
                            alpha: colors.brightness == Brightness.dark
                                ? .85
                                : .70,
                          ),
                    clipBehavior: Clip.antiAlias,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(34),
                      side: nativeGlass
                          ? BorderSide.none
                          : BorderSide(
                              color: Colors.white.withValues(
                                alpha: colors.brightness == Brightness.dark
                                    ? .14
                                    : .65,
                              ),
                            ),
                    ),
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(
                              43,
                              12,
                              28,
                              10.333,
                            ),
                            child: Semantics(
                              header: true,
                              child: Text(
                                context.l10n.pairingSwitchTo,
                                style: body.copyWith(
                                  fontSize: 13,
                                  height: 16 / 13,
                                  fontWeight: FontWeight.w600,
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                            ),
                          ),
                          for (final pair in devices)
                            KeyedSubtree(
                              key: ValueKey((pair.macDeviceId, pair.publicKey)),
                              child: PopupMenuItem<Pairing>(
                                key: ValueKey(
                                  'device_choice_${pair.macDeviceId}',
                                ),
                                value: pair,
                                height: 60,
                                enabled: !desktop.isActiveDevice(pair),
                                padding: const EdgeInsets.fromLTRB(
                                  20,
                                  10,
                                  28,
                                  10,
                                ),
                                child: Semantics(
                                  identifier:
                                      'device_choice_${pair.macDeviceId}',
                                  selected: desktop.isActiveDevice(pair),
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        width: 20,
                                        child: desktop.isActiveDevice(pair)
                                            ? IconTheme.merge(
                                                data: const IconThemeData(
                                                  opacity: 1,
                                                ),
                                                child: Icon(
                                                  DjlIcons.check,
                                                  size: 14,
                                                  color:
                                                      colors.onSurfaceVariant,
                                                ),
                                              )
                                            : null,
                                      ),
                                      const SizedBox(width: 6),
                                      SvgPicture.asset(
                                        'assets/icons/guide/central-imac.svg',
                                        width: MediaQuery.textScalerOf(
                                          context,
                                        ).scale(20),
                                        height: MediaQuery.textScalerOf(
                                          context,
                                        ).scale(20),
                                        excludeFromSemantics: true,
                                        colorFilter: ColorFilter.mode(
                                          desktop.isActiveDevice(pair)
                                              ? colors.onSurfaceVariant
                                              : colors.onSurface,
                                          BlendMode.srcIn,
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Text(
                                              _name(pair),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: body.copyWith(
                                                color:
                                                    desktop.isActiveDevice(pair)
                                                    ? colors.onSurfaceVariant
                                                    : colors.onSurface,
                                              ),
                                            ),
                                            const SizedBox(height: 2),
                                            DeviceRecencyText(
                                              status: _status(pair),
                                              date: _activityDate(pair),
                                              maxLines: 2,
                                              style: body.copyWith(
                                                fontSize: 13,
                                                height: 18 / 13,
                                                color: colors.onSurfaceVariant,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          const SizedBox(height: 10),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
    if (!mounted ||
        selected == null ||
        desktop.busy ||
        !desktop.menuDevices.any(
          (p) =>
              p.macDeviceId == selected.macDeviceId &&
              p.publicKey == selected.publicKey,
        )) {
      return;
    }
    await _select(selected);
  }

  String _status(Pairing pair) {
    final desktop = widget.desktop;
    final switching = desktop.switchingDevice?.pairing;
    if (switching?.macDeviceId == pair.macDeviceId &&
        switching?.publicKey == pair.publicKey) {
      return context.l10n.pairingStatusSwitching;
    }
    if (desktop.isActiveDevice(pair)) {
      return desktop.connected
          ? context.l10n.pairingStatusConnected
          : context.l10n.pairingStatusSelected;
    }
    final previous = desktop.previousDevice;
    return previous?.macDeviceId == pair.macDeviceId &&
            previous?.publicKey == pair.publicKey
        ? context.l10n.pairingStatusPrevious
        : context.l10n.pairingStatusSaved;
  }

  DateTime? _activityDate(Pairing pair) =>
      _status(pair) == context.l10n.pairingStatusSwitching
      ? null
      : widget.desktop.devicePreferences(pair)?.lastActivityAt;

  // Sheets are the page colour, so grouped rows take the raised fill.
  Color _groupColor(BuildContext context) =>
      Theme.of(context).colorScheme.surfaceContainerLow;

  Widget _avatar(Pairing pair) => SizedBox.square(
    dimension: 36,
    child: Stack(
      clipBehavior: Clip.none,
      children: [
        CircleAvatar(
          radius: 18,
          backgroundColor: Theme.of(
            context,
          ).colorScheme.onSurface.withValues(alpha: .07),
          foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
          child: SvgPicture.asset(
            'assets/icons/guide/central-imac.svg',
            width: MediaQuery.textScalerOf(context).scale(36 * .42),
            height: MediaQuery.textScalerOf(context).scale(36 * .42),
            excludeFromSemantics: true,
            colorFilter: ColorFilter.mode(
              Theme.of(context).colorScheme.onSurfaceVariant,
              BlendMode.srcIn,
            ),
          ),
        ),
        if (widget.desktop.connected && widget.desktop.isActiveDevice(pair))
          Positioned(
            right: -2,
            bottom: -2,
            child: Container(
              width: 10,
              height: 10,
              key: const Key('connected_device_dot'),
              decoration: BoxDecoration(
                color: DjlColors.of(context).ink,
                shape: BoxShape.circle,
                border: Border.all(color: _groupColor(context), width: 2),
              ),
            ),
          ),
      ],
    ),
  );

  Future<void> _forget(Pairing pair) async {
    if (widget.desktop.busy || _forgetting) return;
    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.black.withValues(
        alpha: Theme.of(context).brightness == Brightness.dark ? .4 : .2,
      ),
      builder: (context) {
        final theme = Theme.of(context);
        final colors = theme.colorScheme;
        final nativeGlass = theme.platform == TargetPlatform.iOS;
        final media = MediaQuery.of(context);
        final width = math.min(
          320.0,
          media.size.width - media.viewPadding.horizontal - 20,
        );
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
        double actionWidth(String label) {
          final text = TextPainter(
            text: TextSpan(text: label, style: style),
            textDirection: Directionality.of(context),
            textScaler: media.textScaler,
          )..layout();
          final width = text.width + 24;
          text.dispose();
          return width;
        }

        Widget action(String label, bool value) => TextButton(
          onPressed: () => Navigator.pop(context, value),
          style: TextButton.styleFrom(
            foregroundColor: value
                ? DjlColors.of(context).danger
                : colors.onSurface,
            backgroundColor: colors.onSurface.withValues(
              alpha: theme.brightness == Brightness.dark ? .10 : .14,
            ),
            minimumSize: const Size(0, 48),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            shape: const StadiumBorder(),
            textStyle: style,
          ),
          child: Text(label),
        );
        final stacked =
            math.max(
              actionWidth(context.l10n.commonCancel),
              actionWidth(context.l10n.pairingForget),
            ) >
            (width - 40) / 2;
        final dialog = Dialog(
          semanticsRole: SemanticsRole.alertDialog,
          backgroundColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          shadowColor: Colors.transparent,
          elevation: 0,
          insetPadding: const EdgeInsets.all(10),
          constraints: BoxConstraints.tightFor(width: width),
          child: DjlGlassSurface(
            radius: 34,
            useNativeView: nativeGlass,
            child: Material(
              key: const Key('forget_device_review'),
              color: nativeGlass
                  ? Colors.transparent
                  : colors.surfaceContainerLow.withValues(
                      alpha: colors.brightness == Brightness.dark ? .85 : .70,
                    ),
              clipBehavior: Clip.antiAlias,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(34),
                side: nativeGlass
                    ? BorderSide.none
                    : BorderSide(
                        color: Colors.white.withValues(
                          alpha: colors.brightness == Brightness.dark
                              ? .14
                              : .65,
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
                            child: Text(
                              context.l10n.pairingForgetDeviceTitle,
                              style: style,
                            ),
                          ),
                          const SizedBox(height: 7.333),
                          Text(
                            context.l10n.pairingForgetDeviceBody(
                              widget.desktop.deviceName(pair),
                            ),
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
                    child: stacked
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              action(context.l10n.commonCancel, false),
                              const SizedBox(height: 8),
                              action(context.l10n.pairingForget, true),
                            ],
                          )
                        : Row(
                            children: [
                              Expanded(
                                child: action(context.l10n.commonCancel, false),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: action(context.l10n.pairingForget, true),
                              ),
                            ],
                          ),
                  ),
                ],
              ),
            ),
          ),
        );
        return CallbackShortcuts(
          bindings: {
            const SingleActivator(LogicalKeyboardKey.escape): () =>
                Navigator.pop(context, false),
          },
          child: Focus(autofocus: true, child: dialog),
        );
      },
    );
    if (!mounted || confirmed != true || widget.desktop.busy || _forgetting) {
      return;
    }
    setState(() {
      _forgetting = true;
      _error = null;
    });
    try {
      await widget.desktop.forget(pair);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _forgetting = false);
    }
  }

  void _manualPairing(String mode) {
    if (!widget.desktop.canEnterManualPairing || _forgetting) return;
    widget.desktop.pauseForManualPairing();
    Navigator.pop(context, mode);
  }

  Widget _deviceRow(Pairing pair, {required bool busy, required bool canAdd}) {
    final desktop = widget.desktop;
    final active = desktop.isActiveDevice(pair);
    final identity = (pair.macDeviceId, pair.publicKey);
    final preferences = desktop.devicePreferences(pair);
    final colors = Theme.of(context).colorScheme;
    final visibilityDisabled =
        busy ||
        desktop.devicePreferencesSaving ||
        desktop.devicePreferencesLoading;
    return _ConnectionSwipeRow(
      key: ValueKey(identity),
      color: _groupColor(context),
      enabled: !busy,
      revealed: _revealedDevice == identity,
      onReveal: () => setState(() => _revealedDevice = identity),
      onScan: canAdd ? () => _manualPairing('scan') : null,
      onCode: canAdd ? () => _manualPairing('code') : null,
      onForget: busy ? null : () => _forget(pair),
      child: ListTile(
        key: ValueKey('device_row_${pair.macDeviceId}'),
        selected: active,
        selectedColor: colors.onSurface,
        enabled: !busy,
        minTileHeight: 70,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        horizontalTitleGap: 12,
        minLeadingWidth: 36,
        leading: _avatar(pair),
        title: Wrap(
          spacing: 6,
          runSpacing: 2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              _name(pair),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w400,
                height: 1.2,
                color: colors.onSurface,
              ),
            ),
            if (active)
              DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.onSurface.withValues(alpha: .08),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  child: Text(
                    context.l10n.pairingActiveBadge,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      height: 1.2,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
          ],
        ),
        subtitle: DeviceRecencyText(
          status: _status(pair),
          date: _activityDate(pair),
          style: TextStyle(
            fontSize: 11,
            height: 1.2,
            color: colors.onSurfaceVariant,
          ),
        ),
        trailing: active
            ? null
            : desktop.devicePreferencesReady && preferences != null
            ? Semantics(
                label: context.l10n.pairingShowInMenu(_name(pair)),
                child: KeyedSubtree(
                  key: ValueKey(preferences.trustId),
                  child: Transform.translate(
                    // Native source paint extends two points past its AX frame.
                    offset: const Offset(2, 0),
                    child: DeviceVisibilitySwitch(
                      key: ValueKey('device_visibility_${pair.macDeviceId}'),
                      value: preferences.visibleInMenu,
                      onChanged: visibilityDisabled
                          ? null
                          : (visible) => desktop.setDeviceMenuVisibility(
                              preferences,
                              visible,
                            ),
                    ),
                  ),
                ),
              )
            : Tooltip(
                message: context.l10n.pairingMenuVisibilityUnavailable,
                child: Icon(DjlIcons.error, size: 18),
              ),
      ),
    );
  }

  Widget _group(BuildContext context, List<Widget> children) => Material(
    color: _groupColor(context),
    borderRadius: BorderRadius.circular(24),
    clipBehavior: Clip.antiAlias,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );

  Widget _header(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final title = Text(
      context.l10n.pairingConnections,
      textAlign: TextAlign.center,
      style: settingsTextStyle(
        context,
        17,
        weight: FontWeight.w600,
        color: colors.onSurface,
      ),
    );
    final close = SizedBox(
      height: (MediaQuery.textScalerOf(context).scale(17) * 1.2 + 14)
          .clamp(36.0, double.infinity)
          .toDouble(),
      child: DjlGlassSurface(
        radius: 999,
        useNativeView: false,
        child: TextButton(
          onPressed: () => Navigator.pop(context),
          style: TextButton.styleFrom(
            foregroundColor: colors.onSurfaceVariant,
            backgroundColor: colors.surfaceContainerLow,
            minimumSize: const Size(0, 36),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            textStyle: settingsTextStyle(context, 17),
            shape: const StadiumBorder(),
          ),
          child: Text(context.l10n.pairingClose),
        ),
      ),
    );
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 5, bottom: 6),
          child: ExcludeSemantics(
            child: Container(
              key: const Key('connections_grabber'),
              width: 36,
              height: 5,
              decoration: BoxDecoration(
                color: colors.onSurfaceVariant.withValues(alpha: .55),
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: MediaQuery.textScalerOf(context).scale(17) > 25.5
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(alignment: Alignment.centerLeft, child: close),
                    title,
                    const SizedBox(height: 8),
                  ],
                )
              : SizedBox(
                  height: 44,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Align(alignment: Alignment.centerLeft, child: close),
                      title,
                    ],
                  ),
                ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.desktop,
    builder: (context, _) {
      final desktop = widget.desktop;
      final busy = desktop.busy || _forgetting;
      final menu = _menuDevices;
      final canChoose =
          !busy &&
          !desktop.navigationNeedsHost &&
          desktop.devicePreferencesReady &&
          !desktop.devicePreferencesLoading &&
          !desktop.devicePreferencesSaving;
      final canAdd = desktop.canEnterManualPairing && !_forgetting;
      return FractionallySizedBox(
        heightFactor: 1,
        child: Column(
          children: [
            _header(context),
            Expanded(
              child: Stack(
                children: [
                  ListView(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(16, 18.333, 16, 32),
                    children: [
                      DevicePreferencesStatus(desktop: desktop),
                      if (desktop.switchNotice != null)
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            desktop.switchNotice!,
                            style: TextStyle(
                              fontSize: 11,
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      if (menu.length > 1 && menu.any(desktop.isActiveDevice))
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                          child: Text(
                            context.l10n.pairingActiveDevice,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  fontSize: 11,
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                                ),
                          ),
                        ),
                      if (menu.length > 1)
                        _group(context, [
                          Semantics(
                            key: _switcher,
                            excludeSemantics: true,
                            button: true,
                            enabled: canChoose,
                            label: menu.any(desktop.isActiveDevice)
                                ? context.l10n.pairingActiveDeviceNamed(
                                    _name(desktop.active!),
                                  )
                                : context.l10n.pairingChooseSavedMac,
                            value: menu.any(desktop.isActiveDevice)
                                ? _status(desktop.active!)
                                : null,
                            onTap: canChoose ? _chooseDevice : null,
                            child: ListTile(
                              key: const Key('device_menu'),
                              minTileHeight: 70,
                              minLeadingWidth: 36,
                              horizontalTitleGap: 12,
                              leading: menu.any(desktop.isActiveDevice)
                                  ? _avatar(desktop.active!)
                                  : null,
                              title: Text(
                                menu.any(desktop.isActiveDevice)
                                    ? _name(desktop.active!)
                                    : context.l10n.pairingChooseSavedMac,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: Row(
                                children: [
                                  if (desktop.connected &&
                                      menu.any(desktop.isActiveDevice)) ...[
                                    Container(
                                      key: const Key(
                                        'active_device_status_dot',
                                      ),
                                      width: 6,
                                      height: 6,
                                      decoration: BoxDecoration(
                                        color: DjlColors.of(context).ink,
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                  ],
                                  Expanded(
                                    child: DeviceRecencyText(
                                      status: menu.any(desktop.isActiveDevice)
                                          ? _status(desktop.active!)
                                          : context.l10n.pairingDevicesInMenu(
                                              menu.length,
                                            ),
                                      date: menu.any(desktop.isActiveDevice)
                                          ? _activityDate(desktop.active!)
                                          : null,
                                      statusColor:
                                          desktop.connected &&
                                              menu.any(desktop.isActiveDevice)
                                          ? DjlColors.of(context).ink
                                          : null,
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              trailing: const Icon(
                                DjlIcons.expandVertical,
                                size: 18,
                              ),
                              onTap: canChoose ? _chooseDevice : null,
                            ),
                          ),
                        ]),
                      if (menu.length > 1) const SizedBox(height: 30),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                        child: Text(
                          context.l10n.pairingDevices,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                fontSize: 11,
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ),
                      _group(context, [
                        if (desktop.trusted.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(
                              context.l10n.pairingNoDevices,
                              style: TextStyle(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        for (final pair in _devices) ...[
                          _deviceRow(pair, busy: busy, canAdd: canAdd),
                          if (!identical(pair, _devices.last))
                            const Divider(
                              height: 0,
                              thickness: 1,
                              indent: 64,
                              endIndent: 16,
                            ),
                        ],
                      ]),
                      if (busy && desktop.switchingDevice == null)
                        const LinearProgressIndicator(),
                      if (_error != null ||
                          desktop.error != null ||
                          desktop.navigationError != null)
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            _error ?? desktop.error ?? desktop.navigationError!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      const SizedBox(height: 36),
                      _group(context, [
                        ListTile(
                          minTileHeight: 52,
                          horizontalTitleGap: 14,
                          minLeadingWidth: 22,
                          titleTextStyle: settingsTextStyle(
                            context,
                            15,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                          enabled: canAdd,
                          iconColor: Theme.of(context).colorScheme.onSurface,
                          leading: const SizedBox(
                            width: 22,
                            child: Icon(DjlIcons.scan, size: 16),
                          ),
                          title: Text(context.l10n.pairingScanQrCode),
                          onTap: canAdd
                              ? () {
                                  desktop.pauseForManualPairing();
                                  Navigator.pop(context, 'scan');
                                }
                              : null,
                        ),
                        const Divider(
                          height: 0,
                          thickness: 1,
                          indent: 52,
                          endIndent: 16,
                        ),
                        ListTile(
                          minTileHeight: 52,
                          horizontalTitleGap: 14,
                          minLeadingWidth: 22,
                          titleTextStyle: settingsTextStyle(
                            context,
                            15,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                          enabled: canAdd,
                          iconColor: Theme.of(context).colorScheme.onSurface,
                          leading: const SizedBox(
                            width: 22,
                            child: Icon(DjlIcons.keyboard, size: 16),
                          ),
                          title: Text(context.l10n.pairingPairWithCode),
                          onTap: canAdd
                              ? () {
                                  desktop.pauseForManualPairing();
                                  Navigator.pop(context, 'code');
                                }
                              : null,
                        ),
                      ]),
                    ],
                  ),
                  if (desktop.switchingDevice != null)
                    Positioned.fill(
                      child: _DeviceSwitchOverlay(
                        desktop: desktop,
                        onCancel: _cancelSwitch,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

/// A reveal-only swipe: even a full stroke never executes a destructive action.
class _ConnectionSwipeRow extends StatefulWidget {
  const _ConnectionSwipeRow({
    super.key,
    required this.child,
    required this.color,
    required this.enabled,
    required this.revealed,
    required this.onReveal,
    this.onScan,
    this.onCode,
    this.onForget,
  });
  final Widget child;
  final Color color;
  final bool enabled;
  final bool revealed;
  final VoidCallback onReveal;
  final VoidCallback? onScan, onCode, onForget;
  @override
  State<_ConnectionSwipeRow> createState() => _ConnectionSwipeRowState();
}

class _ConnectionSwipeRowState extends State<_ConnectionSwipeRow> {
  static const _width = 168.0;
  double _offset = 0;
  bool _dragging = false;
  void _close() => setState(() {
    _dragging = false;
    _offset = 0;
  });
  void _action(VoidCallback? callback) {
    if (!widget.enabled || callback == null) return;
    _close();
    callback();
  }

  @override
  void didUpdateWidget(_ConnectionSwipeRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled || !widget.revealed) {
      _offset = 0;
      _dragging = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget action(
      String label,
      IconData icon,
      Color color,
      VoidCallback? callback,
    ) => SizedBox(
      width: 56,
      child: ColoredBox(
        color: color,
        child: Center(
          child: IconButton(
            tooltip: label,
            onPressed: callback == null ? null : () => _action(callback),
            color: DjlColors.of(context).onInk,
            disabledColor: DjlColors.of(context).onInk.withValues(alpha: .54),
            icon: Icon(icon, size: 21),
          ),
        ),
      ),
    );
    return Semantics(
      customSemanticsActions: {
        if (widget.enabled && widget.onScan != null)
          CustomSemanticsAction(label: context.l10n.pairingScanQr): () =>
              _action(widget.onScan),
        if (widget.enabled && widget.onCode != null)
          CustomSemanticsAction(label: context.l10n.pairingPairWithCode): () =>
              _action(widget.onCode),
        if (widget.enabled && widget.onForget != null)
          CustomSemanticsAction(label: context.l10n.pairingForgetDesktop): () =>
              _action(widget.onForget),
      },
      child: ClipRect(
        child: Stack(
          children: [
            if (_offset < 0)
              Positioned.fill(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    action(
                      context.l10n.pairingScanQr,
                      DjlIcons.scan,
                      DjlColors.of(context).ink,
                      widget.onScan,
                    ),
                    action(
                      context.l10n.pairingPairWithCode,
                      DjlIcons.keyboard,
                      DjlColors.of(context).inkMuted,
                      widget.onCode,
                    ),
                    action(
                      context.l10n.pairingForgetDesktop,
                      DjlIcons.delete,
                      DjlColors.of(context).danger,
                      widget.onForget,
                    ),
                  ],
                ),
              ),
            GestureDetector(
              onHorizontalDragStart: widget.enabled
                  ? (_) {
                      widget.onReveal();
                      setState(() => _dragging = true);
                    }
                  : null,
              onHorizontalDragUpdate: widget.enabled
                  ? (details) => setState(() {
                      _offset = (_offset + details.delta.dx).clamp(-_width, 0);
                    })
                  : null,
              onHorizontalDragEnd: widget.enabled
                  ? (_) => setState(() {
                      _dragging = false;
                      _offset = _offset < -48 ? -_width : 0;
                    })
                  : null,
              onHorizontalDragCancel: _close,
              onTap: _offset < 0 ? _close : null,
              child: TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: _offset),
                duration: _dragging
                    ? Duration.zero
                    : const Duration(milliseconds: 180),
                builder: (context, offset, child) => Transform.translate(
                  offset: Offset(offset, 0),
                  child: child,
                ),
                child: ColoredBox(color: widget.color, child: widget.child),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceSwitchMenuLayout extends SingleChildLayoutDelegate {
  _DeviceSwitchMenuLayout(this.anchor, this.media);
  final Rect anchor;
  final MediaQueryData media;

  Rect _viewport(Size size) => Rect.fromLTRB(
    math.max(media.viewPadding.left, media.viewInsets.left) + 10,
    math.max(media.viewPadding.top, media.viewInsets.top) + 10,
    size.width - math.max(media.viewPadding.right, media.viewInsets.right) - 10,
    size.height -
        math.max(media.viewPadding.bottom, media.viewInsets.bottom) -
        10,
  );

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final viewport = _viewport(constraints.biggest);
    final width = math.min(250.0, math.max(0.0, viewport.width));
    return BoxConstraints(
      minWidth: width,
      maxWidth: width,
      maxHeight: math.max(0.0, viewport.height),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final viewport = _viewport(size);
    return Offset(
      (anchor.center.dx - childSize.width / 2).clamp(
        viewport.left,
        math.max(viewport.left, viewport.right - childSize.width),
      ),
      (anchor.top + 15).clamp(
        viewport.top,
        math.max(viewport.top, viewport.bottom - childSize.height),
      ),
    );
  }

  @override
  bool shouldRelayout(_DeviceSwitchMenuLayout oldDelegate) =>
      anchor != oldDelegate.anchor || media != oldDelegate.media;
}

class _PairingSheetHeader extends StatelessWidget {
  const _PairingSheetHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) {
    final titleWidget = Text(
      title,
      textAlign: TextAlign.center,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    );
    final close = TextButton(
      onPressed: () => Navigator.pop(context),
      style: TextButton.styleFrom(
        backgroundColor: Theme.of(context).colorScheme.surface,
        foregroundColor: Theme.of(context).colorScheme.onSurfaceVariant,
        shape: const StadiumBorder(),
      ),
      child: Text(context.l10n.pairingClose),
    );
    // At large text the leading pill and full title take separate lines.
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: MediaQuery.textScalerOf(context).scale(16) > 24
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(alignment: Alignment.centerLeft, child: close),
                titleWidget,
                const SizedBox(height: 8),
              ],
            )
          : Row(
              children: [
                close,
                Expanded(child: titleWidget),
                const SizedBox(width: 72),
              ],
            ),
    );
  }
}
