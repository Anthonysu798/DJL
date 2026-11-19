import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../settings/presentation/settings_group.dart';
import 'account_controller.dart';
import 'cloud_signout_confirmation.dart';
import '../domain/account_snapshot.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({
    super.key,
    required this.controller,
    required this.onSignOut,
    required this.onMyMacs,
  });
  final AccountController controller;
  final Future<void> Function() onSignOut;
  final VoidCallback onMyMacs;
  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> with WidgetsBindingObserver {
  late final int _revision;
  Timer? _clock;
  bool _foreground = true, _prompting = false;
  bool get _current =>
      mounted && widget.controller.repository.client.revision == _revision;
  @override
  void initState() {
    super.initState();
    _revision = widget.controller.repository.client.revision;
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _clock = Timer.periodic(const Duration(minutes: 1), (_) {
      if (_current && _foreground) setState(() {});
    });
  }

  Future<void> _refresh() async {
    final c = widget.controller;
    if (_current && !c.loading && !c.busy) await c.refresh();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) unawaited(_refresh());
  }

  @override
  void dispose() {
    _clock?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.dispose();
    super.dispose();
  }

  Future<void> _signOut() async {
    if (!_current || _prompting || widget.controller.busy) return;
    setState(() => _prompting = true);
    try {
      final confirmed = await showCloudSignOutConfirmation(context);
      if (confirmed == true && _current && !widget.controller.busy) {
        await widget.onSignOut();
      }
    } finally {
      if (mounted) setState(() => _prompting = false);
    }
  }

  Future<void> _delete() async {
    if (!_current || _prompting || widget.controller.busy) return;
    setState(() => _prompting = true);
    try {
      final confirmation = await showCupertinoDialog<String>(
        context: context,
        builder: (_) => const _DeleteAccountDialog(),
      );
      if (confirmation == null || !mounted || !_current) return;
      if (confirmation.trim().toUpperCase() != 'DELETE') {
        await showCupertinoDialog<void>(
          context: context,
          builder: (context) => CupertinoAlertDialog(
            title: const Text('Something went wrong'),
            content: const Text('Type DELETE to confirm.'),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.pop(context),
                child: const Text('OK'),
              ),
            ],
          ),
        );
        return;
      }
      if (await widget.controller.delete(confirmation) && _current) {
        await widget.onSignOut();
      }
    } finally {
      if (mounted) setState(() => _prompting = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller, a = c.snapshot;
      final enabled = !c.busy && !_prompting && _current;
      final colors = Theme.of(context).colorScheme;
      final secondary = cloudBodyStyle.copyWith(
        fontSize: 13,
        color: colors.onSurfaceVariant,
      );
      final bankDate = a?.bankExpiry?.toLocal();
      Widget action(
        String text,
        VoidCallback callback, {
        bool destructive = false,
      }) => ListTile(
        minTileHeight: 52,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        title: Text(
          text,
          style: cloudBodyStyle.copyWith(
            color: destructive
                ? DjlColors.of(context).danger
                : cloudActionColor(context),
          ),
        ),
        onTap: enabled ? callback : null,
      );
      return Scaffold(
        backgroundColor: cloudGroupedBackground(context),
        body: SafeArea(
          top: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 16, bottom: 8),
                child: CupertinoNavigationBar(
                  automaticallyImplyLeading: false,
                  transitionBetweenRoutes: false,
                  border: null,
                  backgroundColor: cloudGroupedBackground(context),
                  middle: Semantics(
                    header: true,
                    child: Text(
                      'Account',
                      style: cloudBodyStyle.copyWith(
                        fontWeight: FontWeight.w600,
                        color: colors.onSurface,
                      ),
                    ),
                  ),
                  trailing: Container(
                    decoration: BoxDecoration(
                      color: colors.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: CupertinoButton(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      onPressed: () => Navigator.pop(context),
                      child: Text(
                        'Done',
                        style: cloudBodyStyle.copyWith(
                          fontWeight: FontWeight.w600,
                          color: colors.onSurface,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 36, 16, 24),
                    children: [
                      if (c.loading || c.busy)
                        const Padding(
                          padding: EdgeInsets.only(bottom: 12),
                          child: CupertinoActivityIndicator(),
                        ),
                      if (c.error != null)
                        ListTile(
                          title: Text(
                            c.error!,
                            style: TextStyle(color: colors.error),
                          ),
                          trailing: TextButton(
                            onPressed: enabled && !c.loading ? _refresh : null,
                            child: const Text('Retry'),
                          ),
                        ),
                      SettingsGroup(
                        children: [
                          CloudValueRow(label: 'Email', value: a?.email ?? '—'),
                          CloudValueRow(
                            label: 'Plan',
                            value: a == null || a.plan.isEmpty
                                ? '—'
                                : '${a.plan[0].toUpperCase()}${a.plan.substring(1)}',
                          ),
                          CloudValueRow(
                            label: 'Credits',
                            value: a?.credits ?? '—',
                          ),
                        ],
                      ),
                      if (a != null)
                        SettingsGroup(
                          title: 'Usage',
                          footer:
                              'A banked reset starts both limits over and restarts your week. Banks expire 90 days after they\'re granted.',
                          children: [
                            _usage(context, '5-hour limit', a.fiveHour),
                            _usage(context, 'Weekly limit', a.week),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              child: LayoutBuilder(
                                builder: (context, constraints) => Wrap(
                                  alignment: WrapAlignment.spaceBetween,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  spacing: 12,
                                  runSpacing: 8,
                                  children: [
                                    ConstrainedBox(
                                      constraints: BoxConstraints(
                                        maxWidth: constraints.maxWidth,
                                      ),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          const Text(
                                            'Banked resets',
                                            style: cloudBodyStyle,
                                          ),
                                          if (bankDate != null)
                                            Text(
                                              'Next expires ${MaterialLocalizations.of(context).formatShortMonthDay(bankDate)}, ${bankDate.year}',
                                              style: secondary,
                                            ),
                                        ],
                                      ),
                                    ),
                                    if (a.bankedResets == 0)
                                      Text(
                                        'None',
                                        style: cloudBodyStyle.copyWith(
                                          color: colors.onSurfaceVariant,
                                        ),
                                      )
                                    else
                                      TextButton(
                                        style: TextButton.styleFrom(
                                          foregroundColor: cloudActionColor(
                                            context,
                                          ),
                                          backgroundColor: colors.onSurface
                                              .withValues(alpha: .08),
                                          textStyle: cloudBodyStyle,
                                        ),
                                        onPressed: enabled ? c.redeem : null,
                                        child: Text(
                                          'Use 1 of ${a.bankedResets}',
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      SettingsGroup(
                        children: [
                          ListTile(
                            minTileHeight: 52,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16,
                            ),
                            leading: Icon(
                              DjlIcons.laptop,
                              size: 26,
                              color: colors.onSurface,
                            ),
                            title: const Text('My Macs', style: cloudBodyStyle),
                            onTap: enabled
                                ? () {
                                    if (_current) widget.onMyMacs();
                                  }
                                : null,
                          ),
                        ],
                      ),
                      SettingsGroup(
                        footer:
                            'Deleting your account removes your chats, files, and credits. You have 30 days to change your mind by contacting support.',
                        children: [
                          action('Sign out', _signOut),
                          action('Delete account', _delete, destructive: true),
                        ],
                      ),
                      const SafeArea(top: false, child: SizedBox.shrink()),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  Widget _usage(BuildContext context, String label, UsageWindow window) {
    final colors = Theme.of(context).colorScheme;
    final color = window.fraction >= 1
        ? DjlColors.of(context).danger
        : cloudActionColor(context);
    final reset = window.resetsAt == null
        ? null
        : _resetDescription(window.resetsAt!);
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: [
        label,
        '${(window.fraction * 100).round()}% used',
        ?reset,
      ].join('\n'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 12,
              runSpacing: 4,
              children: [
                Text(label, style: cloudBodyStyle),
                Text(
                  '${(window.fraction * 100).round()}% used',
                  style: cloudBodyStyle.copyWith(
                    color: window.fraction >= 1
                        ? color
                        : colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            LinearProgressIndicator(
              value: window.fraction,
              color: color,
              backgroundColor: colors.onSurface.withValues(alpha: .10),
              borderRadius: BorderRadius.circular(3),
            ),
            if (reset != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  reset,
                  style: cloudBodyStyle.copyWith(
                    fontSize: 13,
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _resetDescription(DateTime date) {
    final seconds = date.difference(DateTime.now()).inSeconds;
    final value = seconds.abs();
    if (value == 0) return 'Resets now';
    var count = value;
    var unit = 'second';
    if (value >= 60) {
      count = (value / 60).round();
      unit = 'minute';
      if (count >= 60) {
        count = (value / 3600).round();
        unit = 'hour';
        if (count >= 24) {
          count = (value / 86400).round();
          unit = 'day';
          if (count == 1) {
            return seconds >= 0 ? 'Resets tomorrow' : 'Resets yesterday';
          }
          if (count >= 7) {
            count = (value / 604800).round();
            unit = 'week';
            if (count == 1) {
              return seconds >= 0 ? 'Resets next week' : 'Resets last week';
            }
          }
        }
      }
    }
    final quantity = '$count $unit${count == 1 ? '' : 's'}';
    return seconds >= 0 ? 'Resets in $quantity' : 'Resets $quantity ago';
  }
}

class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog();
  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final _input = TextEditingController();
  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CupertinoAlertDialog(
    title: const Text('Delete your account?'),
    content: Column(
      children: [
        const Text(
          'This can\'t be undone after 30 days. Type DELETE to confirm.',
        ),
        const SizedBox(height: 16),
        CupertinoTextField(
          controller: _input,
          placeholder: 'Type DELETE',
          textCapitalization: TextCapitalization.characters,
          autocorrect: false,
        ),
      ],
    ),
    actions: [
      CupertinoDialogAction(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      CupertinoDialogAction(
        isDestructiveAction: true,
        onPressed: () => Navigator.pop(context, _input.text),
        child: const Text('Delete account'),
      ),
    ],
  );
}
