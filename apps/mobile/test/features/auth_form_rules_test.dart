import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/auth/presentation/auth_form_rules.dart';

void main() {
  test('source code validation accepts exactly six ASCII digits', () {
    for (final value in ['123456', '000000']) {
      expect(AuthFormRules.validCode(value), isTrue);
    }
    for (final value in ['12345', '1234567', '１２３４５６', '12345a', ' 123456']) {
      expect(AuthFormRules.validCode(value), isFalse);
    }
  });
  test(
    'source password constraint counts UTF16 units from ten through 256 without trimming',
    () {
      expect(AuthFormRules.validPassword('a' * 9), isFalse);
      expect(AuthFormRules.validPassword('a' * 10), isTrue);
      expect(AuthFormRules.validPassword('a' * 256), isTrue);
      expect(AuthFormRules.validPassword('a' * 257), isFalse);
      expect(AuthFormRules.validPassword('😀' * 5), isTrue);
      expect(
        AuthFormRules.normalizedEmail(' ADA@Example.Test\n'),
        'ada@example.test',
      );
    },
  );
}
