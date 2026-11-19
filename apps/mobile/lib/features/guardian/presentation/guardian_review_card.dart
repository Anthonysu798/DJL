import 'package:flutter/material.dart';
import '../domain/guardian_review.dart';

class GuardianReviewCard extends StatelessWidget {
  const GuardianReviewCard({super.key, required this.review, this.onRetry});
  final GuardianReview review;
  final Future<bool> Function()? onRetry;
  @override
  Widget build(BuildContext context) => ExpansionTile(
    leading: review.isTerminal
        ? Icon(
            review.status == 'denied'
                ? Icons.warning_amber_rounded
                : Icons.fact_check_outlined,
            size: 20,
          )
        : const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
    title: Text('Auto-review · ${review.statusLabel}'),
    childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
    expandedCrossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SelectableText(review.summary),
      if (review.riskLevel?.trim().isNotEmpty == true)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            '${review.riskLevel!.trim()[0].toUpperCase()}${review.riskLevel!.trim().substring(1)} risk',
          ),
        ),
      if (review.userAuthorization?.trim().isNotEmpty == true)
        Text('Authorization: ${review.userAuthorization!.trim()}'),
      if (review.rationale?.trim().isNotEmpty == true)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(review.rationale!.trim()),
        ),
      if (review.status == 'denied')
        if (review.retryApproved)
          const Text('Approval recorded; the retry will still be reviewed')
        else if (review.submitting)
          const Text('Submitting retry approval…')
        else if (review.retryUnavailableReason != null || onRetry == null)
          Text(review.retryUnavailableReason ?? guardianLiveReason)
        else
          FilledButton(
            onPressed: () => onRetry!(),
            child: const Text('Approve one retry'),
          ),
    ],
  );
}
