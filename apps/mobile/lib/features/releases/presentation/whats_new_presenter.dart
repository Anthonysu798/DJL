import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../settings/data/settings_store.dart';
import 'whats_new_sheet.dart';

class WhatsNewPresenter extends StatefulWidget {
  const WhatsNewPresenter({
    super.key,
    required this.store,
    required this.isAllowed,
    required this.child,
  });
  final SettingsStore store;
  final bool Function() isAllowed;
  final Widget child;
  @override
  State<WhatsNewPresenter> createState() => _WhatsNewPresenterState();
}

class _WhatsNewPresenterState extends State<WhatsNewPresenter>
    with WidgetsBindingObserver {
  static const _appInfo = MethodChannel('djl.mobile/app-info');
  static const _seenKey = 'djl.mobile.whatsNew.lastPresentedVersion';
  Timer? _timer;
  String? _version;
  bool _seen = false, _disposed = false, _removing = false;
  bool _foreground = true;
  final _pointers = <int>{};
  ModalBottomSheetRoute<bool>? _sheet;

  bool get _baseAllowed =>
      !_disposed &&
      _foreground &&
      widget.isAllowed() &&
      _pointers.isEmpty &&
      MediaQuery.viewInsetsOf(context).bottom == 0 &&
      FocusManager.instance.primaryFocus?.context
              ?.findAncestorStateOfType<EditableTextState>() ==
          null;
  bool get _canPresent =>
      _baseAllowed && ModalRoute.of(context)?.isCurrent == true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_sync);
    _foreground =
        (WidgetsBinding.instance.lifecycleState ?? AppLifecycleState.resumed) ==
        AppLifecycleState.resumed;
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final version = (await _appInfo.invokeMethod<String>('version'))?.trim();
      if (_disposed || !whatsNewNotes.containsKey(version)) return;
      final saved = await widget.store.read();
      if (_disposed) return;
      _version = version;
      _seen = saved[_seenKey] == version;
      _sync();
    } catch (_) {
      // An optional release notice cannot block startup when metadata or
      // preferences are unavailable. A later root entry can retry the read.
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(covariant WhatsNewPresenter oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _restartQuietPeriod();
  }

  void _restartQuietPeriod() {
    _timer?.cancel();
    _timer = null;
    _sync();
  }

  void _sync() {
    if (_disposed) return;
    if (_sheet case final sheet?) {
      if (!_baseAllowed && !_removing) {
        _removing = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final navigator = sheet.navigator;
          if (identical(_sheet, sheet) &&
              navigator != null &&
              navigator.mounted) {
            navigator.removeRoute(sheet, false);
          }
        });
      }
      return;
    }
    if (_version == null || _seen || !_canPresent) {
      _timer?.cancel();
      _timer = null;
      return;
    }
    _timer ??= Timer(const Duration(seconds: 30), () {
      _timer = null;
      if (_canPresent && !_seen) unawaited(_present());
    });
  }

  Future<void> _present() async {
    final version = _version!;
    final navigator = Navigator.of(context);
    final sheet = ModalBottomSheetRoute<bool>(
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: false,
      backgroundColor: Theme.of(context).colorScheme.surface,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      capturedThemes: InheritedTheme.capture(
        from: context,
        to: navigator.context,
      ),
      builder: (context) => WhatsNewSheet(
        version: version,
        onDismiss: () => Navigator.pop(context, true),
      ),
    );
    _sheet = sheet;
    final dismissed = await navigator.push(sheet);
    _sheet = null;
    _removing = false;
    if (_disposed) return;
    if (dismissed != false && (dismissed == true || _canPresent)) {
      _seen = true;
      try {
        await widget.store.write(_seenKey, version);
      } catch (_) {
        // Do not repeat in this session if a preference write fails. The next
        // launch can retry an announcement that was not saved successfully.
      }
    }
    _sync();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    FocusManager.instance.removeListener(_sync);
    if (_sheet case final sheet?) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final navigator = sheet.navigator;
        if (navigator != null && navigator.mounted) {
          navigator.removeRoute(sheet, false);
        }
      });
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      NotificationListener<ScrollNotification>(
        onNotification: (_) {
          _restartQuietPeriod();
          return false;
        },
        child: Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (event) {
            _pointers.add(event.pointer);
            _restartQuietPeriod();
          },
          onPointerUp: (event) {
            _pointers.remove(event.pointer);
            _restartQuietPeriod();
          },
          onPointerCancel: (event) {
            _pointers.remove(event.pointer);
            _restartQuietPeriod();
          },
          child: widget.child,
        ),
      );
}
