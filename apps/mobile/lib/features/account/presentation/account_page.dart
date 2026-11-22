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
import '../../../l10n/l10n.dart';

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
            title: Text(context.l10n.accountSomethingWrong),
            content: Text(context.l10n.accountTypeDeleteToConfirm),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.pop(context),
                child: Text(context.l10n.accountOk),
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
      final l10n = context.l10n;
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
                      l10n.settingsAccount,
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
                        l10n.accountDone,
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
                            child: Text(l10n.settingsRetry),
                          ),
                        ),
                      SettingsGroup(
                        children: [
                          CloudValueRow(
                            label: l10n.accountEmail,
                            value: a?.email ?? '—',
                          ),
                          CloudValueRow(
                            label: l10n.accountPlan,
                            value: a == null || a.plan.isEmpty
                                ? '—'
                                : '${a.plan[0].toUpperCase()}${a.plan.substring(1)}',
                          ),
                          CloudValueRow(
                            label: l10n.accountCredits,
                            value: a?.credits ?? '—',
                          ),
                        ],
                      ),
                      if (a != null)
                        SettingsGroup(
                          title: l10n.settingsUsage,
                          footer: l10n.accountUsageFooter,
                          children: [
                            _usage(
                              context,
                              l10n.accountFiveHourLimit,
                              a.fiveHour,
                            ),
                            _usage(context, l10n.accountWeeklyLimit, a.week),
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
                                          Text(
                                            l10n.accountBankedResets,
                                            style: cloudBodyStyle,
                                          ),
                                          if (bankDate != null)
                                            Text(
                                              l10n.accountNextExpires(
                                                MaterialLocalizations.of(
                                                  context,
                                                ).formatShortMonthDay(bankDate),
                                                '${bankDate.year}',
                                              ),
                                              style: secondary,
                                            ),
                                        ],
                                      ),
                                    ),
                                    if (a.bankedResets == 0)
                                      Text(
                                        l10n.accountNone,
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
                                          l10n.accountUseOne(a.bankedResets),
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
                            title: Text(
                              l10n.settingsMyMacs,
                              style: cloudBodyStyle,
                            ),
                            onTap: enabled
                                ? () {
                                    if (_current) widget.onMyMacs();
                                  }
                                : null,
                          ),
                        ],
                      ),
                      SettingsGroup(
                        footer: l10n.accountDeleteFooter,
                        children: [
                          action(l10n.accountSignOut, _signOut),
                          action(
                            l10n.accountDelete,
                            _delete,
                            destructive: true,
                          ),
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
    final l10n = context.l10n;
    final used = l10n.accountUsedPercent((window.fraction * 100).round());
    final reset = window.resetsAt == null
        ? null
        : _resetDescription(l10n, window.resetsAt!);
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: [label, used, ?reset].join('\n'),
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
                  used,
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

  String _resetDescription(AppLocalizations l10n, DateTime date) {
    final seconds = date.difference(DateTime.now()).inSeconds;
    final value = seconds.abs();
    if (value == 0) return l10n.accountResetsNow;
    var count = value;
    String Function(int) unit = l10n.accountSeconds;
    if (value >= 60) {
      count = (value / 60).round();
      unit = l10n.accountMinutes;
      if (count >= 60) {
        count = (value / 3600).round();
        unit = l10n.accountHours;
        if (count >= 24) {
          count = (value / 86400).round();
          unit = l10n.accountDays;
          if (count == 1) {
            return seconds >= 0
                ? l10n.accountResetsTomorrow
                : l10n.accountResetsYesterday;
          }
          if (count >= 7) {
            count = (value / 604800).round();
            unit = l10n.accountWeeks;
            if (count == 1) {
              return seconds >= 0
                  ? l10n.accountResetsNextWeek
                  : l10n.accountResetsLastWeek;
            }
          }
        }
      }
    }
    final quantity = unit(count);
    return seconds >= 0
        ? l10n.accountResetsIn(quantity)
        : l10n.accountResetsAgo(quantity);
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
    title: Text(context.l10n.accountDeleteTitle),
    content: Column(
      children: [
        Text(context.l10n.accountDeleteBody),
        const SizedBox(height: 16),
        CupertinoTextField(
          controller: _input,
          placeholder: context.l10n.accountTypeDelete,
          textCapitalization: TextCapitalization.characters,
          autocorrect: false,
        ),
      ],
    ),
    actions: [
      CupertinoDialogAction(
        onPressed: () => Navigator.pop(context),
        child: Text(context.l10n.commonCancel),
      ),
      CupertinoDialogAction(
        isDestructiveAction: true,
        onPressed: () => Navigator.pop(context, _input.text),
        child: Text(context.l10n.accountDelete),
      ),
    ],
  );
}
