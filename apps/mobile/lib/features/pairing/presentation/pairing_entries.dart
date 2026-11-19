part of 'pairing_page.dart';

class _PairingCodeDialog extends StatefulWidget {
  const _PairingCodeDialog({
    required this.desktop,
    required this.initialCode,
    required this.relay,
    required this.onChanged,
  });
  final DesktopController desktop;
  final String initialCode, relay;
  final ValueChanged<String> onChanged;

  @override
  State<_PairingCodeDialog> createState() => _PairingCodeDialogState();
}

class _PairingCodeDialogState extends State<_PairingCodeDialog> {
  late final code = TextEditingController(text: widget.initialCode);
  bool _submitted = false;
  DesktopController get desktop => widget.desktop;

  @override
  void dispose() {
    code.dispose();
    super.dispose();
  }

  String? get _relayError {
    if (widget.relay.trim().isEmpty) return 'A relay URL is required.';
    try {
      var uri = Uri.parse(widget.relay.trim());
      if (uri.scheme == 'https' || uri.scheme == 'http') {
        uri = uri.replace(scheme: uri.scheme == 'https' ? 'wss' : 'ws');
      }
      validateRelay(uri.toString(), allowLocal: desktop.pairings.allowLocal);
      return null;
    } on FormatException catch (e) {
      return e.message;
    }
  }

  bool get _validCode {
    try {
      normalizePairingCode(code.text);
      return true;
    } on FormatException {
      return false;
    }
  }

  Future<void> _submit(BuildContext context) async {
    if (desktop.busy ||
        desktop.connected ||
        !_validCode ||
        _relayError != null) {
      return;
    }
    final route = ModalRoute.of(context);
    final navigator = Navigator.of(context);
    setState(() => _submitted = true);
    await desktop.pairCode(code.text, widget.relay);
    if (mounted &&
        navigator.mounted &&
        route?.navigator == navigator &&
        route?.isCurrent == true &&
        desktop.connected) {
      navigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([desktop, code]),
    builder: (context, _) {
      final theme = Theme.of(context);
      final scheme = theme.colorScheme;
      final dark = theme.brightness == Brightness.dark;
      final glass = DjlAppearance.of(context).liquidGlass;
      final reducedMotion = MediaQuery.disableAnimationsOf(context);
      final radius = BorderRadius.circular(32);
      final enabled = !desktop.busy && !desktop.connected;
      final relayError = _relayError;
      final pairingError = _submitted ? desktop.error : null;
      final secondary = theme.textTheme.bodyMedium!.copyWith(
        color: scheme.onSurfaceVariant,
        height: 1.4,
      );
      final panel = DecoratedBox(
        position: DecorationPosition.foreground,
        decoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(
            color: glass && !dark
                ? Colors.white.withValues(alpha: .86)
                : scheme.outlineVariant,
          ),
        ),
        child: ColoredBox(
          color: scheme.surface.withValues(alpha: glass ? .86 : 1),
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(color: scheme.outlineVariant),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(11),
                      child: Icon(
                        CupertinoIcons.device_laptop,
                        color: scheme.onSurface,
                        size: 22,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Semantics(
                  header: true,
                  child: Text(
                    'Enter one-time code',
                    style: theme.textTheme.headlineMedium!.copyWith(
                      fontSize: 23,
                      height: 1.15,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Find your code in DJL Desktop under Settings → Remote.',
                  style: secondary,
                ),
                const SizedBox(height: 22),
                MergeSemantics(
                  child: TextField(
                    key: const Key('pairing_code'),
                    controller: code,
                    onChanged: (value) {
                      if (_submitted) setState(() => _submitted = false);
                      widget.onChanged(value);
                    },
                    enabled: enabled,
                    style: theme.textTheme.bodyLarge!.copyWith(
                      fontFamily: 'GeistMono',
                      letterSpacing: .7,
                    ),
                    decoration: InputDecoration(
                      label: const Text('Pairing code'),
                      floatingLabelBehavior: FloatingLabelBehavior.always,
                      hintText: 'ABCD-EF2345',
                      filled: true,
                      fillColor: scheme.surfaceContainerLow,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: BorderSide(color: scheme.outlineVariant),
                      ),
                    ),
                    textCapitalization: TextCapitalization.characters,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    textInputAction: TextInputAction.done,
                    autocorrect: false,
                    enableSuggestions: false,
                    smartDashesType: SmartDashesType.disabled,
                    onSubmitted: (_) => _submit(context),
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      relayError ?? 'Relay configured',
                      style: secondary.copyWith(fontSize: 13),
                    ),
                    TextButton(
                      onPressed: enabled
                          ? () => Navigator.pop(context, 'relay')
                          : null,
                      child: const Text('Relay settings'),
                    ),
                  ],
                ),
                if (desktop.busy || pairingError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4, bottom: 8),
                    child: Semantics(
                      liveRegion: true,
                      child: Text(
                        desktop.busy ? 'Pairing…' : pairingError!,
                        style: secondary.copyWith(
                          color: desktop.busy
                              ? scheme.onSurfaceVariant
                              : scheme.error,
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 10),
                Divider(height: 1, color: scheme.outlineVariant),
                const SizedBox(height: 12),
                OverflowBar(
                  alignment: MainAxisAlignment.end,
                  overflowAlignment: OverflowBarAlignment.end,
                  spacing: 8,
                  overflowSpacing: 4,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(94, 48),
                        disabledBackgroundColor: scheme.surfaceContainerHigh,
                        disabledForegroundColor: scheme.onSurfaceVariant,
                      ),
                      onPressed: enabled && _validCode && relayError == null
                          ? () => _submit(context)
                          : null,
                      child: desktop.busy && !reducedMotion
                          ? const CupertinoActivityIndicator()
                          : const Text('Pair'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
      return Dialog(
        backgroundColor: Colors.transparent,
        elevation: 0,
        insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        insetAnimationDuration: reducedMotion
            ? Duration.zero
            : const Duration(milliseconds: 160),
        constraints: const BoxConstraints(maxWidth: 400),
        child: ClipRRect(
          borderRadius: radius,
          child: glass
              ? DjlGlassSurface(radius: 32, useNativeView: false, child: panel)
              : panel,
        ),
      );
    },
  );
}

class _SecurePairingSheet extends StatefulWidget {
  const _SecurePairingSheet({
    required this.desktop,
    required this.initialPayload,
    required this.initialRelay,
    required this.onPayloadChanged,
    required this.onRelayChanged,
    required this.onPair,
  });
  final DesktopController desktop;
  final String initialPayload, initialRelay;
  final ValueChanged<String> onPayloadChanged, onRelayChanged;
  final Future<String?> Function(String) onPair;
  @override
  State<_SecurePairingSheet> createState() => _SecurePairingSheetState();
}

class _SecurePairingSheetState extends State<_SecurePairingSheet> {
  late final payload = TextEditingController(text: widget.initialPayload);
  late final relay = TextEditingController(text: widget.initialRelay);
  String? _error;

  @override
  void dispose() {
    payload.dispose();
    relay.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (widget.desktop.busy || widget.desktop.connected) return;
    setState(() => _error = null);
    final route = ModalRoute.of(context);
    final navigator = Navigator.of(context);
    final error = await widget.onPair(payload.text);
    if (!mounted) return;
    if (widget.desktop.connected) {
      if (navigator.mounted &&
          route?.navigator == navigator &&
          route?.isCurrent == true) {
        navigator.pop();
      }
    } else {
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.desktop,
    builder: (context, _) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(
        heightFactor: .94,
        child: Column(
          children: [
            const _PairingSheetHeader(title: 'Secure pairing details'),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  const Text(
                    'Open DJL desktop → Settings → Remote. Paste its pairing payload, or configure the relay used by your one-time code.',
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    key: const Key('pairing_payload'),
                    controller: payload,
                    onChanged: widget.onPayloadChanged,
                    enabled: !widget.desktop.busy && !widget.desktop.connected,
                    minLines: 2,
                    maxLines: 5,
                    autocorrect: false,
                    decoration: InputDecoration(
                      fillColor: Theme.of(context).colorScheme.surface,
                      label: const Text('Paste pairing code'),
                      hintText: 'RMX1:… or QR JSON',
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: widget.desktop.busy || widget.desktop.connected
                        ? null
                        : _submit,
                    child: const Text('Pair securely'),
                  ),
                  if (widget.desktop.busy) ...[
                    const LinearProgressIndicator(),
                    Text(widget.desktop.state),
                  ],
                  if (_error != null || widget.desktop.error != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        (_error ?? widget.desktop.error!).replaceFirst(
                          RegExp(r'^FormatException: '),
                          '',
                        ),
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  const Divider(height: 32),
                  TextField(
                    key: const Key('pairing_relay'),
                    controller: relay,
                    onChanged: widget.onRelayChanged,
                    enabled: !widget.desktop.busy && !widget.desktop.connected,
                    decoration: InputDecoration(
                      fillColor: Theme.of(context).colorScheme.surface,
                      label: const Text('Desktop relay URL'),
                      hintText: 'wss://your-relay/relay',
                    ),
                    keyboardType: TextInputType.url,
                    textInputAction: TextInputAction.done,
                    autocorrect: false,
                    onSubmitted: (_) => FocusScope.of(context).unfocus(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
