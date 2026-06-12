import { computed, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import {
  ChildDaySummary,
  ChildProfile,
  QuestBoardItem,
  QuestCategory,
  QuestDifficulty,
  QuestRecurrence,
} from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-child-today-page',
  imports: [RouterLink],
  templateUrl: './child-today-page.html',
  styleUrl: './child-today-page.scss',
})
export class ChildTodayPage {
  private readonly route = inject(ActivatedRoute);
  private readonly familyData = inject(MockFamilyData);
  private readonly childId = toSignal(this.route.paramMap.pipe(map((params) => params.get('childId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('childId') ?? '',
  });
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingQuestId = signal('');
  readonly modeSyncError = this.familyData.householdSettingsSyncError;

  readonly vm = computed(() => {
    const childId = this.childId();
    const child = this.familyData.childById(childId);
    const summary = this.familyData.getChildSummary(childId);

    if (!child || !summary) {
      return null;
    }

    const board = this.familyData.getQuestBoard(childId);
    const goals = this.familyData.getGoalsForChild(childId);
    const todayJournalEntry = this.familyData.getTodaysJournalEntry(childId);
    const requiredQuests = board.filter((item) => item.countsTowardRequired);
    const bonusQuests = board.filter((item) => !item.countsTowardRequired);
    const activeMode = this.familyData.activeMode();
    const progress = summary.totalRequired === 0 ? 0 : Math.round((summary.completedRequired / summary.totalRequired) * 100);
    const allRequiredDone = summary.totalRequired > 0 && summary.completedRequired === summary.totalRequired;
    const activeScreenTimeRule = this.familyData
      .privilegeRules()
      .find((rule) => rule.type === 'screenTime' && rule.activeModes.includes(activeMode.id));
    const viewer = this.familyData.viewerSession();

    return {
      child,
      summary,
      requiredQuests,
      bonusQuests,
      activeMode,
      progress,
      allRequiredDone,
      activeScreenTimeRule,
      activeGoalsCount: goals.length,
      goalFocusLabel: goals.find((item) => !item.complete)?.goal.title ?? goals[0]?.goal.title ?? 'No active goals yet',
      completedGoalsCount: goals.filter((item) => item.complete).length,
      todayJournalEntry,
      bonusSectionTitle: bonusQuests.some((item) => item.quest.category !== 'bonus') ? 'Bonus and extra quests' : 'Bonus quests',
      bonusSectionCopy: bonusQuests.some((item) => item.quest.category !== 'bonus')
        ? 'Optional wins, stretch tracks, and live quests that do not count as today\'s must-do board in this mode.'
        : 'Optional wins for extra growth, extra points, and a little end-of-day pride.',
      statusLabel: buildStatusLabel(summary),
      heroMessage: buildHeroMessage(child, summary, allRequiredDone),
      headlineStats: buildHeadlineStats(child, summary),
      backLink: viewer.kind === 'parent' ? '/' : '/family-access',
      backLabel: viewer.kind === 'parent' ? 'Back to family dashboard' : 'Switch family member',
    };
  });

  async completeQuest(item: QuestBoardItem) {
    const childId = this.childId();

    if (!childId) {
      return;
    }

    this.actionFeedback.set(null);
    this.pendingQuestId.set(item.quest.id);
    const result = await this.familyData.completeQuest(item.quest.id, childId);
    this.pendingQuestId.set('');

    if (!result.ok) {
      this.actionFeedback.set({
        kind: 'error',
        text: result.message ?? 'This quest could not be updated right now. Try again in a moment.',
      });
      return;
    }

    this.actionFeedback.set({
      kind: 'success',
      text: item.quest.requiresApproval
        ? `${item.quest.title} is waiting for a parent check now.`
        : `${item.quest.title} is banked and your points are already on the board.`,
    });
  }

  categoryLabel(category: QuestCategory) {
    return CATEGORY_LABELS[category];
  }

  difficultyLabel(difficulty: QuestDifficulty) {
    return DIFFICULTY_LABELS[difficulty];
  }

  recurrenceLabel(recurrence: QuestRecurrence) {
    return RECURRENCE_LABELS[recurrence];
  }

  statusLabel(item: QuestBoardItem) {
    return QUEST_STATUS_LABELS[item.status];
  }
}

function buildStatusLabel(summary: ChildDaySummary) {
  if (summary.screenTimeUnlocked) {
    return 'Screen Time Unlocked';
  }

  if (summary.pendingApprovals > 0 && summary.remainingForScreenTime === 0) {
    return 'Waiting for Parent Check';
  }

  if (summary.pendingApprovals > 0) {
    return 'Progress Waiting on Approval';
  }

  return 'Quest Board in Progress';
}

function buildHeroMessage(child: ChildProfile, summary: ChildDaySummary, allRequiredDone: boolean) {
  if (allRequiredDone) {
    return `${child.name}, every required quest is current. Nice work keeping the board green.`;
  }

  if (summary.pendingApprovals > 0) {
    const noun = summary.pendingApprovals === 1 ? 'quest report is' : 'quest reports are';
    return `${summary.pendingApprovals} ${noun} waiting for a parent check. Momentum still counts while you wait.`;
  }

  return summary.momentumLabel;
}

function buildHeadlineStats(child: ChildProfile, summary: ChildDaySummary) {
  return [
    {
      label: 'Points Today',
      value: summary.pointsToday.toString(),
      hint: 'Progress earned from approved and auto-approved quests',
    },
    {
      label: 'Current Level',
      value: child.level.toString(),
      hint: 'Confidence grows with steady follow-through',
    },
    {
      label: 'Streak',
      value: `${child.streakDays} days`,
      hint: 'Consistency beats perfection around here',
    },
    {
      label: 'Bonus Wins',
      value: summary.bonusCompleted.toString(),
      hint: 'Extra sparkle for going beyond the must-do board',
    },
  ];
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

const DIFFICULTY_LABELS: Record<QuestDifficulty, string> = {
  easy: 'Easy quest',
  normal: 'Steady quest',
  hard: 'Challenge quest',
  boss: 'Boss quest',
};

const RECURRENCE_LABELS: Record<QuestRecurrence, string> = {
  once: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  custom: 'Custom rhythm',
};

const QUEST_STATUS_LABELS = {
  open: 'Ready to start',
  pending: 'Waiting for parent',
  approved: 'Approved',
  rejected: 'Needs one more pass',
} as const;
