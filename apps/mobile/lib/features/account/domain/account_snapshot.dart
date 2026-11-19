import '../../chat/domain/cloud_models.dart';

class UsageWindow {
  const UsageWindow(this.limit, this.used, this.resetsAt);
  final BigInt limit, used;
  final DateTime? resetsAt;
  double get fraction => limit <= BigInt.zero
      ? 0
      : (used.toDouble() / limit.toDouble()).clamp(0, 1);
  factory UsageWindow.fromJson(Json value) => UsageWindow(
    BigInt.parse(value['limit'] as String),
    BigInt.parse(value['used'] as String),
    DateTime.tryParse(value['resetsAt'] as String? ?? ''),
  );
}

class CloudUsageSnapshot {
  const CloudUsageSnapshot({
    required this.fiveHour,
    required this.week,
    required this.bankedResets,
    this.bankExpiry,
  });
  final UsageWindow fiveHour, week;
  final int bankedResets;
  final DateTime? bankExpiry;
  DateTime? get exhaustedReset =>
      fiveHour.limit > BigInt.zero && fiveHour.used >= fiveHour.limit
      ? fiveHour.resetsAt
      : week.limit > BigInt.zero && week.used >= week.limit
      ? week.resetsAt
      : null;
  factory CloudUsageSnapshot.fromJson(Json value) {
    final windows = value['windows'] as Json, banks = value['banks'] as Json;
    return CloudUsageSnapshot(
      fiveHour: UsageWindow.fromJson(windows['fiveHour'] as Json),
      week: UsageWindow.fromJson(windows['week'] as Json),
      bankedResets: banks['count'] as int,
      bankExpiry: DateTime.tryParse(banks['nextExpiresAt'] as String? ?? ''),
    );
  }
}

class AccountSnapshot {
  const AccountSnapshot({
    required this.email,
    required this.credits,
    required this.plan,
    required this.fiveHour,
    required this.week,
    required this.bankedResets,
    this.bankExpiry,
  });
  final String email, credits, plan;
  final UsageWindow fiveHour, week;
  final int bankedResets;
  final DateTime? bankExpiry;
  factory AccountSnapshot.fromJson(Json me, Json credits, Json usage) {
    final snapshot = CloudUsageSnapshot.fromJson(usage);
    return AccountSnapshot(
      email: (me['user'] as Json)['email'] as String,
      credits: (credits['display'] as Json)['total'] as String,
      plan: usage['planId'] as String? ?? 'free',
      fiveHour: snapshot.fiveHour,
      week: snapshot.week,
      bankedResets: snapshot.bankedResets,
      bankExpiry: snapshot.bankExpiry,
    );
  }
}
