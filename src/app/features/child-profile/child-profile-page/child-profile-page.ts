import { computed, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { ChildProfile, GoalSpotlight, RewardRequestItem } from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-child-profile-page',
  imports: [RouterLink],
  templateUrl: './child-profile-page.html',
  styleUrl: './child-profile-page.scss',
})
export class ChildProfilePage {
  private readonly route = inject(ActivatedRoute);
  private readonly familyData = inject(MockFamilyData);
  private readonly childId = toSignal(this.route.paramMap.pipe(map((params) => params.get('childId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('childId') ?? '',
  });

  readonly vm = computed(() => {
    const childId = this.childId();
    const child = this.familyData.childById(childId);

    if (!child) {
      return null;
    }

    const activeMode = this.familyData.modeById(child.activeModeId) ?? this.familyData.activeMode();
    const summary = this.familyData.getChildSummary(childId, child.activeModeId);
    const goals = this.familyData.getGoalsForChild(childId, child.activeModeId);
    const journalEntries = this.familyData.getJournalEntriesForChild(childId);
    const rewardActivity = this.familyData.getRewardActivityForChild(childId);
    const latestJournalEntry = journalEntries[0] ?? null;
    const latestRewardActivity = rewardActivity[0] ?? null;
    const completedGoalsCount = goals.filter((item) => item.complete).length;
    const badges = buildBadges(child, {
      summary,
      goals,
      journalEntries,
      rewardActivity,
    });

    return {
      child,
      activeMode,
      summary,
      goals,
      completedGoalsCount,
      latestJournalEntry,
      latestRewardActivity,
      badges,
      heroMessage: buildHeroMessage(child, summary?.remainingForScreenTime ?? 0, goals),
      headlineStats: [
        {
          label: 'Point Bank',
          value: child.points.toString(),
          hint: 'Saved up for rewards, growth, and bigger family wins',
        },
        {
          label: 'Streak',
          value: `${child.streakDays} days`,
          hint: 'Consistency counts more than perfection',
        },
        {
          label: 'Live Goals',
          value: goals.length.toString(),
          hint: `${completedGoalsCount} already complete in this profile`,
        },
        {
          label: 'Journal Wins',
          value: journalEntries.length.toString(),
          hint: 'Saved reflections that help growth feel visible',
        },
      ],
      spotlightCards: [
        {
          label: 'Current book',
          value: child.currentBook || 'Pick the next reading quest',
        },
        {
          label: 'Life skill',
          value: child.currentLifeSkill || 'Choose the next skill to grow',
        },
        {
          label: 'Sports goal',
          value: child.sportsGoal || 'Set a sports goal',
        },
        {
          label: 'Year goal',
          value: child.yearGoal || 'Name the next big stretch target',
        },
      ],
    };
  });

  rewardStatusLabel(item: RewardRequestItem) {
    switch (item.redemption.status) {
      case 'fulfilled':
        return 'Reward fulfilled';
      case 'declined':
        return 'Points refunded';
      default:
        return 'Waiting for parent';
    }
  }
}

function buildHeroMessage(
  child: ChildProfile,
  remainingForScreenTime: number,
  goals: Array<GoalSpotlight & { complete: boolean }>,
) {
  const focusGoal = goals.find((item) => !item.complete)?.goal.title;

  if (remainingForScreenTime === 0 && focusGoal) {
    return `${child.name} is current on the daily board and can now pour energy into bigger goals like ${focusGoal}.`;
  }

  if (focusGoal) {
    return `${child.name} is building a profile around steady growth. Current stretch target: ${focusGoal}.`;
  }

  return `${child.name}'s profile brings together progress, habits, and the bigger picture beyond today's quests.`;
}

function buildBadges(
  child: ChildProfile,
  data: {
    summary: ReturnType<MockFamilyData['getChildSummary']>;
    goals: Array<GoalSpotlight & { complete: boolean }>;
    journalEntries: ReturnType<MockFamilyData['getJournalEntriesForChild']>;
    rewardActivity: RewardRequestItem[];
  },
) {
  const badges: Array<{ title: string; tone: 'mint' | 'gold' | 'violet' | 'sky'; copy: string }> = [];

  if (child.streakDays >= 7) {
    badges.push({
      title: 'Streak Spark',
      tone: 'gold',
      copy: `${child.streakDays} days of steady follow-through.`,
    });
  }

  if (data.goals.some((goal) => goal.complete)) {
    badges.push({
      title: 'Goal Getter',
      tone: 'mint',
      copy: 'A long-game target has already been finished.',
    });
  }

  if (data.journalEntries.length > 0) {
    badges.push({
      title: 'Reflection Keeper',
      tone: 'violet',
      copy: 'Journal wins are being captured and remembered.',
    });
  }

  if (data.rewardActivity.some((item) => item.redemption.status === 'fulfilled')) {
    badges.push({
      title: 'Reward Earner',
      tone: 'sky',
      copy: 'Points have already turned into meaningful rewards.',
    });
  }

  if (data.summary?.screenTimeUnlocked) {
    badges.push({
      title: 'Responsibility Ready',
      tone: 'mint',
      copy: 'Required quests are current before privileges open.',
    });
  }

  if (badges.length === 0) {
    badges.push({
      title: 'Questing Forward',
      tone: 'sky',
      copy: 'This profile is just getting warmed up.',
    });
  }

  return badges.slice(0, 4);
}
