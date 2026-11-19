import 'package:flutter/services.dart';

Future<List<int>> nativeSearchMatches(List<String> titles, String query) async {
  if (query.isEmpty) return List.generate(titles.length, (index) => index);
  return (await const MethodChannel(
    'djl.mobile/app-info',
  ).invokeListMethod<int>('searchMatches', {
    'titles': titles,
    'query': query,
  }))!;
}
