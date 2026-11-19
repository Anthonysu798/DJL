import 'dart:async';
import 'package:flutter/material.dart';
import '../../desktop/presentation/desktop_controller.dart';
import '../../pairing/data/pairing_repository.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class DevicePreferencesStatus extends StatelessWidget {
  const DevicePreferencesStatus({super.key, required this.desktop});
  final DesktopController desktop;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (desktop.devicePreferencesLoading || desktop.devicePreferencesSaving)
        const LinearProgressIndicator(),
      if (desktop.devicePreferencesError != null) ...[
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            desktop.devicePreferencesError!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
        TextButton(
          onPressed:
              desktop.devicePreferencesLoading ||
                  desktop.devicePreferencesSaving
              ? null
              : desktop.loadDevicePreferences,
          child: const Text('Retry local preferences'),
        ),
      ],
    ],
  );
}

class DeviceNameTile extends StatefulWidget {
  const DeviceNameTile({super.key, required this.desktop});
  final DesktopController desktop;
  @override
  State<DeviceNameTile> createState() => _DeviceNameTileState();
}

class _DeviceNameTileState extends State<DeviceNameTile> {
  @override
  void initState() {
    super.initState();
    if (!widget.desktop.devicePreferencesReady &&
        !widget.desktop.devicePreferencesLoading &&
        widget.desktop.devicePreferencesError == null) {
      // Notify after mounting, outside the parent's build.
      scheduleMicrotask(() {
        if (mounted) unawaited(widget.desktop.loadDevicePreferences());
      });
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.desktop,
    builder: (context, _) {
      final desktop = widget.desktop, pair = widget.desktop.active;
      final target = pair == null ? null : desktop.devicePreferences(pair);
      final canEdit =
          desktop.devicePreferencesReady &&
          !desktop.devicePreferencesLoading &&
          !desktop.devicePreferencesSaving &&
          target != null;
      return Column(
        children: [
          if (pair != null &&
              desktop.trusted.any(
                (p) =>
                    p.macDeviceId == pair.macDeviceId &&
                    p.publicKey == pair.publicKey,
              ))
            ListTile(
              leading: const Icon(DjlIcons.desktop),
              title: Text(desktop.deviceName(pair)),
              subtitle: Text(
                target?.nickname.trim().isNotEmpty == true
                    ? pair.displayName
                    : 'Device name on this phone',
              ),
              trailing: IconButton(
                tooltip: 'Edit device name',
                icon: const Icon(DjlIcons.edit),
                onPressed: !canEdit
                    ? null
                    : () => showModalBottomSheet<void>(
                        context: context,
                        isScrollControlled: true,
                        useSafeArea: true,
                        builder: (_) => DeviceNameSheet(
                          desktop: desktop,
                          target: target,
                          currentName: desktop.deviceName(pair),
                        ),
                      ),
              ),
            ),
          DevicePreferencesStatus(desktop: desktop),
        ],
      );
    },
  );
}

class DeviceNameSheet extends StatefulWidget {
  const DeviceNameSheet({
    super.key,
    required this.desktop,
    required this.target,
    required this.currentName,
  });
  final DesktopController desktop;
  final TrustedDeviceEntry target;
  final String currentName;
  @override
  State<DeviceNameSheet> createState() => _DeviceNameSheetState();
}

class _DeviceNameSheetState extends State<DeviceNameSheet> {
  late final _draft = TextEditingController(text: widget.target.nickname);
  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  Future<void> _save(String draft) async {
    final saved = await widget.desktop.setDeviceNickname(widget.target, draft);
    if (mounted && saved) Navigator.pop(context);
  }

  Widget _header(BuildContext context) {
    final theme = Theme.of(context);
    final titleStyle = theme.textTheme.titleMedium!.copyWith(
      fontSize: 17,
      fontWeight: FontWeight.w600,
      color: theme.colorScheme.onSurface,
    );
    final closeStyle = theme.textTheme.bodyLarge!.copyWith(fontSize: 17);
    double width(String text, TextStyle style) {
      final painter = TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      )..layout();
      final result = painter.width;
      painter.dispose();
      return result;
    }

    final closeWidth = width('Close', closeStyle) + 32;
    final titleWidth = width('Edit Device Name', titleStyle);
    final close = SizedBox(
      width: closeWidth,
      child: TextButton(
        style: TextButton.styleFrom(
          foregroundColor: theme.colorScheme.onSurface,
          textStyle: closeStyle,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        ),
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    );
    final title = Text(
      'Edit Device Name',
      textAlign: TextAlign.center,
      style: titleStyle,
    );
    return LayoutBuilder(
      builder: (context, constraints) =>
          titleWidth + 2 * (closeWidth + 8) <= constraints.maxWidth
          ? Row(
              children: [
                close,
                Expanded(child: title),
                SizedBox(width: closeWidth),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(alignment: Alignment.centerLeft, child: close),
                title,
              ],
            ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.desktop,
    builder: (context, _) {
      final desktop = widget.desktop;
      final current = desktop.devicePreferences(widget.target.pairing);
      final valid = current?.trustId == widget.target.trustId;
      final enabled =
          valid &&
          desktop.devicePreferencesReady &&
          !desktop.devicePreferencesSaving &&
          !desktop.devicePreferencesLoading;
      final theme = Theme.of(context), scheme = Theme.of(context).colorScheme;
      final subheadline = theme.textTheme.bodyMedium!.copyWith(fontSize: 14);
      final caption = theme.textTheme.bodySmall!.copyWith(
        fontSize: 11,
        color: scheme.onSurfaceVariant,
      );
      final neutral = scheme.onSurface.withValues(alpha: .08);
      final actionStyle = FilledButton.styleFrom(
        backgroundColor: neutral,
        disabledBackgroundColor: neutral,
        foregroundColor: scheme.onSurface,
        disabledForegroundColor: scheme.onSurface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        minimumSize: const Size(0, 44),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: const EdgeInsets.symmetric(vertical: 10),
        textStyle: theme.textTheme.bodyLarge!.copyWith(
          fontSize: 17,
          fontWeight: FontWeight.w400,
        ),
      );
      final canReset = enabled && current!.nickname.trim().isNotEmpty;
      final canSave = enabled && _draft.text != current!.nickname;
      return Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                _header(context),
                const SizedBox(height: 16),
                Text(
                  'Device name',
                  style: subheadline.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                Text(widget.currentName, style: caption),
                const SizedBox(height: 16),
                TextField(
                  key: const Key('device_nickname'),
                  controller: _draft,
                  enabled: !desktop.devicePreferencesSaving,
                  textCapitalization: TextCapitalization.words,
                  autocorrect: false,
                  style: subheadline,
                  decoration: InputDecoration(
                    hintText: widget.target.pairing.displayName,
                    hintStyle: subheadline.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                    isDense: true,
                    filled: true,
                    fillColor: DjlColors.of(context).surfaceRaised,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 11,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 16),
                Text(
                  'This nickname stays on this phone and appears anywhere this device is shown.',
                  style: caption,
                ),
                if (!valid)
                  const Text(
                    'This saved device changed. Close and reopen the editor.',
                  ),
                DevicePreferencesStatus(desktop: desktop),
                const SizedBox(height: 16),
                Opacity(
                  opacity: canReset ? 1 : .5,
                  child: TextButton(
                    style: actionStyle.copyWith(
                      foregroundColor: WidgetStatePropertyAll(
                        scheme.onSurfaceVariant,
                      ),
                    ),
                    onPressed: canReset ? () => _save('') : null,
                    child: const Text('Use Default'),
                  ),
                ),
                const SizedBox(height: 10),
                Opacity(
                  opacity: canSave ? 1 : .5,
                  child: FilledButton(
                    style: actionStyle,
                    onPressed: canSave ? () => _save(_draft.text) : null,
                    child: const Text('Save'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
