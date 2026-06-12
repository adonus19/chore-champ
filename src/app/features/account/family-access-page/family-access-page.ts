import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { FirebaseAuthService } from '../../../core/services/firebase-auth.service';
import { MockFamilyData } from '../../../core/services/mock-family-data';

type ChildRouteSection = 'today' | 'profile' | 'rewards' | 'goals' | 'journal';

@Component({
  selector: 'app-family-access-page',
  imports: [RouterLink],
  templateUrl: './family-access-page.html',
  styleUrl: './family-access-page.scss',
})
export class FamilyAccessPage {
  private readonly familyData = inject(MockFamilyData);
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly router = inject(Router);

  readonly familyName = this.familyData.familyName;
  readonly familySnapshot = this.familyData.familySnapshot;
  readonly activeViewerBadge = this.familyData.activeViewerBadge;
  readonly accessibleHouseholds = this.familyData.accessibleHouseholds;
  readonly currentHouseholdId = this.familyData.currentHouseholdId;
  readonly currentHouseholdLabel = this.familyData.currentHouseholdLabel;
  readonly householdAccessSyncError = this.familyData.householdAccessSyncError;
  readonly viewerSession = this.familyData.viewerSession;
  readonly parentProfile = this.familyData.parentProfile;
  readonly activeChild = this.familyData.activeChildViewer;
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingHouseholdId = signal('');
  readonly childLaunchCards = computed(() =>
    this.familyData.childSummaries().map((summary) => {
      const rewardRequestCount = this.familyData
        .getRewardActivityForChild(summary.child.id)
        .filter((item) => item.redemption.status === 'pending').length;
      const todayJournal = this.familyData.getTodaysJournalEntry(summary.child.id);

      return {
        ...summary,
        progress: summary.totalRequired === 0 ? 0 : Math.round((summary.completedRequired / summary.totalRequired) * 100),
        statusLabel: summary.screenTimeUnlocked
          ? 'Screen time ready'
          : summary.pendingApprovals > 0
            ? 'Waiting for parent'
            : 'Questing now',
        rewardLabel:
          rewardRequestCount > 0
            ? `${formatCount(rewardRequestCount, 'reward request')} waiting`
            : 'Reward shop is clear',
        journalLabel: todayJournal ? 'Reflection saved for today' : 'Journal still open for a daily win',
      };
    }),
  );
  readonly activeChildCard = computed(() => {
    const activeChild = this.activeChild();

    if (!activeChild) {
      return null;
    }

    return this.childLaunchCards().find((card) => card.child.id === activeChild.id) ?? null;
  });
  readonly heroContent = computed(() => {
    const viewer = this.viewerSession();
    const householdLabel = this.currentHouseholdLabel();

    if (viewer.kind === 'parent') {
      return {
        eyebrow: 'Parent signed in',
        title: householdLabel,
        message:
          'This household launchpad keeps approvals, planning, and child board entry points close together while the signed-in parent lane stays active.',
      };
    }

    if (viewer.kind === 'child') {
      const child = this.activeChild();

      return {
        eyebrow: 'Child signed in',
        title: child ? `${child.name} · ${householdLabel}` : householdLabel,
        message:
          'This lane keeps today\'s board, rewards, goals, and journal close by without surfacing parent approvals or setup tools.',
      };
    }

    return {
      eyebrow: 'Mock sign-in',
      title: this.familyName,
      message:
        'Pick a parent or child door to sign in and open the right flow. Firebase auth comes next, but the role split is already active now.',
    };
  });
  readonly householdOptions = computed(() => {
    const currentHouseholdId = this.currentHouseholdId();

    return this.accessibleHouseholds()
      .map((option) => ({
        ...option,
        isCurrent: option.householdId === currentHouseholdId,
      }))
      .sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent) || left.name.localeCompare(right.name));
  });
  readonly canSwitchOwnHousehold = computed(() =>
    this.householdOptions().some((option) => option.selfSwitchAllowed && !option.isCurrent),
  );
  readonly householdPanel = computed(() => {
    const viewer = this.viewerSession();
    const optionCount = this.householdOptions().length;

    if (viewer.kind === 'child') {
      if (optionCount <= 1) {
        return {
          title: 'One household linked',
          copy: 'This child account currently only has one active household membership.',
        };
      }

      if (this.canSwitchOwnHousehold()) {
        return {
          title: 'Switch household',
          copy: 'This child account can move between already-linked households without signing out.',
        };
      }

      return {
        title: 'Parent-managed switching',
        copy: 'This child account is linked to more than one household, but a parent currently controls the switch.',
      };
    }

    if (viewer.kind === 'parent') {
      return optionCount <= 1
        ? {
            title: 'One household linked',
            copy: 'This parent account is currently attached to a single active household workspace.',
          }
        : {
            title: 'Switch household',
            copy: 'Move this signed-in parent lane between active household memberships without signing out.',
          };
    }

    return {
      title: 'Household access',
      copy: 'Sign in first so the app can load the correct household memberships for this account.',
    };
  });
  readonly launchStats = computed(() => {
    const snapshot = this.familySnapshot();

    return [
      {
        label: 'Current mode',
        value: snapshot.currentMode.name,
        hint: 'The whole mock family is moving in this rhythm right now',
      },
      {
        label: 'Ready for screens',
        value: `${snapshot.childrenReadyForScreenTime}/${this.childLaunchCards().length}`,
        hint: 'Children who have cleared the must-do gate',
      },
      {
        label: 'Reward reviews',
        value: this.familyData.pendingRewardRequests().length.toString(),
        hint: 'Top-priority parent approvals waiting on the dashboard',
      },
      {
        label: 'Quest checks',
        value: snapshot.pendingApprovals.toString(),
        hint: 'Quest submissions still waiting for a parent review',
      },
    ];
  });
  readonly parentCardCopy = computed(() =>
    this.viewerSession().kind === 'parent'
      ? 'Open the dashboard when you want the whole family pulse first, or jump straight into setup work from the quick actions below.'
      : 'A parent sign-in opens approvals, planning, seasonal rhythm, and family setup tools in one predictable lane.',
  );
  readonly parentQueueLabel = computed(() => {
    const rewardCount = this.familyData.pendingRewardRequests().length;
    const approvalCount = this.familyData.pendingApprovals().length;
    const journalCount = this.familyData.pendingJournalResponses().length;

    return `${formatCount(rewardCount, 'reward review')}, ${formatCount(approvalCount, 'quest check')}, and ${formatCount(journalCount, 'journal reply')} waiting.`;
  });
  readonly sharedNote = computed(() => {
    const viewer = this.viewerSession();

    if (viewer.kind === 'parent') {
      return {
        title: 'Signed in for the full family view',
        copy: 'Parents can move between setup, approvals, and each child board without losing their role.',
      };
    }

    if (viewer.kind === 'child') {
      return {
        title: 'One child lane at a time',
        copy: 'Kids stay inside their own board, rewards, goals, profile, and journal flow while parent approvals remain protected.',
      };
    }

    return {
      title: 'One family, clear sign-in lanes',
      copy: 'This shared-device entry point now acts like a lightweight auth door: parents head into admin tools, and kids land in their own daily lane.',
    };
  });

  async switchCurrentHousehold(householdId: string) {
    const target = this.householdOptions().find((option) => option.householdId === householdId);

    this.actionFeedback.set(null);
    this.pendingHouseholdId.set(householdId);
    const result = await this.familyData.switchCurrentHousehold(householdId);
    this.pendingHouseholdId.set('');

    if (!result.ok) {
      this.actionFeedback.set({
        kind: 'error',
        text: result.message ?? 'That household could not be opened right now. Try again in a moment.',
      });
      return;
    }

    this.actionFeedback.set({
      kind: 'success',
      text: `${target?.name ?? 'That household'} is now the active household for this signed-in account.`,
    });
  }

  openFamilyDashboard() {
    this.familyData.setParentViewer();
    void this.router.navigateByUrl('/');
  }

  openParentChildren() {
    this.familyData.setParentViewer();
    void this.router.navigateByUrl('/parent/children');
  }

  openParentQuests() {
    this.familyData.setParentViewer();
    void this.router.navigateByUrl('/parent/quests');
  }

  openMyBoard() {
    this.familyData.setParentViewer();
    void this.router.navigateByUrl('/parent/me');
  }

  openChildSection(childId: string, section: ChildRouteSection = 'today') {
    if (this.viewerSession().kind === 'shared') {
      this.familyData.setChildViewer(childId);
    }

    void this.router.navigateByUrl(this.familyData.childRoutePath(childId, section));
  }

  async switchFamilyMember() {
    await this.firebaseAuth.signOut();
    this.familyData.signOut();
    void this.router.navigateByUrl('/login');
  }
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}
