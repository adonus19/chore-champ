import { computed, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import {
  ChildProfile,
  Reward,
  RewardRequestItem,
  RewardType,
} from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-rewards-page',
  imports: [RouterLink],
  templateUrl: './rewards-page.html',
  styleUrl: './rewards-page.scss',
})
export class RewardsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly familyData = inject(MockFamilyData);
  private readonly childId = toSignal(this.route.paramMap.pipe(map((params) => params.get('childId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('childId') ?? '',
  });
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingRewardId = signal('');

  readonly vm = computed(() => {
    const childId = this.childId();
    const child = this.familyData.childById(childId);

    if (!child) {
      return null;
    }

    const rewards = this.familyData.getRewardsForChild(childId);
    const activity = this.familyData.getRewardActivityForChild(childId);
    const activeMode = this.familyData.activeMode();
    const privilegeRules = this.familyData
      .privilegeRules()
      .filter((rule) => rule.type !== 'screenTime' && rule.activeModes.includes(activeMode.id));
    const pendingCount = activity.filter((item) => item.redemption.status === 'pending').length;
    const availableRewards = rewards.filter((item) => item.canRedeem).length;

    return {
      child,
      rewards,
      activity,
      activeMode,
      privilegeRules,
      pendingCount,
      availableRewards,
      heroMessage: buildHeroMessage(child, pendingCount, availableRewards),
      headlineStats: buildHeadlineStats(child, rewards.length, pendingCount, availableRewards),
    };
  });

  async redeemReward(reward: Reward) {
    const childId = this.childId();

    if (!childId) {
      return;
    }

    this.actionFeedback.set(null);
    this.pendingRewardId.set(reward.id);
    const result = await this.familyData.redeemReward(reward.id, childId);
    this.pendingRewardId.set('');

    if (!result.ok) {
      this.actionFeedback.set({
        kind: 'error',
        text: result.message ?? 'This reward could not be updated right now. Try again in a moment.',
      });
      return;
    }

    this.actionFeedback.set({
      kind: 'success',
      text: reward.requiresParentApproval
        ? `${reward.title} is now waiting for a parent review.`
        : `${reward.title} is redeemed and your points bank is updated.`,
    });
  }

  rewardTypeLabel(type: RewardType) {
    return REWARD_TYPE_LABELS[type];
  }

  rewardStatusLabel(item: RewardRequestItem) {
    if (item.redemption.status === 'pending') {
      return 'Waiting for parent';
    }

    if (item.redemption.status === 'declined') {
      return 'Declined and refunded';
    }

    return 'Redeemed';
  }

  rewardDescription(reward: Reward) {
    return REWARD_DETAILS[reward.id]?.description ?? REWARD_TYPE_DESCRIPTIONS[reward.type];
  }

  rewardHighlight(reward: Reward) {
    return REWARD_DETAILS[reward.id]?.highlight ?? 'A steady-points reward option.';
  }
}

function buildHeroMessage(child: ChildProfile, pendingCount: number, availableRewards: number) {
  if (pendingCount > 0) {
    const noun = pendingCount === 1 ? 'reward request is' : 'reward requests are';
    return `${pendingCount} ${noun} waiting for a parent review. ${child.name}'s points are still working toward the next goal.`;
  }

  if (availableRewards > 0) {
    return `${child.name} has enough points to unlock ${availableRewards} reward${availableRewards === 1 ? '' : 's'} right now.`;
  }

  return 'Keep stacking consistent wins. Rewards open up as points grow, while privileges still follow family expectations.';
}

function buildHeadlineStats(
  child: ChildProfile,
  rewardCount: number,
  pendingCount: number,
  availableRewards: number,
) {
  return [
    {
      label: 'Points Banked',
      value: child.points.toString(),
      hint: 'Current point balance ready for rewards',
    },
    {
      label: 'Ready Now',
      value: availableRewards.toString(),
      hint: 'Rewards this child can claim or request today',
    },
    {
      label: 'Waiting Review',
      value: pendingCount.toString(),
      hint: 'Requested rewards still waiting on a parent',
    },
      {
        label: 'Reward Options',
        value: rewardCount.toString(),
        hint: 'Active reward choices in the family store',
      },
  ];
}

const REWARD_TYPE_LABELS: Record<RewardType, string> = {
  money: 'Money',
  outing: 'Outing',
  choice: 'Choice',
  custom: 'Custom',
};

const REWARD_TYPE_DESCRIPTIONS: Record<RewardType, string> = {
  money: 'Turn points into a concrete reward after a strong stretch of consistency.',
  outing: 'Choose an experience that feels special without turning privileges into purchases.',
  choice: 'Use points to guide a fun family choice or celebration moment.',
  custom: 'A custom family reward with room for flexibility.',
};

const REWARD_DETAILS: Record<string, { description: string; highlight: string }> = {
  'reward-dessert': {
    description: 'Pick the family dessert for one night and help choose the sweet win.',
    highlight: 'A small, joyful reward that still feels earned.',
  },
  'reward-movie': {
    description: 'Choose the next family movie night and call the feature presentation.',
    highlight: 'A low-friction reward that can redeem right away.',
  },
  'reward-five': {
    description: 'Cash out points for five dollars after a run of strong follow-through.',
    highlight: 'A bigger-ticket option with parent review built in.',
  },
  'reward-outing': {
    description: 'Save up for a mini shopping trip or another parent-approved outing.',
    highlight: 'A longer-range goal for steady effort over time.',
  },
  'reward-one-on-one': {
    description: 'Trade points for focused one-on-one parent time built around the child.',
    highlight: 'Connection-forward rewards often age really well.',
  },
};
