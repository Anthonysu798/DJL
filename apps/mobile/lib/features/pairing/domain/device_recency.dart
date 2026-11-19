String deviceRecencyLabel(DateTime date, DateTime now) {
  final difference = now.difference(date);
  final seconds = difference.inSeconds.abs();
  if (seconds < 60) return 'now';
  final age = seconds < 3600
      ? '${seconds ~/ 60}m'
      : seconds < 86400
      ? '${seconds ~/ 3600}h'
      : '${seconds ~/ 86400}d';
  return difference.isNegative ? 'in $age' : '$age ago';
}
