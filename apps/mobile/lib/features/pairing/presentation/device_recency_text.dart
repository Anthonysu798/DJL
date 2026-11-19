import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../domain/device_recency.dart';

class DeviceRecencyText extends StatefulWidget {
  const DeviceRecencyText({
    super.key,
    required this.status,
    this.date,
    this.style,
    this.statusColor,
    this.maxLines = 1,
  });
  final String status;
  final DateTime? date;
  final TextStyle? style;
  final Color? statusColor;
  final int maxLines;

  @override
  State<DeviceRecencyText> createState() => _DeviceRecencyTextState();
}

class _DeviceRecencyTextState extends State<DeviceRecencyText>
    with WidgetsBindingObserver {
  static const _channel = MethodChannel('djl.mobile/app-info');
  (int, String, int)? _scope;
  DateTime _reference = DateTime.now();
  Future<String?>? _localized;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didUpdateWidget(DeviceRecencyText oldWidget) {
    super.didUpdateWidget(oldWidget);
    _load();
  }

  @override
  void didChangeLocales(List<Locale>? locales) {
    setState(() => _load(force: true));
  }

  void _load({bool force = false}) {
    final date = widget.date, now = DateTime.now();
    final locales = WidgetsBinding.instance.platformDispatcher.locales;
    final scope = date == null
        ? null
        : (
            date.millisecondsSinceEpoch,
            locales.isEmpty ? '' : locales.first.toLanguageTag(),
            now.millisecondsSinceEpoch ~/ 1000,
          );
    if (!force && scope == _scope) return;
    _scope = scope;
    _reference = now;
    _request++;
    _localized = date == null ? null : _format(date, now);
  }

  Future<String?> _format(DateTime date, DateTime reference) async {
    try {
      final value = await _channel.invokeMethod<Object?>('relativeDate', {
        'date': date.millisecondsSinceEpoch,
        'relativeTo': reference.millisecondsSinceEpoch,
      });
      return value is String && value.trim().isNotEmpty ? value : null;
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Widget _text(String text) => Text.rich(
    TextSpan(
      children: [
        TextSpan(
          text: widget.status,
          style: TextStyle(color: widget.statusColor),
        ),
        TextSpan(text: text.substring(widget.status.length)),
      ],
    ),
    maxLines: widget.maxLines,
    overflow: TextOverflow.ellipsis,
    style: widget.style,
  );

  @override
  Widget build(BuildContext context) => widget.date == null
      ? _text(widget.status)
      : FutureBuilder<String?>(
          key: ValueKey(_request),
          future: _localized,
          builder: (context, snapshot) => _text(
            '${widget.status} · ${snapshot.data ?? deviceRecencyLabel(widget.date!, _reference)}',
          ),
        );
}
