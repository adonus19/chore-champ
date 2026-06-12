import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, min, minLength, required, submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import { GoalDraft, QuestCategory } from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-my-board-page',
  imports: [FormField, RouterLink],
  templateUrl: './my-board-page.html',
  styleUrl: './my-board-page.scss',
})
export class MyBoardPage {
  private readonly familyData = inject(MockFamilyData);

  readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  readonly usesParentSelfBoard = this.familyData.usesParentSelfBoard;
  readonly parentName = this.familyData.currentParentDisplayName;
  readonly goals = computed(() =>
    this.familyData.parentGoals().map((goal) => ({
      goal,
      progress: goal.target === 0 ? 0 : Math.min(100, Math.round((goal.current / goal.target) * 100)),
      remaining: Math.max(goal.target - goal.current, 0),
      complete: goal.current >= goal.target,
    })),
  );
  readonly quests = this.familyData.parentQuestBoard;
  readonly progressAmounts = signal<Record<string, number>>({});
  readonly pendingGoalId = signal('');
  readonly pendingQuestId = signal('');
  readonly actionError = signal('');
  readonly feedback = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  readonly goalModel = signal(this.createGoalFormModel());
  readonly goalForm = form(this.goalModel, (path) => {
    required(path.title, { message: 'Give this goal a short title.' });
    minLength(path.title, 3, { message: 'Use at least 3 characters so the goal reads clearly.' });

    required(path.unit, { message: 'Add the measurement for this goal.' });
    minLength(path.unit, 2, { message: 'Use a short unit like books, miles, sessions, or wins.' });

    min(path.target, 1, { message: 'Choose a target greater than zero.' });
  });
  readonly stats = computed(() => {
    const goals = this.familyData.parentGoals();
    const questBoard = this.quests();

    return [
      { label: 'My goals', value: goals.length.toString() },
      { label: 'Goals complete', value: goals.filter((goal) => goal.current >= goal.target).length.toString() },
      { label: 'My quests', value: questBoard.length.toString() },
      { label: 'Quests done', value: questBoard.filter((item) => item.done).length.toString() },
    ];
  });

  onAddGoal() {
    submit(this.goalForm, async () => {
      this.actionError.set('');
      this.feedback.set(null);
      const result = await this.familyData.addGoal(this.buildGoalDraft());

      if (!result.ok) {
        this.actionError.set(result.message ?? 'That goal could not be saved right now.');
        return;
      }

      this.feedback.set({ kind: 'success', text: `"${this.goalForm().value().title.trim()}" was added to your board.` });
      this.goalModel.set(this.createGoalFormModel());
    });
  }

  progressAmount(goalId: string) {
    return this.progressAmounts()[goalId] ?? 1;
  }

  setProgressAmount(goalId: string, value: string) {
    const amount = Math.max(1, Math.round(Number(value) || 1));
    this.progressAmounts.update((amounts) => ({ ...amounts, [goalId]: amount }));
  }

  async logProgress(goalId: string) {
    this.actionError.set('');
    this.feedback.set(null);
    this.pendingGoalId.set(goalId);
    const result = await this.familyData.logGoalProgress(goalId, this.progressAmount(goalId));
    this.pendingGoalId.set('');

    if (!result.ok) {
      this.actionError.set(result.message ?? 'That progress could not be logged right now.');
    }
  }

  async deleteGoal(goalId: string, title: string) {
    this.actionError.set('');
    this.feedback.set(null);
    this.pendingGoalId.set(goalId);
    const result = await this.familyData.deleteGoal(goalId);
    this.pendingGoalId.set('');

    if (!result.ok) {
      this.actionError.set(result.message ?? 'That goal could not be removed right now.');
      return;
    }

    this.feedback.set({ kind: 'success', text: `"${title}" was removed from your board.` });
  }

  async toggleQuest(questId: string, done: boolean) {
    this.actionError.set('');
    this.feedback.set(null);
    this.pendingQuestId.set(questId);
    const result = await this.familyData.setParentQuestDone(questId, done);
    this.pendingQuestId.set('');

    if (!result.ok) {
      this.actionError.set(result.message ?? 'That quest could not be updated right now.');
    }
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  private buildGoalDraft(): GoalDraft {
    const value = this.goalForm().value();

    return {
      childId: this.familyData.currentParentPersonId(),
      title: value.title.trim(),
      target: Math.round(value.target),
      current: 0,
      unit: value.unit.trim(),
      category: value.category,
      // Keep personal goals live in every seasonal mode so they never drop off the board on a mode switch.
      activeModes: this.familyData.seasonalModes().map((mode) => mode.id),
    };
  }

  private createGoalFormModel() {
    return {
      title: '',
      target: 10,
      unit: '',
      category: 'lifeSkill' as QuestCategory,
    };
  }
}

const CATEGORY_OPTIONS: Array<{ value: QuestCategory; label: string }> = [
  { value: 'mind', label: 'Mind' },
  { value: 'body', label: 'Body' },
  { value: 'leadership', label: 'Leadership' },
  { value: 'lifeSkill', label: 'Life Skill' },
  { value: 'home', label: 'Home' },
  { value: 'family', label: 'Family' },
  { value: 'bonus', label: 'Bonus' },
];
