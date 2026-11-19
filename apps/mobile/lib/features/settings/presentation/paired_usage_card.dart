import 'dart:async';
import 'package:flutter/material.dart';
import '../domain/appearance.dart';
import 'paired_usage_controller.dart';
import 'settings_group.dart';

import '../../../core/design/djl_icons.dart';

class PairedUsageCard extends StatefulWidget {
  const PairedUsageCard({super.key, required this.controller});
  final PairedUsageController controller;
  @override
  State<PairedUsageCard> createState() => _PairedUsageCardState();
}

class _PairedUsageCardState extends State<PairedUsageCard>
    with WidgetsBindingObserver {
  late int _binding;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.addListener(_changed);
    _binding = widget.controller.bindingRevision;
    _refreshIfNeeded();
  }

  void _refreshIfNeeded() {
    final controller = widget.controller;
    scheduleMicrotask(() {
      if (mounted && identical(controller, widget.controller)) {
        unawaited(controller.refreshIfNeeded());
      }
    });
  }

  void _changed() {
    if (_binding == widget.controller.bindingRevision) return;
    _binding = widget.controller.bindingRevision;
    _refreshIfNeeded();
  }

  @override
  void didUpdateWidget(PairedUsageCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_changed);
      widget.controller.addListener(_changed);
      _binding = widget.controller.bindingRevision;
      _refreshIfNeeded();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshIfNeeded();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  String _reset(BuildContext context, DateTime date) {
    final value = date.toLocal(), now = DateTime.now();
    final localizations = MaterialLocalizations.of(context);
    final time = localizations.formatTimeOfDay(
      TimeOfDay.fromDateTime(value),
      alwaysUse24HourFormat: true,
    );
    final today =
        value.year == now.year &&
        value.month == now.month &&
        value.day == now.day;
    return 'resets ${today ? time : '${localizations.formatShortDate(value)} $time'}';
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller, colors = Theme.of(context).colorScheme;
      final rows = c.rows;
      final mono = TextStyle(
        fontFamily: DjlAppearance.of(context).font.codeFamily,
        fontSize: 14,
      );
      return SettingsGroup(
        title: 'Usage',
        footer: 'Account-wide rate limits from your paired device.',
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (rows.isEmpty)
                  Text(
                    c.error ??
                        (c.loading
                            ? 'Loading current limits...'
                            : !c.canRead
                            ? 'Connect your paired device to load current limits.'
                            : 'Rate limits are unavailable for this account.'),
                    style: TextStyle(
                      fontSize: 13,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                for (var i = 0; i < rows.length; i++) ...[
                  if (i > 0) const SizedBox(height: 14),
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    spacing: 10,
                    runSpacing: 6,
                    children: [
                      Text(
                        rows[i].label,
                        style: mono.copyWith(color: colors.onSurfaceVariant),
                      ),
                      Text(
                        '${rows[i].window.remainingPercent}% left',
                        style: mono.copyWith(color: colors.onSurface),
                      ),
                      if (rows[i].window.resetsAt case final reset?)
                        Text(
                          '(${_reset(context, reset)})',
                          style: mono.copyWith(
                            fontSize: 12,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ExcludeSemantics(
                    child: LinearProgressIndicator(
                      value: rows[i].window.clampedUsedPercent / 100,
                      minHeight: 14,
                      borderRadius: BorderRadius.circular(10),
                      color: colors.onSurface,
                      backgroundColor: colors.onSurface.withValues(alpha: .1),
                    ),
                  ),
                ],
                if (c.stale) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Last known limits. Reconnect or refresh to update.',
                    style: TextStyle(
                      fontSize: 13,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
                Align(
                  alignment: Alignment.centerRight,
                  heightFactor: 1,
                  child: Tooltip(
                    message: 'Refresh usage',
                    child: TextButton.icon(
                      onPressed: c.canRead && !c.loading
                          ? () => unawaited(c.refresh())
                          : null,
                      icon: c.loading
                          ? const SizedBox.square(
                              dimension: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 1.5,
                              ),
                            )
                          : const Icon(DjlIcons.refresh, size: 15),
                      label: Text(c.loading ? 'Refreshing...' : 'Refresh'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    },
  );
}
