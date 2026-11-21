import 'package:flutter/material.dart';
import '../domain/guardian_review.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

/// Reasons are stored and compared in English; only the display is translated.
String _reason(BuildContext context, String reason) => switch (reason) {
  guardianLiveReason => context.l10n.guardianLiveReason,
  guardianExpiredReason => context.l10n.guardianExpiredReason,
  guardianDesktopReason => context.l10n.guardianDesktopReason,
  guardianUnsafeReason => context.l10n.guardianUnsafeReason,
  guardianSubmittedReason => context.l10n.guardianSubmittedReason,
  guardianUncertainReason => context.l10n.guardianUncertainReason,
  _ => reason,
};

class GuardianReviewCard extends StatelessWidget {
  const GuardianReviewCard({super.key, required this.review, this.onRetry});
  final GuardianReview review;
  final Future<bool> Function()? onRetry;
  @override
  Widget build(BuildContext context) => ExpansionTile(
    leading: review.isTerminal
        ? Icon(
            review.status == 'denied' ? DjlIcons.warning : DjlIcons.checklist,
            size: 20,
          )
        : const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
    title: Text(context.l10n.guardianAutoReviewTitle(review.statusLabel)),
    childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
    expandedCrossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SelectableText(review.summary),
      if (review.riskLevel?.trim().isNotEmpty == true)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(switch (review.riskLevel!.trim()) {
            'low' => context.l10n.guardianRiskLow,
            'medium' => context.l10n.guardianRiskMedium,
            'high' => context.l10n.guardianRiskHigh,
            final level => context.l10n.guardianRiskOther(
              '${level[0].toUpperCase()}${level.substring(1)}',
            ),
          }),
        ),
      if (review.userAuthorization?.trim().isNotEmpty == true)
        Text(
          context.l10n.guardianAuthorization(review.userAuthorization!.trim()),
        ),
      if (review.rationale?.trim().isNotEmpty == true)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(review.rationale!.trim()),
        ),
      if (review.status == 'denied')
        if (review.retryApproved)
          Text(context.l10n.guardianApprovalRecorded)
        else if (review.submitting)
          Text(context.l10n.guardianSubmittingApproval)
        else if (review.retryUnavailableReason != null || onRetry == null)
          Text(
            _reason(
              context,
              review.retryUnavailableReason ?? guardianLiveReason,
            ),
          )
        else
          FilledButton(
            onPressed: () => onRetry!(),
            child: Text(context.l10n.guardianApproveOneRetry),
          ),
    ],
  );
}
