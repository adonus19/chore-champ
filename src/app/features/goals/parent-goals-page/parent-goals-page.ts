import { computed, Component, inject, signal } from '@angular/core';
import { FormField, form, min, minLength, required, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import { ChildProfile, Goal, GoalDraft, QuestCategory, SeasonalMode } from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';
import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';

@Component({
  selector: 'app-parent-goals-page',
  imports: [FormField, RouterLink],
  templateUrl: './parent-goals-page.html',
  styleUrl: './parent-goals-page.scss',
})
export class ParentGoalsPage {
  private readonly familyData = inject(MockFamilyData);

  readonly GOAL_CATEGORY_OPTIONS = GOAL_CATEGORY_OPTIONS;
  readonly CATEGORY_LABELS = CATEGORY_LABELS;
  readonly children = this.familyData.children;
  readonly seasonalModes = this.familyData.seasonalModes;
  readonly activeMode = this.familyData.activeMode;
  // Children plus, for a real signed-in parent, a "Myself" target so personal goals can be authored here too.
  readonly goalTargets = computed(() => {
    const targets = this.children().map((child) => ({ id: child.id, name: child.name }));
    const personId = this.familyData.currentParentPersonId();

    if (personId) {
      targets.push({ id: personId, name: `Myself (${this.familyData.currentParentDisplayName()})` });
    }

    return targets;
  });
  readonly editingGoalId = signal('');
  readonly lastSavedGoal = signal<{
    action: 'created' | 'updated' | 'deleted';
    audience: 'child' | 'self';
    source: 'firebase' | 'local';
    title: string;
  } | null>(null);
  readonly actionError = signal('');
  readonly goalModel = signal(this.createGoalFormModel());
  readonly goalForm = form(this.goalModel, (path) => {
    required(path.childId, { message: 'Choose which child this goal belongs to.' });

    required(path.title, { message: 'Give this goal a short title.' });
    minLength(path.title, 3, { message: 'Use at least 3 characters so the goal reads clearly.' });

    required(path.unit, { message: 'Add the measurement for this goal.' });
    minLength(path.unit, 2, { message: 'Use a short unit like books, serves, miles, or wins.' });

    min(path.current, 0, { message: 'Current progress cannot be negative.' });
    min(path.target, 1, { message: 'Choose a target greater than zero.' });

    validate(path.current, ({ value }) =>
      Number.isFinite(value()) ? undefined : { kind: 'number', message: 'Use a real number for current progress.' },
    );

    validate(path.target, ({ value }) =>
      Number.isFinite(value()) ? undefined : { kind: 'number', message: 'Use a real number for the target.' },
    );

    validate(path.target, ({ value }) =>
      Number.isInteger(value()) ? undefined : { kind: 'wholeNumber', message: 'Use a whole number for the target.' },
    );

    validate(path.current, ({ value }) =>
      value() <= this.goalModel().target
        ? undefined
        : { kind: 'range', message: 'Current progress should not be higher than the target.' },
    );

    validate(path.activeModes, ({ value }) =>
      value().some(Boolean) ? undefined : { kind: 'required', message: 'Choose at least one seasonal mode.' },
    );
  });
  readonly editingGoal = computed(() => this.familyData.goalById(this.editingGoalId()) ?? null);
  readonly selectedCategory = computed(
    () => this.GOAL_CATEGORY_OPTIONS.find((option) => option.value === this.goalModel().category) ?? GOAL_CATEGORY_OPTIONS[0],
  );
  readonly quickStats = computed(() => {
    const goals = this.familyData.goals();
    const activeModeId = this.activeMode().id;
    const completedCount = goals.filter((goal) => goal.current >= goal.target).length;
    const goalOwners = new Set(goals.map((goal) => goal.childId)).size;

    return [
      {
        label: 'Goal Library',
        value: goals.length.toString(),
        hint: 'Live goals across child boards and parent self-boards',
      },
      {
        label: 'People with Goals',
        value: goalOwners.toString(),
        hint: 'Children and parent self-boards that already have stretch targets',
      },
      {
        label: 'Live This Mode',
        value: goals.filter((goal) => goal.activeModes.includes(activeModeId)).length.toString(),
        hint: `Goals currently visible in ${this.activeMode().name}`,
      },
      {
        label: 'Completed',
        value: completedCount.toString(),
        hint: 'Goals that are already fully banked',
      },
    ];
  });
  readonly goalGroups = computed(() => {
    return this.children().map((child) => {
      const items = this.buildGoalPreviewItems(child.id);

      return {
        child,
        items,
        completedCount: items.filter((item) => item.complete).length,
        currentModeCount: items.filter((item) => item.liveInCurrentMode).length,
      };
    });
  });

  onSubmit(submitEvent?: Event) {
    submitWithValidationFocus(this.goalForm, submitEvent, async () => {
      const draft = this.buildGoalDraft();
      const editingGoalId = this.editingGoalId();
      this.actionError.set('');
      this.lastSavedGoal.set(null);

      if (editingGoalId) {
        const result = await this.familyData.updateGoal(editingGoalId, draft);

        if (!result.ok) {
          this.actionError.set(result.message ?? 'The goal could not be saved right now.');
          return;
        }

        this.lastSavedGoal.set({
          action: 'updated',
          audience: this.goalAudienceForTarget(draft.childId),
          source: result.source ?? 'firebase',
          title: draft.title,
        });
      } else {
        const result = await this.familyData.addGoal(draft);

        if (!result.ok) {
          this.actionError.set(result.message ?? 'The goal could not be saved right now.');
          return;
        }

        this.lastSavedGoal.set({
          action: 'created',
          audience: this.goalAudienceForTarget(draft.childId),
          source: result.source ?? 'firebase',
          title: draft.title,
        });
      }

      this.cancelEdit();
    });
  }

  startEdit(goalId: string) {
    const goal = this.familyData.goalById(goalId);

    if (!goal) {
      return;
    }

    this.editingGoalId.set(goalId);
    this.lastSavedGoal.set(null);
    this.actionError.set('');
    this.goalModel.set(this.createGoalFormModel(goal));
  }

  cancelEdit() {
    this.editingGoalId.set('');
    this.actionError.set('');
    this.goalModel.set(this.createGoalFormModel());
  }

  async deleteEditingGoal() {
    const goal = this.editingGoal();

    if (!goal) {
      return;
    }

    this.actionError.set('');
    this.lastSavedGoal.set(null);
    const result = await this.familyData.deleteGoal(goal.id);

    if (!result.ok) {
      this.actionError.set(result.message ?? 'The goal could not be deleted right now.');
      return;
    }

    this.lastSavedGoal.set({
      action: 'deleted',
      audience: this.goalAudienceForTarget(goal.childId),
      source: result.source ?? 'firebase',
      title: goal.title,
    });
    this.cancelEdit();
  }

  applySuggestedUnit(unit: string) {
    this.goalModel.update((model) => ({
      ...model,
      unit,
    }));
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  childTrackBy(index: number, child: ChildProfile) {
    return `${index}-${child.id}`;
  }

  modeTrackBy(index: number, mode: SeasonalMode) {
    return `${index}-${mode.id}`;
  }

  remainingLabel(goal: Goal) {
    const remaining = Math.max(goal.target - goal.current, 0);

    if (remaining === 0) {
      return 'Already complete.';
    }

    return `${remaining} ${formatUnit(goal.unit, remaining)} left.`;
  }

  showParentSelfBoard() {
    return this.familyData.usesParentSelfBoard();
  }

  personalGoalGroup() {
    const personId = this.familyData.currentParentPersonId();

    if (!personId) {
      return null;
    }

    const items = this.buildGoalPreviewItems(personId);

    return {
      completedCount: items.filter((item) => item.complete).length,
      currentModeCount: items.filter((item) => item.liveInCurrentMode).length,
      items,
      name: this.familyData.currentParentDisplayName(),
    };
  }

  private buildGoalPreviewItems(targetId: string) {
    const activeMode = this.activeMode();
    const modeNames = new Map(this.seasonalModes().map((mode) => [mode.id, mode.name]));

    return this.familyData
      .goals()
      .filter((goal) => goal.childId === targetId)
      .map((goal) => {
        const progress = goal.target === 0 ? 0 : Math.min(100, Math.round((goal.current / goal.target) * 100));
        const remaining = Math.max(goal.target - goal.current, 0);
        const complete = remaining === 0;

        return {
          goal,
          progress,
          remaining,
          complete,
          liveInCurrentMode: goal.activeModes.includes(activeMode.id),
          modeNames: goal.activeModes.map((modeId) => modeNames.get(modeId) ?? modeId),
        };
      })
      .sort((left, right) => {
        if (left.complete !== right.complete) {
          return Number(left.complete) - Number(right.complete);
        }

        if (left.liveInCurrentMode !== right.liveInCurrentMode) {
          return Number(right.liveInCurrentMode) - Number(left.liveInCurrentMode);
        }

        return left.goal.title.localeCompare(right.goal.title);
      });
  }

  private goalAudienceForTarget(targetId: string) {
    return targetId === this.familyData.currentParentPersonId() ? ('self' as const) : ('child' as const);
  }

  private buildGoalDraft(): GoalDraft {
    const value = this.goalForm().value();
    const activeModes = this.seasonalModes()
      .filter((_, index) => value.activeModes[index])
      .map((mode) => mode.id);

    return {
      childId: value.childId,
      title: value.title.trim(),
      target: Math.round(value.target),
      current: Math.round(value.current),
      unit: value.unit.trim(),
      category: value.category,
      activeModes,
    };
  }

  private createGoalFormModel(goal?: Goal) {
    const parentPersonId = this.familyData.currentParentPersonId();

    return {
      childId: goal?.childId ?? this.children()[0]?.id ?? parentPersonId ?? '',
      title: goal?.title ?? '',
      target: goal?.target ?? 10,
      current: goal?.current ?? 0,
      unit: goal?.unit ?? '',
      category: goal?.category ?? ('mind' as QuestCategory),
      activeModes: this.seasonalModes().map((mode) =>
        goal ? goal.activeModes.includes(mode.id) : mode.id === this.familyData.activeModeId(),
      ),
    };
  }
}

function formatUnit(unit: string, amount: number) {
  if (amount === 1 && unit.endsWith('s')) {
    return unit.slice(0, -1);
  }

  return unit;
}

const GOAL_CATEGORY_OPTIONS: Array<{
  value: QuestCategory;
  label: string;
  hint: string;
  suggestedUnits: string[];
}> = [
  {
    value: 'mind',
    label: 'Mind',
    hint: 'Great for reading, books, chapters, vocabulary, and academic practice.',
    suggestedUnits: ['books', 'chapters', 'sessions'],
  },
  {
    value: 'body',
    label: 'Body',
    hint: 'Use this for movement, sports practice, reps, miles, or minutes.',
    suggestedUnits: ['serves', 'miles', 'minutes'],
  },
  {
    value: 'leadership',
    label: 'Leadership',
    hint: 'Track helpfulness, initiative, and leading well over time.',
    suggestedUnits: ['wins', 'assists', 'challenges'],
  },
  {
    value: 'lifeSkill',
    label: 'Life Skill',
    hint: 'Perfect for independence goals like laundry, meals, packing, or budgeting.',
    suggestedUnits: ['skills', 'full runs', 'check-offs'],
  },
  {
    value: 'school',
    label: 'School',
    hint: 'Use this for homework habits, study blocks, or school follow-through.',
    suggestedUnits: ['assignments', 'blocks', 'sessions'],
  },
  {
    value: 'home',
    label: 'Home',
    hint: 'Helpful for room resets, routines, and steady responsibility habits.',
    suggestedUnits: ['days', 'resets', 'wins'],
  },
  {
    value: 'family',
    label: 'Family',
    hint: 'Use this for shared family contribution or teamwork challenges.',
    suggestedUnits: ['acts', 'team wins', 'helps'],
  },
  {
    value: 'bonus',
    label: 'Bonus',
    hint: 'Extra growth targets can live here without feeling heavy or required.',
    suggestedUnits: ['sparks', 'wins', 'quests'],
  },
];

const CATEGORY_LABELS: Record<QuestCategory, string> = {
  home: 'Home',
  mind: 'Mind',
  body: 'Body',
  leadership: 'Leadership',
  lifeSkill: 'Life Skill',
  bonus: 'Bonus',
  school: 'School',
  family: 'Family',
};
