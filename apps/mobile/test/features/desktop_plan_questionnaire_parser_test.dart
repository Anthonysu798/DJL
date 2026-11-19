import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/plans/domain/desktop_plan_questionnaire.dart';

void main() {
  test(
    'source Markdown numbered questions retain intro, options and outro',
    () {
      final q = DesktopPlanQuestionnaire.parse(
        '''A few quick questions before I finalize the plan:

**1. Which rollout path should we take?**
- Ship it now
- Stage it behind a flag

Once you answer, I will finalize the plan.''',
      );
      expect(q?.intro, 'A few quick questions before I finalize the plan:');
      expect(q?.questions.single['id'], 'inferred_plan_q_1');
      expect(
        q?.questions.single['question'],
        'Which rollout path should we take?',
      );
      expect(
        (q?.questions.single['options'] as List?)?.map((o) => o['label']),
        ['Ship it now', 'Stage it behind a flag'],
      );
      expect(q?.outro, 'Once you answer, I will finalize the plan.');
    },
  );

  test('source questions without preamble require clear structure', () {
    final q = DesktopPlanQuestionnaire.parse(
      '''1. Which rollout path should we take?
- Ship it now
- Stage it behind a flag

2. Which validation level do you want?
- Smoke test only
- Add focused regression coverage''',
    );
    expect(q?.questions, hasLength(2));
    expect(q?.intro, isNull);
    expect(q?.outro, isNull);
  });

  test('source next-step choice list does not swallow preceding roadmap', () {
    final q = DesktopPlanQuestionnaire.parse('''Suggested Roadmap

1. Polish onboarding
2. Improve status clarity

If you want, next I can turn this into one of these:

1. a concrete 2-week roadmap
2. a feature-priority matrix
3. a "v1 vs v2" product strategy doc''');
    expect(
      q?.intro,
      'Suggested Roadmap\n\n1. Polish onboarding\n2. Improve status clarity',
    );
    expect(q?.questions.single['header'], 'Next step');
    expect(q?.questions.single['question'], 'What should Codex produce next?');
    expect((q?.questions.single['options'] as List?)?.map((o) => o['label']), [
      'a concrete 2-week roadmap',
      'a feature-priority matrix',
      'a "v1 vs v2" product strategy doc',
    ]);
  });

  test('choice list retains each option continuation as a description', () {
    final q = DesktopPlanQuestionnaire.parse('''Choose one:
1. First option
More detail
2. Second option
Its detail''');
    expect(
      (q?.questions.single['options'] as List?)?.map((o) => o['description']),
      ['More detail', 'Its detail'],
    );
  });

  for (final count in [2, 3]) {
    test('inline choices and source selection limit $count survive parsing', () {
      final q = DesktopPlanQuestionnaire.parse(
        'Question for you:\n1. Pick ${count == 2 ? 'two' : 'three'}: Mac, iOS, or Android?',
      );
      expect(q?.questions.single['selectionLimit'], count);
      expect(
        q?.questions.single['question'],
        'Pick ${count == 2 ? 'two' : 'three'}?',
      );
      expect(
        (q?.questions.single['options'] as List?)?.map((o) => o['label']),
        ['Mac', 'iOS', 'Android'],
      );
    });
  }

  test(
    'trailing incomplete question is dropped but an internal one rejects parsing',
    () {
      expect(
        DesktopPlanQuestionnaire.parse(
          '1. Which path?\n- A\n- B\n2. Still preparing',
        )?.questions,
        hasLength(1),
      );
      expect(
        DesktopPlanQuestionnaire.parse(
          '1. Incomplete\n2. Which path?\n- A\n- B',
        ),
        isNull,
      );
    },
  );

  for (final text in [
    'Plain prose?',
    '1. A roadmap step\n2. Another step',
    'Question for you:\n1. One free-text question?',
    'Choose one:\n1. Only one option',
    '',
  ]) {
    test('unstructured or incomplete source text stays prose: $text', () {
      expect(DesktopPlanQuestionnaire.parse(text), isNull);
    });
  }

  test(
    'a native plan item can parse two free-text questions without assistant cues',
    () {
      final q = DesktopPlanQuestionnaire.parse(
        '1. Who owns this?\n2. When is it needed?',
        assistant: false,
      );
      expect(q?.questions, hasLength(2));
      expect(q?.questions.every((q) => (q['options'] as List).isEmpty), isTrue);
    },
  );

  test(
    'legacy proposed-plan heuristic matches source first-line and step requirements',
    () {
      const body =
          '# Implementation approach\n1. Inspect the source\n2. Verify the change';
      expect(desktopLegacyProposedPlan('  $body  '), body);
      expect(desktopLegacyProposedPlan('Notes\n1. Inspect\n2. Verify'), isNull);
      expect(desktopLegacyProposedPlan('Plan\n1. Inspect'), isNull);
      expect(
        desktopLegacyProposedPlan(
          '<proposed_plan>Plan\n1. Inspect\n2. Verify</proposed_plan>',
        ),
        isNull,
      );
    },
  );
}
