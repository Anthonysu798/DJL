import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import 'chat_controller.dart';
import 'cloud_usage_reset_confirmation.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';
import '../../../l10n/l10n.dart';

class CloudUsageBanner extends StatefulWidget {
  const CloudUsageBanner({
    super.key,
    required this.controller,
    required this.canAct,
  });
  final ChatController controller;
  final bool Function() canAct;
  @override
  State<CloudUsageBanner> createState() => _CloudUsageBannerState();
}

class _CloudUsageBannerState extends State<CloudUsageBanner> {
  bool _reviewing = false;
  Future<void> _review() async {
    final chat = widget.controller;
    if (_reviewing || chat.redeemingUsage || !widget.canAct()) return;
    final box = context.findRenderObject() as RenderBox;
    final anchor = box.localToGlobal(Offset.zero) & box.size;
    setState(() => _reviewing = true);
    FocusScope.of(context).unfocus();
    try {
      final confirmed = await showCloudUsageResetConfirmation(context, anchor);
      if (mounted &&
          confirmed &&
          widget.controller == chat &&
          widget.canAct() &&
          ModalRoute.of(context)?.isCurrent != false) {
        await chat.redeemUsageReset();
      }
    } finally {
      if (mounted) setState(() => _reviewing = false);
    }
  }

  String _description(BuildContext context) {
    final date = DateTime.tryParse(
      widget.controller.usageBlockedUntil ?? '',
    )?.toLocal();
    final l10n = context.l10n;
    if (date == null) return l10n.cloudChatLimitFreesSoon;
    final now = DateTime.now();
    final difference = date.difference(now);
    if (difference <= Duration.zero) return l10n.cloudChatResetsNow;
    final days = DateTime.utc(
      date.year,
      date.month,
      date.day,
    ).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
    if (days == 1) return l10n.cloudChatResetsTomorrow;
    if (days > 1 && days < 7) return l10n.cloudChatResetsInDays(days);
    if (days >= 7) {
      return l10n.cloudChatResetsOn(
        MaterialLocalizations.of(context).formatMediumDate(date),
      );
    }
    final minutes = (difference.inSeconds / 60).ceil();
    if (minutes < 1) return l10n.cloudChatResetsInAMoment;
    if (minutes < 60) {
      return l10n.cloudChatResetsInMinutes(minutes);
    }
    final hours = (minutes / 60).ceil();
    return l10n.cloudChatResetsInHours(hours);
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.controller, colors = Theme.of(context).colorScheme;
    final busy = _reviewing || chat.redeemingUsage;
    return Container(
      key: const ValueKey('cloud-usage-banner'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(DjlRadius.md),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(DjlIcons.hourglass, size: 17, color: colors.onSurface),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      context.l10n.cloudChatUsageLimitReached,
                      style: cloudBodyStyle.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _description(context),
                      style: cloudBodyStyle.copyWith(
                        fontSize: 12,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (chat.usageLoading)
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: CupertinoActivityIndicator(),
            ),
          if (chat.usageError case final error?) ...[
            const SizedBox(height: 8),
            Text(
              error,
              style: cloudBodyStyle.copyWith(fontSize: 12, color: colors.error),
            ),
            TextButton(
              onPressed: busy || !widget.canAct() ? null : chat.refreshUsage,
              child: Text(context.l10n.cloudChatRetryUsage),
            ),
          ],
          if ((chat.usage?.bankedResets ?? 0) > 0) ...[
            const SizedBox(height: 10),
            FilledButton(
              onPressed: busy || chat.usageLoading || !widget.canAct()
                  ? null
                  : _review,
              style: FilledButton.styleFrom(
                backgroundColor: cloudActionColor(context),
                foregroundColor: DjlColors.of(context).onInk,
                minimumSize: const Size(0, 30),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                shape: const StadiumBorder(),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (chat.redeemingUsage) ...[
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CupertinoActivityIndicator(
                        color: DjlColors.of(context).onInk,
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Flexible(
                    child: Text(
                      context.l10n.cloudChatUseBankedReset(
                        chat.usage!.bankedResets,
                      ),
                      textAlign: TextAlign.center,
                      style: cloudBodyStyle.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
