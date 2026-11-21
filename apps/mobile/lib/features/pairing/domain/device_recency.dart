import '../../../l10n/l10n.dart';

String deviceRecencyLabel(DateTime date, DateTime now) {
  final strings = appStrings;
  final difference = now.difference(date);
  final seconds = difference.inSeconds.abs();
  if (seconds < 60) return strings.pairingRecencyNow;
  final age = seconds < 3600
      ? strings.pairingRecencyMinutes(seconds ~/ 60)
      : seconds < 86400
      ? strings.pairingRecencyHours(seconds ~/ 3600)
      : strings.pairingRecencyDays(seconds ~/ 86400);
  return difference.isNegative
      ? strings.pairingRecencyIn(age)
      : strings.pairingRecencyAgo(age);
}
