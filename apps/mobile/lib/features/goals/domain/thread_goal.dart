import '../../pairing/data/pairing_repository.dart';
import '../../../l10n/l10n.dart';

enum GoalStatus {
  active,
  paused,
  blocked,
  usageLimited,
  budgetLimited,
  complete;

  bool get isResumable => {paused, blocked, usageLimited}.contains(this);
  bool get isTerminal => this == budgetLimited || this == complete;
  String get label => switch (this) {
    active => appStrings.goalsStatusActive,
    paused => appStrings.goalsStatusPaused,
    blocked => appStrings.goalsStatusBlocked,
    usageLimited => appStrings.goalsStatusUsageLimited,
    budgetLimited => appStrings.goalsStatusBudgetLimited,
    complete => appStrings.goalsStatusComplete,
  };
}

class GoalBudgetUpdate {
  const GoalBudgetUpdate.keep() : changed = false, tokens = null;
  const GoalBudgetUpdate.clear() : changed = true, tokens = null;
  const GoalBudgetUpdate.set(int value) : changed = true, tokens = value;
  final bool changed;
  final int? tokens;
}

class ThreadGoal {
  ThreadGoal.fromJson(RemoteJson value)
    : threadId = value['threadId'] as String,
      objective = value['objective'] as String,
      status = GoalStatus.values.byName(value['status'] as String),
      tokenBudget = value['tokenBudget'] as int?,
      tokensUsed = value['tokensUsed'] as int? ?? 0,
      timeUsedSeconds = value['timeUsedSeconds'] as int? ?? 0,
      createdAt = value['createdAt'] as int? ?? 0,
      updatedAt = value['updatedAt'] as int? ?? 0;
  final String threadId, objective;
  final GoalStatus status;
  final int? tokenBudget;
  final int tokensUsed, timeUsedSeconds, createdAt, updatedAt;
  RemoteJson toJson() => {
    'threadId': threadId,
    'objective': objective,
    'status': status.name,
    'tokenBudget': tokenBudget,
    'tokensUsed': tokensUsed,
    'timeUsedSeconds': timeUsedSeconds,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
  };
  int? get remainingTokens => tokenBudget == null
      ? null
      : (tokenBudget! - tokensUsed).clamp(0, tokenBudget!);
  String get usage => tokenBudget == null
      ? formatElapsed(timeUsedSeconds)
      : appStrings.goalsTokenUsage(
          formatTokens(tokensUsed),
          formatTokens(tokenBudget!),
        );
  static String formatTokens(int count) {
    if (count >= 1000000) {
      return '${(count / 1000000).toStringAsFixed(1)}M';
    }
    if (count >= 1000) {
      final value = count / 1000;
      return '${value == value.roundToDouble() ? value.toInt() : value.toStringAsFixed(1)}K';
    }
    return '$count';
  }

  static String formatElapsed(int seconds) {
    final value = seconds < 0 ? 0 : seconds,
        hours = value ~/ 3600,
        minutes = (value % 3600) ~/ 60,
        remainder = value % 60;
    return '${hours > 0 ? '${hours}h ' : ''}${hours > 0 || minutes > 0 ? '${minutes}m ' : ''}${remainder}s';
  }
}

class GoalsUnsupported implements Exception {
  const GoalsUnsupported();
  @override
  String toString() => appStrings.goalsUnsupported;
}

class EphemeralGoal implements Exception {
  const EphemeralGoal();
  @override
  String toString() => appStrings.goalsEphemeral;
}
