import { computed, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { Goal, QuestCategory } from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-goals-page',
  imports: [RouterLink],
  templateUrl: './goals-page.html',
  styleUrl: './goals-page.scss',
})
export class GoalsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly familyData = inject(MockFamilyData);
  private readonly childId = toSignal(this.route.paramMap.pipe(map((params) => params.get('childId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('childId') ?? '',
  });
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingGoalId = signal('');

  readonly vm = computed(() => {
    const childId = this.childId();
    const child = this.familyData.childById(childId);

    if (!child) {
      return null;
    }

    const activeMode = this.familyData.activeMode();
    const goals = this.familyData.getGoalsForChild(childId);
    const latestJournalEntry = this.familyData.getJournalEntriesForChild(childId)[0] ?? null;
    const completedCount = goals.filter((item) => item.complete).length;
    const nearFinishCount = goals.filter((item) => !item.complete && item.progress >= 75).length;
    const focusGoal = goals.find((item) => !item.complete) ?? goals[0] ?? null;

    return {
      child,
      activeMode,
      goals,
      latestJournalEntry,
      completedCount,
      focusGoal,
      heroMessage: buildGoalsHeroMessage(child.name, goals.length, completedCount, focusGoal?.goal.title),
      headlineStats: [
        {
          label: 'Active Goals',
          value: goals.length.toString(),
          hint: 'Long-game growth targets live in this mode',
        },
        {
          label: 'Completed',
          value: completedCount.toString(),
          hint: 'Goals already finished or fully banked',
        },
        {
          label: 'Near Finish',
          value: nearFinishCount.toString(),
          hint: 'Goals at 75% or better right now',
        },
        {
          label: 'Journal Link',
          value: latestJournalEntry ? 'Ready' : 'Start',
          hint: latestJournalEntry ? 'Latest reflection is ready to revisit' : 'A journal win can support these goals',
        },
      ],
    };
  });

  constructor() {
    void this.familyData.ensureJournalEntriesLoaded();
  }

  categoryLabel(category: QuestCategory) {
    return CATEGORY_LABELS[category];
  }

  goalStep(goal: Goal) {
    return goal.unit === 'serves' ? 10 : 1;
  }

  goalStepLabel(goal: Goal) {
    const amount = this.goalStep(goal);
    return `Log +${amount} ${formatUnit(goal.unit, amount)}`;
  }

  goalStatusLabel(progress: number, complete: boolean) {
    if (complete) {
      return 'Goal reached';
    }

    if (progress >= 75) {
      return 'Almost there';
    }

    if (progress >= 40) {
      return 'Building momentum';
    }

    return 'Questing toward it';
  }

  remainingLabel(remaining: number, unit: string) {
    if (remaining === 0) {
      return 'Finished strong.';
    }

    return `${remaining} ${formatUnit(unit, remaining)} left to go.`;
  }

  async logGoalProgress(goalId: string, goal: Goal) {
    const amount = this.goalStep(goal);
    this.actionFeedback.set(null);
    this.pendingGoalId.set(goalId);
    const result = await this.familyData.logGoalProgress(goalId, amount);
    this.pendingGoalId.set('');

    if (!result.ok) {
      this.actionFeedback.set({
        kind: 'error',
        text: result.message ?? 'That goal progress could not be saved right now. Try again in a moment.',
      });
      return;
    }

    this.actionFeedback.set({
      kind: 'success',
      text: `Logged +${amount} ${formatUnit(goal.unit, amount)} toward ${goal.title}.`,
    });
  }
}

function buildGoalsHeroMessage(childName: string, goalCount: number, completedCount: number, focusGoal?: string) {
  if (goalCount === 0) {
    return `${childName} does not have any live goals in this mode yet.`;
  }

  if (completedCount === goalCount) {
    return `Every active goal is already banked for ${childName}. This is a great moment to set the next stretch target.`;
  }

  if (focusGoal) {
    return `${childName} has ${goalCount} active goal${goalCount === 1 ? '' : 's'} in motion. Current focus: ${focusGoal}.`;
  }

  return `${childName}'s goal board is ready for the next push.`;
}

function formatUnit(unit: string, amount: number) {
  if (amount === 1 && unit.endsWith('s')) {
    return unit.slice(0, -1);
  }

  return unit;
}

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
