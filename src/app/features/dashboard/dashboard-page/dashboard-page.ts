import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChildDaySummary, JournalReaction } from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly familyData = inject(MockFamilyData);
  readonly reviewFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingReviewId = signal('');
  readonly pendingRewardReviewId = signal('');
  readonly pendingJournalResponseId = signal('');
  readonly pendingModeId = signal('');

  readonly familyName = this.familyData.displayFamilyName;
  readonly familySnapshot = this.familyData.familySnapshot;
  readonly childSummaries = computed(() =>
    this.familyData.childSummaries().map((summary) => ({
      ...summary,
      progress: summary.totalRequired === 0 ? 0 : Math.round((summary.completedRequired / summary.totalRequired) * 100),
      statusLabel: summary.screenTimeUnlocked
        ? 'Screen Time Unlocked'
        : summary.pendingApprovals > 0
          ? 'Waiting for Parent Approval'
          : 'Questing in Progress',
    })),
  );
  readonly seasonalModes = this.familyData.seasonalModes;
  readonly pendingApprovals = this.familyData.pendingApprovals;
  readonly pendingRewardRequests = this.familyData.pendingRewardRequests;
  readonly pendingJournalResponses = this.familyData.pendingJournalResponses;
  readonly journalSyncError = this.familyData.journalSyncError;
  readonly privilegeRule = this.familyData.currentScreenTimeRule;
  readonly rewardRequestQueue = computed(() =>
    this.pendingRewardRequests().map((item) => ({
      ...item,
      requestedLabel: formatClockTime(item.redemption.requestedAt),
      rewardTypeLabel: formatRewardType(item.reward.type),
      impactLabel: `${item.redemption.pointCost} points are already reserved until you approve or refund this request.`,
    })),
  );
  readonly journalResponseQueue = computed(() =>
    this.pendingJournalResponses().map((item) => ({
      ...item,
      dateLabel: formatJournalDate(item.entry.date),
      accomplishedPreview: item.entry.accomplished,
      proudOfPreview: item.entry.proudOf,
    })),
  );
  readonly heroMessage = computed(() => {
    const snapshot = this.familySnapshot();
    const rewardRequestCount = this.pendingRewardRequests().length;
    const journalResponseCount = this.pendingJournalResponses().length;
    const approvalCount = snapshot.pendingApprovals;

    if (rewardRequestCount > 0) {
      return `${formatCount(rewardRequestCount, 'reward request')} ${rewardRequestCount === 1 ? 'is' : 'are'} ready for review first, with ${formatCount(approvalCount, 'quest check')} behind ${rewardRequestCount === 1 ? 'it' : 'them'}.`;
    }

    if (journalResponseCount > 0) {
      return `${formatCount(journalResponseCount, 'journal win')} ${journalResponseCount === 1 ? 'is' : 'are'} waiting for a warm parent response, with ${formatCount(approvalCount, 'quest check')} still in the parent lane too.`;
    }

    if (approvalCount > 0) {
      return `A few quest reports are waiting for review, and ${snapshot.childrenReadyForScreenTime} adventurers are already screen-time ready.`;
    }

    if (snapshot.childrenReadyForScreenTime === this.childSummaries().length) {
      return "Every adventurer is current on today's must-do quests. This is a golden family rhythm day.";
    }

    return `Responsibilities lead the way today. ${snapshot.childrenReadyForScreenTime} adventurers have already unlocked recreation.`;
  });
  readonly headlineStats = computed(() => {
    const snapshot = this.familySnapshot();
    const rewardRequestCount = this.pendingRewardRequests().length;

    return [
      {
        label: 'Weekly Points',
        value: snapshot.weeklyPoints.toString(),
        hint: 'Consistency points banked this week',
      },
      {
        label: 'Ready for Screens',
        value: `${snapshot.childrenReadyForScreenTime}/${this.childSummaries().length}`,
        hint: 'Privileges open after required quests are current',
      },
      {
        label: 'Reward Requests',
        value: rewardRequestCount.toString(),
        hint: 'Top-priority parent approvals from the reward store',
      },
      {
        label: 'Quest Approvals',
        value: snapshot.pendingApprovals.toString(),
        hint: 'Quest checks stay separate from reward decisions',
      },
    ];
  });
  readonly currentModeChecklist = computed(() => this.familySnapshot().currentMode.dailyMinimums);

  constructor() {
    void this.familyData.ensureDashboardDataLoaded();
  }

  showParentSelfBoard() {
    return this.familyData.usesParentSelfBoard();
  }

  async switchMode(modeId: string) {
    const mode = this.seasonalModes().find((item) => item.id === modeId);
    this.reviewFeedback.set(null);
    this.pendingModeId.set(modeId);
    const result = await this.familyData.switchMode(modeId);
    this.pendingModeId.set('');

    if (!result.ok) {
      this.reviewFeedback.set({
        kind: 'error',
        text: result.message ?? 'That seasonal mode could not be made live right now. Try again in a moment.',
      });
      return;
    }

    this.reviewFeedback.set({
      kind: 'success',
      text: `${mode?.name ?? 'That mode'} is now live for your family.`,
    });
  }

  async approveCompletion(completionId: string) {
    const item = this.pendingApprovals().find((entry) => entry.completion.id === completionId);
    this.reviewFeedback.set(null);
    this.pendingReviewId.set(completionId);
    const result = await this.familyData.approveCompletion(completionId);
    this.pendingReviewId.set('');

    if (!result.ok) {
      this.reviewFeedback.set({
        kind: 'error',
        text: result.message ?? 'That quest approval could not be saved right now. Try again in a moment.',
      });
      return;
    }

    this.reviewFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s "${item.quest.title}" is approved.`
        : 'That quest approval is saved.',
    });
  }

  async rejectCompletion(completionId: string) {
    const item = this.pendingApprovals().find((entry) => entry.completion.id === completionId);
    this.reviewFeedback.set(null);
    this.pendingReviewId.set(completionId);
    const result = await this.familyData.rejectCompletion(completionId);
    this.pendingReviewId.set('');

    if (!result.ok) {
      this.reviewFeedback.set({
        kind: 'error',
        text: result.message ?? 'That retry request could not be saved right now. Try again in a moment.',
      });
      return;
    }

    this.reviewFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s "${item.quest.title}" is back on their board for another pass.`
        : 'That quest was sent back for another pass.',
    });
  }

  async approveRewardRequest(redemptionId: string) {
    const item = this.pendingRewardRequests().find((entry) => entry.redemption.id === redemptionId);
    this.reviewFeedback.set(null);
    this.pendingRewardReviewId.set(redemptionId);
    const result = await this.familyData.approveRewardRequest(redemptionId);
    this.pendingRewardReviewId.set('');

    if (!result.ok) {
      this.reviewFeedback.set({
        kind: 'error',
        text: result.message ?? 'That reward approval could not be saved right now. Try again in a moment.',
      });
      return;
    }

    this.reviewFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s "${item.reward.title}" is approved.`
        : 'That reward approval is saved.',
    });
  }

  async declineRewardRequest(redemptionId: string) {
    const item = this.pendingRewardRequests().find((entry) => entry.redemption.id === redemptionId);
    this.reviewFeedback.set(null);
    this.pendingRewardReviewId.set(redemptionId);
    const result = await this.familyData.declineRewardRequest(redemptionId);
    this.pendingRewardReviewId.set('');

    if (!result.ok) {
      this.reviewFeedback.set({
        kind: 'error',
        text: result.message ?? 'That reward decline could not be saved right now. Try again in a moment.',
      });
      return;
    }

    this.reviewFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s "${item.reward.title}" was declined and those points are available again.`
        : 'That reward request was declined and the points are available again.',
    });
  }

  async respondToJournalEntry(entryId: string, reaction: JournalReaction, note: string) {
    const item = this.pendingJournalResponses().find((entry) => entry.entry.id === entryId);
    this.reviewFeedback.set(null);
    this.pendingJournalResponseId.set(entryId);
    const result = await this.familyData.respondToJournalEntry(entryId, {
      reaction,
      note,
    });
    this.pendingJournalResponseId.set('');

    if (!result.ok) {
      this.reviewFeedback.set({
        kind: 'error',
        text: result.message ?? 'That journal response could not be saved right now. Try again in a moment.',
      });
      return;
    }

    this.reviewFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s journal has a ${reaction.toLowerCase()} and a parent note.`
        : 'That journal response is saved.',
    });
  }

  trackByChild(index: number, summary: ChildDaySummary & { progress: number; statusLabel: string }) {
    return `${index}-${summary.child.id}`;
  }
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function formatClockTime(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoDate));
}

function formatRewardType(type: string) {
  return type
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase());
}

function formatJournalDate(isoDate: string) {
  const date = new Date(isoDate);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
