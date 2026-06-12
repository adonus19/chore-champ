import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import {
  ApprovalItem,
  AuthBootstrapProfile,
  BonusMoment,
  ChildDaySummary,
  ChildProfile,
  ChildProfileDraft,
  FamilySnapshot,
  Goal,
  GoalDraft,
  GoalSpotlight,
  JournalEntry,
  JournalReaction,
  JournalReviewItem,
  PrivilegeRule,
  PrivilegeRuleDraft,
  Quest,
  QuestBoardItem,
  QuestBoardStatus,
  QuestCompletion,
  QuestDraft,
  Reward,
  RewardRedemption,
  RewardRequestItem,
  SeasonalMode,
  SeasonalModeDraft,
  UserProfile,
  ViewerBadge,
  ViewerSession,
} from '../models/family.models';
import { FirebaseAuthService } from './firebase-auth.service';
import { BonusMutationResult, FirebaseBonusDataService } from './firebase-bonus-data.service';
import { FirebaseChildProfilesService } from './firebase-child-profiles.service';
import { FirebaseGoalDataService, GoalMutationResult } from './firebase-goal-data.service';
import {
  FirebaseHouseholdAccessService,
  HouseholdAccessMutationResult,
} from './firebase-household-access.service';
import {
  FirebaseHouseholdSettingsService,
  HouseholdSettingsMutationResult,
} from './firebase-household-settings.service';
import { FirebaseJournalDataService, JournalMutationResult } from './firebase-journal-data.service';
import {
  FirebasePrivilegeRulesService,
  PrivilegeMutationResult,
} from './firebase-privilege-rules.service';
import { FirebaseQuestDataService, QuestMutationResult } from './firebase-quest-data.service';
import { FirebaseRewardDataService, RewardMutationResult } from './firebase-reward-data.service';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

type ChildRouteSection = 'today' | 'profile' | 'rewards' | 'goals' | 'journal';
const VIEWER_SESSION_STORAGE_KEY = 'chore-champ.viewer-session';
const DEMO_PARENT_ACCESS_CODE = 'parent-demo';
const DEFAULT_ACTIVE_MODE_ID = 'school-year';

@Injectable({
  providedIn: 'root',
})
export class MockFamilyData {
  private readonly today = formatDateKey(new Date());
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseBonusData = inject(FirebaseBonusDataService);
  private readonly firebaseChildProfiles = inject(FirebaseChildProfilesService);
  private readonly firebaseGoalData = inject(FirebaseGoalDataService);
  private readonly firebaseHouseholdAccess = inject(FirebaseHouseholdAccessService);
  private readonly firebaseHouseholdSettings = inject(FirebaseHouseholdSettingsService);
  private readonly firebaseJournalData = inject(FirebaseJournalDataService);
  private readonly firebasePrivilegeRules = inject(FirebasePrivilegeRulesService);
  private readonly firebaseQuestData = inject(FirebaseQuestDataService);
  private readonly firebaseRewardData = inject(FirebaseRewardDataService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private firebaseHouseholdSyncToken = 0;

  readonly familyName = 'Chore Champ HQ';
  readonly demoParentAccessCode = DEMO_PARENT_ACCESS_CODE;
  private readonly _parentProfile = signal(PARENT_PROFILE);
  readonly parentProfile = this._parentProfile.asReadonly();
  private readonly _viewerSession = signal<ViewerSession>({
    kind: 'shared',
  });
  readonly viewerSession = this._viewerSession.asReadonly();
  private readonly _activeModeId = signal(DEFAULT_ACTIVE_MODE_ID);
  readonly activeModeId = this._activeModeId.asReadonly();
  readonly householdAccessSyncError = this.firebaseHouseholdAccess.lastSyncError;
  readonly householdSettingsSyncError = this.firebaseHouseholdSettings.lastSyncError;
  private readonly _seasonalModes = signal(SEASONAL_MODES);
  readonly seasonalModes = this._seasonalModes.asReadonly();
  private readonly _baseChildren = signal(CHILD_PROFILES);
  private readonly _quests = signal(QUESTS);
  readonly quests = this._quests.asReadonly();
  private readonly _completions = signal(SEED_COMPLETIONS);
  readonly completions = this._completions.asReadonly();
  private readonly _rewards = signal(REWARDS);
  readonly rewards = this._rewards.asReadonly();
  private readonly _rewardRedemptions = signal<RewardRedemption[]>(SEED_REWARD_REDEMPTIONS);
  readonly rewardRedemptions = this._rewardRedemptions.asReadonly();
  private readonly _privilegeRules = signal(PRIVILEGE_RULES);
  readonly privilegeRules = this._privilegeRules.asReadonly();
  readonly privilegeRulesSyncError = this.firebasePrivilegeRules.lastSyncError;
  private readonly _goals = signal(GOALS);
  readonly goals = this._goals.asReadonly();
  private readonly _journalEntries = signal(JOURNAL_ENTRIES);
  readonly journalEntries = this._journalEntries.asReadonly();
  readonly journalSyncError = this.firebaseJournalData.lastSyncError;
  private readonly _bonusMoments = signal<BonusMoment[]>(BONUS_MOMENTS);
  readonly bonusMoments = this._bonusMoments.asReadonly();
  readonly children = computed(() => applyRewardRedemptionOffsetsToChildren(this._baseChildren(), this.rewardRedemptions()));
  readonly accessibleHouseholds = computed(() => this.firebaseHouseholdAccess.accessibleHouseholds() ?? []);
  // The signed-in parent's own personId, used so parents can own personal goals/quests keyed by that id.
  readonly currentParentPersonId = computed(() => {
    const profile = this.firebaseUserProfile.currentProfile();

    return profile?.source === 'authAccount' && profile.role === 'parent' ? profile.personId : '';
  });
  readonly usesParentSelfBoard = computed(() => Boolean(this.currentParentPersonId()));
  readonly currentParentDisplayName = computed(() => {
    const profile = this.firebaseUserProfile.currentProfile();

    return profile?.source === 'authAccount' && profile.role === 'parent'
      ? profile.displayName.trim() || 'Parent'
      : this.parentProfile().displayName;
  });
  readonly parentGoals = computed(() => {
    const personId = this.currentParentPersonId();

    return personId ? this.goals().filter((goal) => goal.childId === personId) : [];
  });
  readonly parentQuestBoard = computed(() => {
    const personId = this.currentParentPersonId();

    if (!personId) {
      return [];
    }

    const completions = this.completions();
    const activeModeId = this.activeModeId();

    return this.quests()
      .filter((quest) => quest.assignedTo.includes(personId))
      .map((quest) => ({
        quest,
        done: completions.some(
          (completion) =>
            completion.questId === quest.id &&
            completion.childId === personId &&
            (completion.status === 'approved' || completion.status === 'autoApproved'),
        ),
        liveInCurrentMode: quest.activeModes.includes(activeModeId),
      }))
      .sort((left, right) => Number(left.done) - Number(right.done) || left.quest.title.localeCompare(right.quest.title));
  });

  constructor() {
    this.restoreViewerSession();

    effect(() => {
      this.persistViewerSession(this.viewerSession());
    });

    effect(() => {
      if (this.firebaseAuth.firebaseEnabled && this.firebaseAuth.authReady() && !this.firebaseAuth.isAuthenticated()) {
        this.restoreDefaultActiveMode();
        this.restoreSeedChildren();
        this.restoreSeedBonusData();
        this.restoreSeedGoalData();
        this.restoreSeedJournalData();
        this.restoreSeedPrivilegeData();
        this.restoreSeedQuestData();
        this.restoreSeedRewardData();
        this.firebaseBonusData.stopSync();
        this.firebaseGoalData.stopSync();
        this.firebaseHouseholdAccess.stopSync();
        this.firebaseHouseholdSettings.stopSync();
        this.firebaseJournalData.stopSync();
        this.firebasePrivilegeRules.stopSync();
        this.firebaseQuestData.stopSync();
        this.firebaseRewardData.stopSync();
        this._viewerSession.set({
          kind: 'shared',
        });
      }
    });

    effect(() => {
      void this.syncFirebaseHouseholdState();
    });

    effect(() => {
      if (!this.firebaseAuth.firebaseEnabled || !this.firebaseAuth.authReady()) {
        return;
      }

      const profile = this.firebaseUserProfile.currentProfile();
      const remoteActiveModeId = this.firebaseHouseholdSettings.activeModeId();
      const remoteBonusMoments = this.firebaseBonusData.bonusMoments();
      const remoteGoals = this.firebaseGoalData.goals();
      const remoteJournalEntries = this.firebaseJournalData.journalEntries();
      const remotePrivilegeRules = this.firebasePrivilegeRules.privilegeRules();
      const remoteQuests = this.firebaseQuestData.quests();
      const remoteCompletions = this.firebaseQuestData.completions();
      const remoteRewardRedemptions = this.firebaseRewardData.rewardRedemptions();

      if (profile?.source === 'authAccount' && profile.householdId) {
        if (remoteActiveModeId && this.modeById(remoteActiveModeId) && this.activeModeId() !== remoteActiveModeId) {
          this.applyActiveMode(remoteActiveModeId);
          void this.refreshFirebaseHouseholdChildren();
        }

        if (remoteBonusMoments) {
          this._bonusMoments.set(remoteBonusMoments);
          void this.refreshFirebaseHouseholdChildren();
        }

        if (remoteGoals) {
          this._goals.set(remoteGoals);
        }

        if (remoteJournalEntries) {
          this._journalEntries.set(remoteJournalEntries);
        }

        if (remotePrivilegeRules) {
          this.replacePrivilegeRules(remotePrivilegeRules);
        }

        if (remoteQuests) {
          this._quests.set(remoteQuests);
        }

        if (remoteCompletions) {
          this._completions.set(remoteCompletions);
          void this.refreshFirebaseHouseholdChildren();
        }

        if (remoteRewardRedemptions) {
          this.replaceRewardRedemptions(remoteRewardRedemptions);
        }

        return;
      }

      this.restoreDefaultActiveMode();
      this.restoreSeedBonusData();
      this.restoreSeedGoalData();
      this.restoreSeedJournalData();
      this.restoreSeedPrivilegeData();
      this.restoreSeedQuestData();
      this.restoreSeedRewardData();
    });
  }

  readonly activeMode = computed(
    () => this.seasonalModes().find((mode) => mode.id === this.activeModeId()) ?? this.seasonalModes()[0],
  );
  readonly isSignedIn = computed(() =>
    this.firebaseAuth.firebaseEnabled ? this.firebaseAuth.isAuthenticated() : this.viewerSession().kind !== 'shared',
  );
  readonly currentHouseholdId = computed(() => this.firebaseUserProfile.currentProfile()?.householdId ?? null);
  readonly currentHouseholdLabel = computed(() => {
    const profile = this.firebaseUserProfile.currentProfile();

    if (!this.firebaseAuth.firebaseEnabled || profile?.source !== 'authAccount') {
      return this.familyName;
    }

    return (
      this.firebaseHouseholdAccess.currentHouseholdName()
      ?? this.accessibleHouseholds().find((household) => household.householdId === profile.householdId)?.name
      ?? 'Current household'
    );
  });
  readonly displayFamilyName = computed(() => {
    const profile = this.firebaseUserProfile.currentProfile();

    if (!this.firebaseAuth.firebaseEnabled || profile?.source !== 'authAccount') {
      return this.familyName;
    }

    return (
      this.firebaseHouseholdAccess.currentHouseholdName()
      ?? this.accessibleHouseholds().find((household) => household.householdId === profile.householdId)?.name
      ?? 'Current household'
    );
  });
  readonly demoChildAccessCodes = computed(() =>
    this.children().map((child, index) => ({
      childId: child.id,
      code: `child-${index + 1}`,
    })),
  );
  readonly currentScreenTimeRule = computed(
    () =>
      this.privilegeRules().find(
        (rule) => rule.type === 'screenTime' && rule.activeModes.includes(this.activeMode().id),
      ) ?? null,
  );
  readonly activeChildViewer = computed(() => {
    const viewer = this.viewerSession();

    if (viewer.kind !== 'child' || !viewer.profileId) {
      return null;
    }

    return this.childById(viewer.profileId) ?? null;
  });

  readonly activeViewerBadge = computed<ViewerBadge>(() => {
    const viewer = this.viewerSession();

    if (viewer.kind === 'shared') {
      return {
        label: 'Signed out',
        helper: 'Sign in first so the app knows which family lane and data to open.',
        themeColor: '#74c7ff',
      };
    }

    if (viewer.kind === 'child') {
      const child = viewer.profileId ? this.childById(viewer.profileId) : null;

      if (child) {
        return {
          label: `${child.name}'s board`,
          helper: `Currently in ${this.currentHouseholdLabel()}. Quest progress, rewards, goals, and journal tools stay centered on the child flow.`,
          themeColor: child.themeColor,
        };
      }
    }

    return {
      label: 'Parent command view',
      helper: `Currently in ${this.currentHouseholdLabel()}. Approvals, planning, and the family rhythm tools stay right at the top level here.`,
      themeColor: this.parentProfile().themeColor,
    };
  });

  readonly childSummaries = computed(() => this.children().map((child) => this.buildChildSummary(child)));

  readonly pendingApprovals = computed<ApprovalItem[]>(() =>
    this.completions()
      .filter((completion) => completion.status === 'pending' && isSameDay(completion.completedAt, this.today))
      .map((completion) => {
        const child = this.childById(completion.childId);
        const quest = this.questById(completion.questId);

        if (!child || !quest) {
          return null;
        }

        return {
          completion,
          child,
          quest,
        };
      })
      .filter((item): item is ApprovalItem => item !== null),
  );

  readonly pendingRewardRequests = computed<RewardRequestItem[]>(() =>
    this.rewardRedemptions()
      .filter((redemption) => redemption.status === 'pending')
      .map((redemption) => {
        const child = this.childById(redemption.childId);
        const reward = this.rewardById(redemption.rewardId);

        if (!child || !reward) {
          return null;
        }

        return {
          redemption,
          child,
          reward,
        };
      })
      .filter((item): item is RewardRequestItem => item !== null),
  );

  readonly familySnapshot = computed<FamilySnapshot>(() => {
    const summaries = this.childSummaries();
    const totalPoints = this.children().reduce((sum, child) => sum + child.points, 0);

    return {
      currentMode: this.activeMode(),
      totalPoints,
      weeklyPoints: this.pointsWithinDays(7),
      familyStreak: this.children().reduce((lowest, child) => Math.min(lowest, child.streakDays), Number.MAX_SAFE_INTEGER),
      childrenReadyForScreenTime: summaries.filter((summary) => summary.screenTimeUnlocked).length,
      pendingApprovals: this.pendingApprovals().length,
    };
  });

  readonly goalSpotlights = computed<GoalSpotlight[]>(() =>
    this.goals()
      .map((goal) => {
        const child = this.childById(goal.childId);

        if (!child) {
          return null;
        }

        const progress = Math.min(100, Math.round((goal.current / goal.target) * 100));

        return {
          child,
          goal,
          progress,
          remaining: Math.max(goal.target - goal.current, 0),
        };
      })
      .filter((goal): goal is GoalSpotlight => goal !== null),
  );

  readonly latestJournalHighlights = computed(() =>
    this.journalEntries()
      .slice()
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 2)
      .map((entry) => ({
        entry,
        child: this.childById(entry.childId),
      }))
      .filter((item): item is { entry: JournalEntry; child: ChildProfile } => Boolean(item.child)),
  );

  readonly pendingJournalResponses = computed<JournalReviewItem[]>(() =>
    this.journalEntries()
      .filter((entry) => entry.needsParentResponse ?? (!entry.parentReaction && !entry.parentNote))
      .slice()
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((entry) => {
        const child = this.childById(entry.childId);

        if (!child) {
          return null;
        }

        return {
          entry,
          child,
        };
      })
      .filter((item): item is JournalReviewItem => item !== null),
  );

  childById(childId: string) {
    return this.children().find((child) => child.id === childId);
  }

  modeById(modeId: string) {
    return this.seasonalModes().find((mode) => mode.id === modeId);
  }

  questById(questId: string) {
    return this.quests().find((quest) => quest.id === questId);
  }

  rewardById(rewardId: string) {
    return this.rewards().find((reward) => reward.id === rewardId);
  }

  goalById(goalId: string) {
    return this.goals().find((goal) => goal.id === goalId);
  }

  getQuestBoard(childId: string, modeId = this.activeModeId()): QuestBoardItem[] {
    const child = this.childById(childId);
    const mode = this.modeById(modeId);

    if (!child || !mode) {
      return [];
    }

    return this.quests()
      .filter((quest) => quest.assignedTo.includes(childId) && quest.activeModes.includes(modeId))
      .map((quest) => {
        const completion = this.findCompletion(quest.id, childId);
        const status = mapStatus(completion?.status);
        const approved = status === 'approved';
        const countsTowardRequired = quest.category !== 'bonus' && mode.requiredCategories.includes(quest.category);
        const countsTowardScreenTime = quest.requiredBeforeScreenTime && countsTowardRequired;

        return {
          child,
          quest,
          status,
          note: describeQuestStatus(quest, completion, status, countsTowardRequired),
          pointsEarned: approved ? quest.points : 0,
          countsTowardRequired,
          countsTowardScreenTime,
        };
      })
      .sort(sortQuestBoardItems);
  }

  getChildSummary(childId: string, modeId = this.activeModeId()) {
    const child = this.childById(childId);
    return child ? this.buildChildSummary(child, modeId) : null;
  }

  getGoalsForChild(childId: string, modeId = this.activeModeId()) {
    const child = this.childById(childId);

    if (!child) {
      return [];
    }

    return this.goals()
      .filter((goal) => goal.childId === childId && goal.activeModes.includes(modeId))
      .map((goal) => {
        const progress = Math.min(100, Math.round((goal.current / goal.target) * 100));
        const remaining = Math.max(goal.target - goal.current, 0);

        return {
          child,
          goal,
          progress,
          remaining,
          complete: remaining === 0,
        };
      })
      .sort((left, right) => {
        if (left.complete !== right.complete) {
          return Number(left.complete) - Number(right.complete);
        }

        if (left.progress !== right.progress) {
          return right.progress - left.progress;
        }

        return left.goal.title.localeCompare(right.goal.title);
      });
  }

  getJournalEntriesForChild(childId: string) {
    return this.journalEntries()
      .filter((entry) => entry.childId === childId)
      .slice()
      .sort((left, right) => right.date.localeCompare(left.date));
  }

  getTodaysJournalEntry(childId: string) {
    return this.journalEntries().find((entry) => entry.childId === childId && isSameDay(entry.date, this.today));
  }

  getRewardsForChild(childId: string) {
    const child = this.childById(childId);

    if (!child) {
      return [];
    }

    return this.rewards()
      .filter((reward) => reward.active)
      .map((reward) => ({
        reward,
        affordable: child.points >= reward.pointCost,
        pointsLeft: Math.max(reward.pointCost - child.points, 0),
        pendingRequest: this.rewardRedemptions().some(
          (redemption) =>
            redemption.childId === childId && redemption.rewardId === reward.id && redemption.status === 'pending',
        ),
      }))
      .map((item) => ({
        ...item,
        canRedeem: item.affordable && !item.pendingRequest,
        actionLabel: item.pendingRequest
          ? 'Waiting for parent'
          : item.reward.requiresParentApproval
            ? 'Request reward'
            : 'Redeem now',
      }))
      .sort((left, right) => left.reward.pointCost - right.reward.pointCost);
  }

  getRewardActivityForChild(childId: string): RewardRequestItem[] {
    const child = this.childById(childId);

    if (!child) {
      return [];
    }

    return this.rewardRedemptions()
      .filter((redemption) => redemption.childId === childId)
      .slice()
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
      .map((redemption) => {
        const reward = this.rewardById(redemption.rewardId);

        if (!reward) {
          return null;
        }

        return {
          redemption,
          child,
          reward,
        };
      })
      .filter((item): item is RewardRequestItem => item !== null);
  }

  childRoutePath(childId: string, section: ChildRouteSection = 'today') {
    return `/children/${childId}/${section}`;
  }

  viewerHomeUrl() {
    if (!this.isSignedIn()) {
      return '/login';
    }

    const viewer = this.viewerSession();

    if (viewer.kind === 'parent') {
      return '/family-access';
    }

    if (viewer.kind === 'child' && viewer.profileId && this.childById(viewer.profileId)) {
      return this.childRoutePath(viewer.profileId);
    }

    return '/login';
  }

  canAccessParentViews() {
    return this.isSignedIn() && this.viewerSession().kind === 'parent';
  }

  canAccessChildView(childId: string) {
    if (!this.childById(childId)) {
      return false;
    }

    const viewer = this.viewerSession();

    return this.isSignedIn() && (viewer.kind === 'parent' || (viewer.kind === 'child' && viewer.profileId === childId));
  }

  parentAccessFallbackUrl() {
    const viewer = this.viewerSession();

    if (viewer.kind === 'child' && viewer.profileId && this.childById(viewer.profileId)) {
      return this.childRoutePath(viewer.profileId);
    }

    return '/login';
  }

  childAccessFallbackUrl(section: ChildRouteSection = 'today') {
    const viewer = this.viewerSession();

    if (viewer.kind === 'parent') {
      return '/';
    }

    if (viewer.kind === 'child' && viewer.profileId && this.childById(viewer.profileId)) {
      return this.childRoutePath(viewer.profileId, section);
    }

    return '/login';
  }

  async switchMode(modeId: string): Promise<HouseholdSettingsMutationResult> {
    if (!this.modeById(modeId)) {
      return {
        ok: false,
        message: 'That seasonal mode could not be found.',
      };
    }

    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseHouseholdSettings.setActiveMode(modeId);

      if (result.ok) {
        this.applyActiveMode(result.activeModeId ?? modeId);
      }

      return result;
    }

    this.applyActiveMode(modeId);
    return {
      activeModeId: modeId,
      ok: true,
      source: 'local',
    };
  }

  async switchCurrentHousehold(householdId: string): Promise<HouseholdAccessMutationResult> {
    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (!this.shouldUseFirebaseHouseholdData()) {
      return {
        ok: false,
        message: 'Household switching is only available for signed-in Firebase household accounts.',
        source: 'local',
      };
    }

    return this.firebaseHouseholdAccess.switchCurrentHousehold(householdId);
  }

  async pointChildAccountToCurrentHousehold(childId: string): Promise<HouseholdAccessMutationResult> {
    const child = this.childById(childId);

    if (!child?.login?.enabled || !child.login.authUid) {
      return {
        ok: false,
        message: 'Enable this child login first so the household pointer can be updated.',
      };
    }

    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (!this.shouldUseFirebaseHouseholdData()) {
      return {
        ok: false,
        message: 'Child household switching is only available for signed-in Firebase household accounts.',
        source: 'local',
      };
    }

    return this.firebaseHouseholdAccess.pointChildAccountToCurrentHousehold(childId, child.login.authUid);
  }

  setSharedViewer() {
    this.updateViewer({
      kind: 'shared',
    });
  }

  signOut() {
    this.restoreDefaultActiveMode();
    this.restoreSeedChildren();
    this.restoreSeedBonusData();
    this.restoreSeedGoalData();
    this.restoreSeedJournalData();
    this.restoreSeedPrivilegeData();
    this.restoreSeedQuestData();
    this.restoreSeedRewardData();
    this.firebaseHouseholdAccess.stopSync();
    this.setSharedViewer();
  }

  setParentViewer() {
    this.updateViewer({
      kind: 'parent',
      profileId: this.parentProfile().id,
    });
  }

  signInParentWithCode(code: string) {
    if (normalizeAccessCode(code) !== DEMO_PARENT_ACCESS_CODE) {
      return false;
    }

    this.setParentViewer();
    return true;
  }

  setChildViewer(childId: string) {
    if (!this.childById(childId)) {
      return;
    }

    this.updateViewer({
      kind: 'child',
      profileId: childId,
    });
  }

  signInChildWithCode(code: string) {
    const normalizedCode = normalizeAccessCode(code);
    const match = this.demoChildAccessCodes().find((item) => item.code === normalizedCode);

    if (!match) {
      return null;
    }

    this.setChildViewer(match.childId);
    return match.childId;
  }

  replaceChildren(children: ChildProfile[]) {
    const activeModeId = this.activeModeId();
    this._baseChildren.set(children.map((child) => ({ ...child, activeModeId })));
  }

  upsertChildProfile(child: ChildProfile) {
    this._baseChildren.update((children) => {
      const existingIndex = children.findIndex((item) => item.id === child.id);

      if (existingIndex === -1) {
        return [child, ...children].sort((left, right) => left.name.localeCompare(right.name));
      }

      return children
        .map((item) => (item.id === child.id ? child : item))
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  async refreshFirebaseHouseholdChildren() {
    const profile = this.firebaseUserProfile.currentProfile();

    if (!this.firebaseAuth.firebaseEnabled || !profile?.householdId || profile.source !== 'authAccount') {
      return;
    }

    const children = await this.firebaseChildProfiles.loadAccessibleChildren(profile, this.activeModeId());
    this.replaceChildren(children);
  }

  addChildProfile(draft: ChildProfileDraft) {
    const normalizedDraft = normalizeChildProfileDraft(draft);

    if (!normalizedDraft) {
      return;
    }

    const child = {
      id: createId('child'),
      activeModeId: this.activeModeId(),
      ...normalizedDraft,
    };

    this._baseChildren.update((children) => [child, ...children]);
  }

  updateChildProfile(childId: string, draft: ChildProfileDraft) {
    const existing = this.baseChildById(childId);
    const normalizedDraft = normalizeChildProfileDraft(draft);

    if (!existing || !normalizedDraft) {
      return;
    }

    this._baseChildren.update((children) =>
      children.map((child) =>
        child.id === childId
          ? {
              ...child,
              ...normalizedDraft,
            }
          : child,
      ),
    );
  }

  updateSeasonalMode(modeId: string, draft: SeasonalModeDraft) {
    const existing = this.modeById(modeId);
    const normalizedDraft = normalizeSeasonalModeDraft(draft);

    if (!existing || !normalizedDraft) {
      return;
    }

    this._seasonalModes.update((modes) =>
      modes.map((mode) =>
        mode.id === modeId
          ? {
              ...mode,
              ...normalizedDraft,
            }
          : mode,
      ),
    );
  }

  async updatePrivilegeRule(ruleId: string, draft: PrivilegeRuleDraft): Promise<PrivilegeMutationResult> {
    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebasePrivilegeRules.updateRule(ruleId, draft, this.privilegeRules());

      if (result.ok && result.rules) {
        this.replacePrivilegeRules(result.rules);
      }

      return result;
    }

    const existing = this.privilegeRules().find((rule) => rule.id === ruleId);
    const normalizedDraft = normalizePrivilegeRuleDraft(draft);

    if (!existing || !normalizedDraft) {
      return {
        ok: false,
        message: 'This privilege rule is missing required details.',
      };
    }

    const updatedRule: PrivilegeRule = {
      ...existing,
      ...normalizedDraft,
    };
    const updatedRules = this.privilegeRules().map((rule) =>
      rule.id === ruleId
        ? updatedRule
        : rule,
    );

    this._privilegeRules.update((rules) =>
      rules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              ...normalizedDraft,
            }
          : rule,
      ),
    );

    return {
      ok: true,
      rule: updatedRule,
      rules: updatedRules,
      source: 'local',
    };
  }

  async completeQuest(questId: string, childId: string): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.completeQuest(questId, childId);
    }

    const quest = this.questById(questId);

    if (!quest) {
      return { ok: false, message: 'That quest could not be found.' };
    }

    const existing = this.findCompletion(questId, childId);

    if (existing && (existing.status === 'approved' || existing.status === 'autoApproved' || existing.status === 'pending')) {
      return { ok: true };
    }

    const now = new Date().toISOString();
    const status = quest.requiresApproval ? 'pending' : 'autoApproved';
    const nextCompletion: QuestCompletion = {
      id: existing?.id ?? createId('completion'),
      questId,
      childId,
      completedAt: now,
      status,
      approvedBy: quest.requiresApproval ? undefined : 'Auto-approved',
      notes: quest.requiresApproval ? 'Waiting for parent approval.' : 'Auto-approved by quest settings.',
    };

    this._completions.update((completions) => {
      if (!existing) {
        return [...completions, nextCompletion];
      }

      return completions.map((completion) => (completion.id === existing.id ? nextCompletion : completion));
    });

    if (status === 'autoApproved') {
      this.adjustChildPoints(childId, quest.points);
    }

    return { ok: true };
  }

  // Self-certified done/undone for a parent's own personal quest. Firebase-backed only — there is no local
  // mock equivalent because personal parent quests live entirely in the signed-in Firestore household.
  async setParentQuestDone(questId: string, done: boolean): Promise<QuestMutationResult> {
    const personId = this.currentParentPersonId();

    if (!personId) {
      return { ok: false, message: 'Sign in with a real parent account to track personal quests.' };
    }

    return this.firebaseQuestData.setParentQuestCompletion(questId, personId, done);
  }

  async approveCompletion(completionId: string): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.approveCompletion(completionId);
    }

    const completion = this.completions().find((item) => item.id === completionId);
    const quest = completion ? this.questById(completion.questId) : null;

    if (!completion || !quest || completion.status !== 'pending') {
      return { ok: false, message: 'That approval item is no longer waiting.' };
    }

    this._completions.update((completions) =>
      completions.map((item) =>
        item.id === completionId
          ? {
              ...item,
              status: 'approved',
              approvedBy: 'Parent',
              notes: 'Nice work. Approved by a parent.',
            }
          : item,
      ),
    );

    this.adjustChildPoints(completion.childId, quest.points);
    return { ok: true };
  }

  async rejectCompletion(completionId: string): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.rejectCompletion(completionId);
    }

    this._completions.update((completions) =>
      completions.map((completion) =>
        completion.id === completionId
          ? {
              ...completion,
              status: 'rejected',
              notes: 'Almost there. Clean it up once more and resubmit.',
            }
          : completion,
      ),
    );

    return { ok: true };
  }

  async overrideQuestStatus(questId: string, childId: string, status: QuestBoardStatus): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.overrideQuestStatus(questId, childId, status);
    }

    const quest = this.questById(questId);
    const child = this.childById(childId);
    const existing = this.findCompletion(questId, childId);

    if (!quest || !child) {
      return { ok: false, message: 'That child quest could not be found.' };
    }

    const previousAwardedPoints =
      existing && (existing.status === 'approved' || existing.status === 'autoApproved') ? quest.points : 0;

    if (status === 'open') {
      if (!existing) {
        return { ok: false, message: 'There is nothing to clear for this quest yet.' };
      }

      this._completions.update((completions) => completions.filter((completion) => completion.id !== existing.id));

      if (previousAwardedPoints > 0) {
        this.adjustChildPoints(childId, -previousAwardedPoints);
      }

      return { ok: true };
    }

    const nextStatus: QuestCompletion['status'] = status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'rejected';
    const nextAwardedPoints = status === 'approved' ? quest.points : 0;
    const pointsDelta = nextAwardedPoints - previousAwardedPoints;
    const now = new Date().toISOString();
    const nextCompletion: QuestCompletion = {
      id: existing?.id ?? createId('completion'),
      questId,
      childId,
      completedAt: now,
      status: nextStatus,
      approvedBy: status === 'approved' ? 'Parent override' : undefined,
      notes:
        status === 'approved'
          ? 'Approved directly by a parent override.'
          : status === 'pending'
            ? 'Placed back into parent review by override.'
            : 'Marked for another pass by a parent override.',
    };

    this._completions.update((completions) => {
      if (!existing) {
        return [...completions, nextCompletion];
      }

      return completions.map((completion) => (completion.id === existing.id ? nextCompletion : completion));
    });

    if (pointsDelta !== 0) {
      this.adjustChildPoints(childId, pointsDelta);
    }

    return { ok: true };
  }

  async addQuest(draft: QuestDraft): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.addQuest(draft);
    }

    const normalizedDraft = normalizeQuestDraft(draft);

    if (!normalizedDraft) {
      return { ok: false, message: 'This quest is missing required details.' };
    }

    const quest: Quest = {
      id: createId('quest'),
      ...normalizedDraft,
    };

    this._quests.update((quests) => [quest, ...quests]);
    return { ok: true };
  }

  async updateQuest(questId: string, draft: QuestDraft): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.updateQuest(questId, draft);
    }

    const existing = this.questById(questId);
    const normalizedDraft = normalizeQuestDraft(draft);

    if (!existing || !normalizedDraft) {
      return { ok: false, message: 'This quest could not be saved.' };
    }

    this._quests.update((quests) =>
      quests.map((quest) =>
        quest.id === questId
          ? {
              ...quest,
              ...normalizedDraft,
            }
          : quest,
      ),
    );

    return { ok: true };
  }

  async deleteQuest(questId: string): Promise<QuestMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      return this.firebaseQuestData.deleteQuest(questId);
    }

    this._quests.update((quests) => quests.filter((quest) => quest.id !== questId));
    this._completions.update((completions) => completions.filter((completion) => completion.questId !== questId));
    return { ok: true };
  }

  async redeemReward(rewardId: string, childId: string): Promise<RewardMutationResult> {
    const child = this.childById(childId);
    const reward = this.rewardById(rewardId);

    if (!child || !reward || !reward.active || child.points < reward.pointCost) {
      return {
        ok: false,
        message: 'This reward is not available to redeem right now.',
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseRewardData.redeemReward(reward, childId);

      if (result.ok && result.redemption) {
        this.upsertRewardRedemption(result.redemption);
      }

      return result;
    }

    const hasPendingRequest = this.rewardRedemptions().some(
      (redemption) => redemption.childId === childId && redemption.rewardId === rewardId && redemption.status === 'pending',
    );

    if (hasPendingRequest) {
      return {
        ok: false,
        message: 'That reward is already waiting for a parent review.',
      };
    }

    const nextRedemption: RewardRedemption = {
      id: createId('reward-redemption'),
      rewardId,
      childId,
      requestedAt: new Date().toISOString(),
      status: reward.requiresParentApproval ? 'pending' : 'fulfilled',
      pointCost: reward.pointCost,
      note: reward.requiresParentApproval
        ? 'Points are reserved while a parent reviews this reward request.'
        : 'Reward redeemed from the quest store.',
    };

    this.replaceRewardRedemptions([nextRedemption, ...this.rewardRedemptions()]);
    return { ok: true };
  }

  async approveRewardRequest(redemptionId: string): Promise<RewardMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseRewardData.approveRewardRequest(redemptionId);

      if (result.ok && result.redemption) {
        this.upsertRewardRedemption(result.redemption);
      }

      return result;
    }

    this.replaceRewardRedemptions(
      this.rewardRedemptions().map((item) =>
        item.id === redemptionId && item.status === 'pending'
          ? {
              ...item,
              status: 'fulfilled',
              note: 'Reward approved by a parent and moved into the family plan.',
            }
          : item,
      ),
    );
    return { ok: true };
  }

  async declineRewardRequest(redemptionId: string): Promise<RewardMutationResult> {
    const redemption = this.rewardRedemptions().find((item) => item.id === redemptionId);

    if (!redemption || redemption.status !== 'pending') {
      return {
        ok: false,
        message: 'That reward request is no longer waiting for review.',
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseRewardData.declineRewardRequest(redemptionId);

      if (result.ok && result.redemption) {
        this.upsertRewardRedemption(result.redemption);
      }

      return result;
    }

    this.replaceRewardRedemptions(
      this.rewardRedemptions().map((item) =>
        item.id === redemptionId
          ? {
              ...item,
              status: 'declined',
              note: 'Reward request declined by a parent. Points returned to the child bank.',
            }
          : item,
      ),
    );
    return { ok: true };
  }

  async awardBonusPoints(childId: string, points: number, note: string): Promise<BonusMutationResult> {
    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseBonusData.awardBonusPoints(childId, points, note);

      if (result.ok) {
        this.adjustChildPoints(childId, points);

        if (result.bonusMoment) {
          this.upsertBonusMoment(result.bonusMoment);
        }

        void this.refreshFirebaseHouseholdChildren();
      }

      return result;
    }

    this.adjustChildPoints(childId, points);
    this._bonusMoments.update((moments) => [
      {
        id: createId('bonus'),
        childId,
        points,
        awardedAt: new Date().toISOString(),
        note,
      },
      ...moments,
    ]);
    return { ok: true };
  }

  async logGoalProgress(goalId: string, amount: number): Promise<GoalMutationResult> {
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        message: 'Choose a positive amount before logging goal progress.',
      };
    }

    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseGoalData.logGoalProgress(goalId, amount);

      if (result.ok && result.goal) {
        this.upsertGoal(result.goal);
      }

      return result;
    }

    this._goals.update((goals) =>
      goals.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              current: Math.min(goal.current + amount, goal.target),
            }
          : goal,
      ),
    );
    return { ok: true, source: 'local' };
  }

  async addGoal(draft: GoalDraft): Promise<GoalMutationResult> {
    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseGoalData.addGoal(draft);

      if (result.ok && result.goal) {
        this.upsertGoal(result.goal);
      }

      return result;
    }

    const normalizedDraft = normalizeGoalDraft(draft);

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'This goal is missing required details.',
      };
    }

    const goal: Goal = {
      id: createId('goal'),
      ...normalizedDraft,
    };

    this._goals.update((goals) => [
      goal,
      ...goals,
    ]);
    return { ok: true, goal, source: 'local' };
  }

  async updateGoal(goalId: string, draft: GoalDraft): Promise<GoalMutationResult> {
    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseGoalData.updateGoal(goalId, draft);

      if (result.ok && result.goal) {
        this.upsertGoal(result.goal);
      }

      return result;
    }

    const existing = this.goalById(goalId);
    const normalizedDraft = normalizeGoalDraft(draft);

    if (!existing || !normalizedDraft) {
      return {
        ok: false,
        message: 'This goal could not be saved.',
      };
    }

    this._goals.update((goals) =>
      goals.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              ...normalizedDraft,
            }
          : goal,
      ),
    );
    return {
      ok: true,
      goal: {
        ...existing,
        ...normalizedDraft,
      },
      source: 'local',
    };
  }

  async deleteGoal(goalId: string): Promise<GoalMutationResult> {
    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseGoalData.deleteGoal(goalId);

      if (result.ok) {
        this.removeGoal(goalId);
      }

      return result;
    }

    if (!this.goalById(goalId)) {
      return {
        ok: false,
        message: 'That goal no longer exists.',
      };
    }

    this._goals.update((goals) => goals.filter((goal) => goal.id !== goalId));
    return { ok: true, goalId, source: 'local' };
  }

  async saveJournalEntry(
    childId: string,
    draft: {
      accomplished: string;
      learned: string;
      proudOf: string;
    },
  ): Promise<JournalMutationResult> {
    const child = this.childById(childId);

    if (!child) {
      return {
        ok: false,
        message: 'That child profile could not be found for this journal entry.',
      };
    }

    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    const existing = this.getTodaysJournalEntry(childId);

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseJournalData.saveJournalEntry(childId, draft, existing);

      if (result.ok && result.entry) {
        this.upsertJournalEntry(result.entry);
      }

      return result;
    }

    const nextEntry: JournalEntry = {
      id: existing?.id ?? createId('journal'),
      childId,
      date: new Date().toISOString(),
      accomplished: draft.accomplished.trim(),
      learned: draft.learned.trim(),
      proudOf: draft.proudOf.trim(),
    };
    const contentChanged = !existing || hasJournalContentChanged(existing, nextEntry);
    const entryWithResponseState: JournalEntry = {
      ...nextEntry,
      parentReaction: contentChanged ? undefined : existing?.parentReaction,
      parentNote: contentChanged ? undefined : existing?.parentNote,
      needsParentResponse: contentChanged,
    };

    this.upsertJournalEntry(entryWithResponseState);
    return { ok: true, entry: entryWithResponseState, source: 'local' };
  }

  async respondToJournalEntry(
    entryId: string,
    response: {
      reaction: JournalReaction;
      note: string;
    },
  ): Promise<JournalMutationResult> {
    const note = response.note.trim();

    if (!note) {
      return {
        ok: false,
        message: 'Add a short encouraging note before sending a journal response.',
      };
    }

    const unavailableMessage = await this.firebaseHouseholdUnavailableMessage();

    if (unavailableMessage) {
      return {
        ok: false,
        message: unavailableMessage,
      };
    }

    if (this.shouldUseFirebaseHouseholdData()) {
      const result = await this.firebaseJournalData.respondToJournalEntry(entryId, response);

      if (result.ok && result.entry) {
        this.upsertJournalEntry(result.entry);
      }

      return result;
    }

    const existing = this.journalEntries().find((entry) => entry.id === entryId);

    if (!existing) {
      return {
        ok: false,
        message: 'That journal entry is no longer waiting for a parent response.',
      };
    }

    const nextEntry = {
      ...existing,
      parentReaction: response.reaction,
      parentNote: note,
      needsParentResponse: false,
    };

    this.upsertJournalEntry(nextEntry);
    return { ok: true, entry: nextEntry, source: 'local' };
  }

  private adjustChildPoints(childId: string, points: number) {
    this._baseChildren.update((children) =>
      children.map((child) =>
        child.id === childId
          ? {
              ...child,
              points: child.points + points,
            }
          : child,
      ),
    );
  }

  private updateViewer(nextViewer: ViewerSession) {
    const currentViewer = this.viewerSession();

    if (currentViewer.kind === nextViewer.kind && currentViewer.profileId === nextViewer.profileId) {
      return;
    }

    this._viewerSession.set(nextViewer);
  }

  private applyFirebaseViewerProfile(profile: AuthBootstrapProfile | null) {
    if (!profile) {
      this.updateViewer({
        kind: 'shared',
      });
      return;
    }

    if (profile.role === 'child') {
      if (profile.childId && this.childById(profile.childId)) {
        this.updateViewer({
          kind: 'child',
          profileId: profile.childId,
        });
        return;
      }

      this.updateViewer({
        kind: 'shared',
      });
      return;
    }

    this.updateViewer({
      kind: 'parent',
      profileId: this.parentProfile().id,
    });
  }

  private async syncFirebaseHouseholdState() {
    if (!this.firebaseAuth.firebaseEnabled || !this.firebaseAuth.authReady()) {
      return;
    }

    if (!this.firebaseAuth.isAuthenticated()) {
      this.restoreDefaultActiveMode();
      this.restoreSeedChildren();
      this.restoreSeedBonusData();
      this.restoreSeedGoalData();
      this.restoreSeedJournalData();
      this.restoreSeedPrivilegeData();
      this.restoreSeedQuestData();
      this.restoreSeedRewardData();
      this.firebaseBonusData.stopSync();
      this.firebaseGoalData.stopSync();
      this.firebaseHouseholdAccess.stopSync();
      this.firebaseHouseholdSettings.stopSync();
      this.firebaseJournalData.stopSync();
      this.firebasePrivilegeRules.stopSync();
      this.firebaseQuestData.stopSync();
      this.firebaseRewardData.stopSync();
      return;
    }

    if (!this.firebaseUserProfile.profileReady()) {
      return;
    }

    const profile = this.firebaseUserProfile.currentProfile();
    const loadToken = ++this.firebaseHouseholdSyncToken;

    if (profile?.source === 'authAccount' && profile.householdId) {
      this.firebaseHouseholdAccess.startSync(profile);
      this.firebaseHouseholdSettings.startSync(profile);
      this.firebaseBonusData.startSync(profile);
      this.firebaseGoalData.startSync(profile);
      this.firebaseJournalData.startSync(profile);
      this.firebasePrivilegeRules.startSync(profile);
      this.firebaseQuestData.startSync(profile);
      this.firebaseRewardData.startSync(profile);
      const children = await this.firebaseChildProfiles.loadAccessibleChildren(profile, this.activeModeId());

      if (loadToken !== this.firebaseHouseholdSyncToken) {
        return;
      }

      this.replaceChildren(children);
    } else {
      this.firebaseBonusData.stopSync();
      this.firebaseGoalData.stopSync();
      this.firebaseHouseholdAccess.stopSync();
      this.firebaseHouseholdSettings.stopSync();
      this.firebaseJournalData.stopSync();
      this.firebasePrivilegeRules.stopSync();
      this.firebaseQuestData.stopSync();
      this.firebaseRewardData.stopSync();
      this.restoreDefaultActiveMode();
      this.restoreSeedChildren();
      this.restoreSeedBonusData();
      this.restoreSeedGoalData();
      this.restoreSeedJournalData();
      this.restoreSeedPrivilegeData();
      this.restoreSeedQuestData();
      this.restoreSeedRewardData();
    }

    if (loadToken !== this.firebaseHouseholdSyncToken) {
      return;
    }

    this.applyFirebaseViewerProfile(profile);
  }

  private restoreViewerSession() {
    const storedSession = readStoredViewerSession();

    if (!storedSession) {
      return;
    }

    if (storedSession.kind === 'parent') {
      this._viewerSession.set({
        kind: 'parent',
        profileId: this.parentProfile().id,
      });
      return;
    }

    if (storedSession.kind === 'child' && storedSession.profileId && this.childById(storedSession.profileId)) {
      this._viewerSession.set(storedSession);
    }
  }

  private persistViewerSession(viewer: ViewerSession) {
    if (!supportsLocalStorage()) {
      return;
    }

    try {
      localStorage.setItem(VIEWER_SESSION_STORAGE_KEY, JSON.stringify(viewer));
    } catch {
      // Ignore storage failures so the prototype still works without persistence.
    }
  }

  private buildChildSummary(child: ChildProfile, modeId = this.activeModeId()): ChildDaySummary {
    const board = this.getQuestBoard(child.id, modeId);
    const mode = this.modeById(modeId);
    const required = board.filter((item) => item.countsTowardRequired);
    const screenTimeGate = board.filter((item) => item.countsTowardScreenTime);
    const completedRequired = required.filter((item) => item.status === 'approved').length;
    const remainingForScreenTime = screenTimeGate.filter((item) => item.status !== 'approved').length;
    const nextFocus =
      required.find((item) => item.status === 'open' || item.status === 'rejected')?.quest.title ??
      board.find((item) => item.status === 'open' || item.status === 'rejected')?.quest.title ??
      'You are all caught up.';

    return {
      child,
      completedRequired,
      totalRequired: required.length,
      pendingApprovals: board.filter((item) => item.status === 'pending').length,
      bonusCompleted: board.filter((item) => item.quest.category === 'bonus' && item.status === 'approved').length,
      pointsToday: this.pointsToday(child.id),
      screenTimeUnlocked: screenTimeGate.length > 0 && remainingForScreenTime === 0,
      remainingForScreenTime,
      momentumLabel:
        screenTimeGate.length === 0
          ? mode?.pauseStreaks
            ? 'This mode keeps expectations gentle. Streaks are paused and parent guidance leads the day.'
            : 'This mode uses a flexible screen-time plan with parent guidance.'
          : remainingForScreenTime === 0
            ? 'Screen time can unlock once a parent gives the green light.'
            : `${remainingForScreenTime} quests left before screen time.`,
      nextFocus,
    };
  }

  private findCompletion(questId: string, childId: string) {
    return this.completions().find(
      (completion) =>
        completion.questId === questId && completion.childId === childId && isSameDay(completion.completedAt, this.today),
    );
  }

  private pointsToday(childId: string) {
    const completionPoints = this.completions()
      .filter(
        (completion) =>
          completion.childId === childId &&
          isSameDay(completion.completedAt, this.today) &&
          (completion.status === 'approved' || completion.status === 'autoApproved'),
      )
      .reduce((sum, completion) => {
        const quest = this.questById(completion.questId);
        return sum + (quest?.points ?? 0);
      }, 0);

    const bonusPoints = this.bonusMoments()
      .filter((moment) => moment.childId === childId && isSameDay(moment.awardedAt, this.today))
      .reduce((sum, moment) => sum + moment.points, 0);

    return completionPoints + bonusPoints;
  }

  private pointsWithinDays(days: number) {
    const completionPoints = this.completions()
      .filter(
        (completion) =>
          daysBetween(completion.completedAt) < days &&
          (completion.status === 'approved' || completion.status === 'autoApproved'),
      )
      .reduce((sum, completion) => {
        const quest = this.questById(completion.questId);
        return sum + (quest?.points ?? 0);
      }, 0);

    const bonusPoints = this.bonusMoments()
      .filter((moment) => daysBetween(moment.awardedAt) < days)
      .reduce((sum, moment) => sum + moment.points, 0);

    return completionPoints + bonusPoints;
  }

  private restoreDefaultActiveMode() {
    this.applyActiveMode(DEFAULT_ACTIVE_MODE_ID);
  }

  private applyActiveMode(modeId: string) {
    this._activeModeId.set(modeId);
    this._baseChildren.update((children) => children.map((child) => ({ ...child, activeModeId: modeId })));
  }

  private restoreSeedChildren() {
    this._baseChildren.set(CHILD_PROFILES);
  }

  private restoreSeedBonusData() {
    this._bonusMoments.set(BONUS_MOMENTS);
  }

  private restoreSeedGoalData() {
    this._goals.set(GOALS);
  }

  private restoreSeedJournalData() {
    this._journalEntries.set(JOURNAL_ENTRIES);
  }

  private restoreSeedPrivilegeData() {
    this.replacePrivilegeRules(PRIVILEGE_RULES);
  }

  private restoreSeedQuestData() {
    this._quests.set(QUESTS);
    this._completions.set(SEED_COMPLETIONS);
  }

  private restoreSeedRewardData() {
    this.replaceRewardRedemptions(SEED_REWARD_REDEMPTIONS);
  }

  private replaceRewardRedemptions(redemptions: RewardRedemption[]) {
    const nextRedemptions = redemptions.slice().sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));

    this._rewardRedemptions.set(nextRedemptions);
  }

  private replacePrivilegeRules(rules: PrivilegeRule[]) {
    this._privilegeRules.set(rules.slice());
  }

  private upsertRewardRedemption(redemption: RewardRedemption) {
    this.replaceRewardRedemptions([
      redemption,
      ...untracked(() => this.rewardRedemptions()).filter((item) => item.id !== redemption.id),
    ]);
  }

  private upsertBonusMoment(moment: BonusMoment) {
    this._bonusMoments.update((moments) =>
      [moment, ...moments.filter((item) => item.id !== moment.id)].sort((left, right) =>
        right.awardedAt.localeCompare(left.awardedAt),
      ),
    );
  }

  private upsertGoal(goal: Goal) {
    this._goals.update((goals) => [goal, ...goals.filter((item) => item.id !== goal.id)]);
  }

  private upsertJournalEntry(entry: JournalEntry) {
    this._journalEntries.update((entries) =>
      [entry, ...entries.filter((item) => item.id !== entry.id)].sort((left, right) =>
        right.date.localeCompare(left.date),
      ),
    );
  }

  private removeGoal(goalId: string) {
    this._goals.update((goals) => goals.filter((goal) => goal.id !== goalId));
  }

  private baseChildById(childId: string) {
    return this._baseChildren().find((child) => child.id === childId);
  }

  private shouldUseFirebaseHouseholdData() {
    const profile = this.firebaseUserProfile.currentProfile();

    return Boolean(this.firebaseAuth.firebaseEnabled && profile?.source === 'authAccount' && profile.householdId);
  }

  private async firebaseHouseholdUnavailableMessage() {
    if (!this.firebaseAuth.firebaseEnabled || !this.firebaseAuth.isAuthenticated()) {
      return '';
    }

    await this.firebaseUserProfile.waitForProfileReady();

    const profile = this.firebaseUserProfile.currentProfile();

    if (profile?.source === 'authAccount' && profile.householdId) {
      return '';
    }

    if (!profile) {
      return (
        this.firebaseUserProfile.lastProfileError() ||
        'Firestore profile data is not ready for this signed-in account yet. Sign out and back in, then try again.'
      );
    }

    if (profile.source !== 'authAccount') {
      return 'This signed-in account is still using the legacy profile shape, so household data cannot sync to the Firestore household path yet.';
    }

    return 'This signed-in account is missing a household context, so household data cannot sync to Firestore yet.';
  }
}

function sortQuestBoardItems(left: QuestBoardItem, right: QuestBoardItem) {
  const leftWeight = questWeight(left);
  const rightWeight = questWeight(right);

  if (leftWeight !== rightWeight) {
    return leftWeight - rightWeight;
  }

  if (left.quest.points !== right.quest.points) {
    return right.quest.points - left.quest.points;
  }

  return left.quest.title.localeCompare(right.quest.title);
}

function questWeight(item: QuestBoardItem) {
  if (item.countsTowardScreenTime) {
    return 0;
  }

  if (item.countsTowardRequired) {
    return 1;
  }

  if (item.quest.category === 'bonus') {
    return 3;
  }

  return 2;
}

function mapStatus(status?: QuestCompletion['status']): QuestBoardStatus {
  if (!status) {
    return 'open';
  }

  if (status === 'approved' || status === 'autoApproved') {
    return 'approved';
  }

  if (status === 'pending') {
    return 'pending';
  }

  return 'rejected';
}

function describeQuestStatus(
  quest: Quest,
  completion: QuestCompletion | undefined,
  status: QuestBoardStatus,
  countsTowardRequired: boolean,
) {
  if (status === 'approved') {
    return `Banked +${quest.points} points.`;
  }

  if (status === 'pending') {
    return completion?.notes ?? 'Waiting for parent approval.';
  }

  if (status === 'rejected') {
    return completion?.notes ?? 'Give it one more pass.';
  }

  if (!countsTowardRequired && quest.category !== 'bonus') {
    return 'Live in this mode, but not part of today\'s must-do board.';
  }

  return quest.instructions || quest.description;
}

function hasJournalContentChanged(entry: JournalEntry, draft: Pick<JournalEntry, 'accomplished' | 'learned' | 'proudOf'>) {
  return entry.accomplished !== draft.accomplished || entry.learned !== draft.learned || entry.proudOf !== draft.proudOf;
}

function normalizeAccessCode(value: string) {
  return value.trim().toLowerCase();
}

function readStoredViewerSession(): ViewerSession | null {
  if (!supportsLocalStorage()) {
    return null;
  }

  try {
    const rawSession = localStorage.getItem(VIEWER_SESSION_STORAGE_KEY);

    if (!rawSession) {
      return null;
    }

    const parsed = JSON.parse(rawSession) as Partial<ViewerSession>;

    if (parsed.kind === 'parent') {
      return {
        kind: 'parent',
      };
    }

    if (parsed.kind === 'child' && typeof parsed.profileId === 'string' && parsed.profileId) {
      return {
        kind: 'child',
        profileId: parsed.profileId,
      };
    }

    if (parsed.kind === 'shared') {
      return {
        kind: 'shared',
      };
    }
  } catch {
    // Ignore malformed storage so the app can fall back to the shared access screen.
  }

  return null;
}

function supportsLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isSameDay(isoDate: string, expectedKey: string) {
  return formatDateKey(new Date(isoDate)) === expectedKey;
}

function daysBetween(isoDate: string) {
  const now = new Date();
  const then = new Date(isoDate);
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeGoalDraft(draft: GoalDraft) {
  const title = draft.title.trim();
  const unit = draft.unit.trim();
  const target = sanitizeNumber(draft.target);
  const current = sanitizeNumber(draft.current);
  const activeModes = Array.from(new Set(draft.activeModes.filter(Boolean)));

  if (!draft.childId || !title || !unit || target <= 0 || current < 0 || activeModes.length === 0) {
    return null;
  }

  return {
    childId: draft.childId,
    title,
    target,
    current: Math.min(current, target),
    unit,
    category: draft.category,
    activeModes,
  } satisfies GoalDraft;
}

function normalizePrivilegeRuleDraft(draft: PrivilegeRuleDraft) {
  const title = draft.title.trim();
  const requirements = Array.from(
    new Set(
      draft.requirements
        .map((requirement) => requirement.trim())
        .filter((requirement) => requirement.length > 0),
    ),
  );
  const activeModes = Array.from(new Set(draft.activeModes.filter(Boolean)));

  if (!title || requirements.length === 0 || activeModes.length === 0) {
    return null;
  }

  return {
    title,
    requirements,
    activeModes,
  } satisfies PrivilegeRuleDraft;
}

function normalizeQuestDraft(draft: QuestDraft) {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const instructions = draft.instructions.trim();
  const dueDate = draft.dueDate?.trim();
  const assignedTo = Array.from(new Set(draft.assignedTo.filter(Boolean)));
  const activeModes = Array.from(new Set(draft.activeModes.filter(Boolean)));
  const points = Math.max(1, sanitizeNumber(draft.points));

  if (!title || !description || !instructions || assignedTo.length === 0 || activeModes.length === 0) {
    return null;
  }

  return {
    title,
    description,
    category: draft.category,
    assignedTo,
    points,
    recurrence: draft.recurrence,
    requiresApproval: draft.requiresApproval,
    requiredBeforeScreenTime: draft.category === 'bonus' ? false : draft.requiredBeforeScreenTime,
    instructions,
    dueDate: dueDate ? dueDate : undefined,
    activeModes,
    difficulty: draft.difficulty,
  } satisfies QuestDraft;
}

function applyRewardRedemptionOffsetsToChildren(children: ChildProfile[], redemptions: RewardRedemption[]) {
  const reservedPointsByChild = rewardPointsReservedByChild(redemptions);

  return children.map((child) => ({
    ...child,
    points: Math.max(0, child.points - (reservedPointsByChild.get(child.id) ?? 0)),
  }));
}

function rewardPointsReservedByChild(redemptions: RewardRedemption[]) {
  const reservedByChild = new Map<string, number>();

  for (const redemption of redemptions) {
    if (redemption.status !== 'pending' && redemption.status !== 'fulfilled') {
      continue;
    }

    reservedByChild.set(redemption.childId, (reservedByChild.get(redemption.childId) ?? 0) + redemption.pointCost);
  }

  return reservedByChild;
}

function sanitizeNumber(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value);
}

function normalizeChildProfileDraft(draft: ChildProfileDraft) {
  const name = draft.name.trim();
  const avatar = draft.avatar.trim().slice(0, 3).toUpperCase();
  const themeColor = draft.themeColor.trim();
  const age = sanitizeNumber(draft.age);
  const level = Math.max(1, sanitizeNumber(draft.level));
  const points = Math.max(0, sanitizeNumber(draft.points));
  const streakDays = Math.max(0, sanitizeNumber(draft.streakDays));

  if (!name || !avatar || !themeColor || age < 1) {
    return null;
  }

  return {
    name,
    age,
    avatar,
    themeColor,
    level,
    points,
    streakDays,
    currentBook: normalizeOptionalText(draft.currentBook),
    currentLifeSkill: normalizeOptionalText(draft.currentLifeSkill),
    sportsGoal: normalizeOptionalText(draft.sportsGoal),
    yearGoal: normalizeOptionalText(draft.yearGoal),
  } satisfies ChildProfileDraft;
}

function normalizeOptionalText(value?: string) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function normalizeSeasonalModeDraft(draft: SeasonalModeDraft) {
  const description = draft.description.trim();
  const defaultScreenTimeRule = draft.defaultScreenTimeRule.trim();
  const requiredCategories = Array.from(new Set(draft.requiredCategories.filter(Boolean))).filter(
    (category) => category !== 'bonus',
  );
  const dailyMinimums = draft.dailyMinimums.map((minimum) => ({
    label: minimum.label.trim(),
    target: minimum.target.trim(),
  }));

  if (
    !description ||
    !defaultScreenTimeRule ||
    requiredCategories.length === 0 ||
    dailyMinimums.length === 0 ||
    dailyMinimums.some((minimum) => !minimum.label || !minimum.target)
  ) {
    return null;
  }

  return {
    description,
    intensity: draft.intensity,
    pauseStreaks: draft.pauseStreaks,
    requiredCategories,
    defaultScreenTimeRule,
    dailyMinimums,
  } satisfies SeasonalModeDraft;
}

const today = new Date();

const PARENT_PROFILE: UserProfile = {
  id: 'parent-hq',
  role: 'parent',
  displayName: 'Parent HQ',
  avatarUrl: 'PH',
  themeColor: '#1f7ac9',
};

function isoOffset(days: number, hour: number) {
  const copy = new Date(today);
  copy.setDate(copy.getDate() + days);
  copy.setHours(hour, 0, 0, 0);
  return copy.toISOString();
}

const CHILD_PROFILES: ChildProfile[] = [
  {
    id: 'ava',
    name: 'Ava',
    age: 12,
    avatar: 'AV',
    themeColor: '#ff7a59',
    level: 7,
    points: 320,
    streakDays: 9,
    activeModeId: 'school-year',
    currentBook: 'The Vanderbeekers',
    currentLifeSkill: 'Laundry start to finish',
    sportsGoal: '50 clean serves in a row',
    yearGoal: 'Finish 12 books',
  },
  {
    id: 'leo',
    name: 'Leo',
    age: 9,
    avatar: 'LE',
    themeColor: '#3ca6ff',
    level: 5,
    points: 245,
    streakDays: 6,
    activeModeId: 'school-year',
    currentBook: 'Dog Man',
    currentLifeSkill: 'Make a simple breakfast',
    sportsGoal: 'Bike 15 miles this month',
    yearGoal: 'Lead one family game night each week',
  },
];

const SEASONAL_MODES: SeasonalMode[] = [
  {
    id: 'school-year',
    name: 'School Year',
    description: 'Keep mornings calm, cover homework basics, and protect family reset time.',
    intensity: 'normal',
    pauseStreaks: false,
    requiredCategories: ['home', 'school', 'mind', 'body'],
    defaultScreenTimeRule: 'Required quests first, then screen time opens in the evening window.',
    dailyMinimums: [
      { label: 'Reading', target: '20 minutes' },
      { label: 'Movement', target: '30 minutes' },
      { label: 'Home reset', target: '2 quick wins' },
    ],
  },
  {
    id: 'summer-break',
    name: 'Summer Break',
    description: 'A bigger quest board with sunshine, skill-building, and boredom-buster bonus quests.',
    intensity: 'high',
    pauseStreaks: false,
    requiredCategories: ['home', 'mind', 'body', 'lifeSkill'],
    defaultScreenTimeRule: 'Morning responsibilities unlock afternoon screen time.',
    dailyMinimums: [
      { label: 'Reading', target: '30 minutes' },
      { label: 'Academics', target: '1 focus block' },
      { label: 'Outside time', target: '45 minutes' },
    ],
  },
  {
    id: 'weekend',
    name: 'Weekend Mode',
    description: 'Light structure, family fun, and a small launchpad before free time.',
    intensity: 'light',
    pauseStreaks: false,
    requiredCategories: ['home', 'body', 'family'],
    defaultScreenTimeRule: 'A short reset first, then flexible privileges with a good attitude.',
    dailyMinimums: [
      { label: 'Room reset', target: '10 minutes' },
      { label: 'Body', target: 'Move once' },
      { label: 'Family help', target: '1 team task' },
    ],
  },
  {
    id: 'minimum-day',
    name: 'Minimum Day',
    description: 'School gets out early, so expectations stay focused and realistic.',
    intensity: 'light',
    pauseStreaks: false,
    requiredCategories: ['home', 'school', 'body'],
    defaultScreenTimeRule: 'Homework and reset first, then recreation can open early.',
    dailyMinimums: [
      { label: 'Homework', target: 'Finish the list' },
      { label: 'Movement', target: '20 minutes' },
      { label: 'Quick tidy', target: '1 reset' },
    ],
  },
  {
    id: 'sick-day',
    name: 'Sick Day',
    description: 'Gentle expectations, comfort first, and no shame for slowing down.',
    intensity: 'light',
    pauseStreaks: true,
    requiredCategories: ['mind', 'family'],
    defaultScreenTimeRule: 'Comfort mode. Screen time is handled by parent override.',
    dailyMinimums: [
      { label: 'Hydrate', target: '3 check-ins' },
      { label: 'Rest', target: 'Parent-guided' },
      { label: 'Kindness', target: 'Stay respectful' },
    ],
  },
  {
    id: 'vacation',
    name: 'Vacation',
    description: 'Pause the grind, keep a small rhythm, and capture family memories.',
    intensity: 'light',
    pauseStreaks: true,
    requiredCategories: ['family', 'body'],
    defaultScreenTimeRule: 'Privileges flex around travel, connection, and rest.',
    dailyMinimums: [
      { label: 'Family help', target: '1 helpful act' },
      { label: 'Adventure', target: 'Move somewhere new' },
      { label: 'Memory', target: 'One journal line or photo' },
    ],
  },
  {
    id: 'spring-break',
    name: 'Spring Break',
    description: 'Short break energy with balanced learning, movement, and fun.',
    intensity: 'normal',
    pauseStreaks: false,
    requiredCategories: ['home', 'mind', 'body'],
    defaultScreenTimeRule: 'Core quests first, then bonus quests or screens.',
    dailyMinimums: [
      { label: 'Reading', target: '20 minutes' },
      { label: 'Outside', target: '30 minutes' },
      { label: 'Room reset', target: '1 pass' },
    ],
  },
  {
    id: 'fall-break',
    name: 'Fall Break',
    description: 'A reset rhythm with fresh air, family plans, and lighter structure.',
    intensity: 'light',
    pauseStreaks: false,
    requiredCategories: ['home', 'body', 'family'],
    defaultScreenTimeRule: 'Get the basics done before long screen stretches.',
    dailyMinimums: [
      { label: 'Outdoor time', target: '30 minutes' },
      { label: 'Family help', target: '1 task' },
      { label: 'Reading', target: '10 minutes' },
    ],
  },
  {
    id: 'thanksgiving-break',
    name: 'Thanksgiving Break',
    description: 'Keep kindness, helpfulness, and gratitude at the center.',
    intensity: 'light',
    pauseStreaks: true,
    requiredCategories: ['family', 'leadership', 'home'],
    defaultScreenTimeRule: 'Family contribution matters more than point chasing.',
    dailyMinimums: [
      { label: 'Help host', target: '1 meaningful assist' },
      { label: 'Gratitude', target: '1 reflection' },
      { label: 'Reset', target: '10 minutes' },
    ],
  },
  {
    id: 'christmas-break',
    name: 'Christmas Break',
    description: 'Festive rhythm with calm expectations and cozy routines.',
    intensity: 'light',
    pauseStreaks: true,
    requiredCategories: ['family', 'mind', 'home'],
    defaultScreenTimeRule: 'Connection first, then flexible free time.',
    dailyMinimums: [
      { label: 'Reading', target: '15 minutes' },
      { label: 'Room reset', target: 'One tidy burst' },
      { label: 'Family joy', target: 'One shared moment' },
    ],
  },
];

const QUESTS: Quest[] = [
  {
    id: 'quest-bed',
    title: 'Launch pad room reset',
    description: 'Make the bed, clear the floor, and get the room ready for a smooth day.',
    category: 'home',
    assignedTo: ['ava', 'leo'],
    points: 15,
    recurrence: 'daily',
    requiresApproval: true,
    requiredBeforeScreenTime: true,
    instructions: 'Bed made, dirty clothes in the hamper, and floor walkable.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'minimum-day', 'fall-break', 'spring-break'],
    difficulty: 'normal',
  },
  {
    id: 'quest-read',
    title: 'Reading power-up',
    description: 'Read from your current book and log a quick thought.',
    category: 'mind',
    assignedTo: ['ava', 'leo'],
    points: 20,
    recurrence: 'daily',
    requiresApproval: false,
    requiredBeforeScreenTime: true,
    instructions: 'Read first, then jot one sentence about the best part.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'minimum-day', 'spring-break', 'christmas-break'],
    difficulty: 'easy',
  },
  {
    id: 'quest-move',
    title: 'Body boost',
    description: 'Move on purpose with a walk, bike, drill, or backyard game.',
    category: 'body',
    assignedTo: ['ava', 'leo'],
    points: 20,
    recurrence: 'daily',
    requiresApproval: false,
    requiredBeforeScreenTime: true,
    instructions: 'Pick one active option and move for at least 30 minutes.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'minimum-day', 'vacation', 'fall-break', 'spring-break'],
    difficulty: 'normal',
  },
  {
    id: 'quest-homework',
    title: 'Homework checkpoint',
    description: 'Handle homework, paperwork, or backpack reset before the evening rush.',
    category: 'school',
    assignedTo: ['ava', 'leo'],
    points: 15,
    recurrence: 'daily',
    requiresApproval: true,
    requiredBeforeScreenTime: true,
    instructions: 'Finish the list, then place papers where parents can check them.',
    activeModes: ['school-year', 'minimum-day'],
    difficulty: 'normal',
  },
  {
    id: 'quest-volleyball',
    title: 'Volleyball serve streak',
    description: 'Build confidence with focused serve reps.',
    category: 'body',
    assignedTo: ['ava'],
    points: 25,
    recurrence: 'weekly',
    requiresApproval: false,
    requiredBeforeScreenTime: false,
    instructions: 'Fifty good serves or twenty minutes of passing drills.',
    activeModes: ['school-year', 'summer-break', 'weekend'],
    difficulty: 'hard',
  },
  {
    id: 'quest-breakfast',
    title: 'Kitchen leadership helper',
    description: 'Prep breakfast basics or lunch station for the next day.',
    category: 'leadership',
    assignedTo: ['ava', 'leo'],
    points: 18,
    recurrence: 'weekly',
    requiresApproval: true,
    requiredBeforeScreenTime: false,
    instructions: 'Pick one helpful kitchen task and finish it all the way.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'thanksgiving-break', 'christmas-break'],
    difficulty: 'normal',
  },
  {
    id: 'quest-laundry',
    title: 'Life skill lab: laundry',
    description: 'Move one load start to finish and put it away.',
    category: 'lifeSkill',
    assignedTo: ['ava'],
    points: 30,
    recurrence: 'weekly',
    requiresApproval: true,
    requiredBeforeScreenTime: false,
    instructions: 'Sort, wash, dry, fold, and put it away.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'vacation'],
    difficulty: 'boss',
  },
  {
    id: 'quest-family-reset',
    title: 'Family reset boss task',
    description: 'Help reset the main space so tomorrow starts calmer.',
    category: 'family',
    assignedTo: ['ava', 'leo'],
    points: 25,
    recurrence: 'daily',
    requiresApproval: true,
    requiredBeforeScreenTime: false,
    instructions: 'One room, one full reset: surfaces, pillows, and supplies back home.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'fall-break', 'spring-break', 'thanksgiving-break'],
    difficulty: 'boss',
  },
  {
    id: 'quest-bonus-journal',
    title: 'Win of the day journal sparkle',
    description: 'Capture one proud moment from today.',
    category: 'bonus',
    assignedTo: ['ava', 'leo'],
    points: 10,
    recurrence: 'daily',
    requiresApproval: false,
    requiredBeforeScreenTime: false,
    instructions: 'Answer one journal prompt and hit save.',
    activeModes: ['school-year', 'summer-break', 'weekend', 'vacation', 'spring-break', 'christmas-break'],
    difficulty: 'easy',
  },
];

const SEED_COMPLETIONS: QuestCompletion[] = [
  {
    id: 'completion-ava-read',
    questId: 'quest-read',
    childId: 'ava',
    completedAt: isoOffset(0, 8),
    status: 'autoApproved',
    approvedBy: 'Auto-approved',
    notes: 'Logged right after breakfast.',
  },
  {
    id: 'completion-ava-homework',
    questId: 'quest-homework',
    childId: 'ava',
    completedAt: isoOffset(0, 16),
    status: 'pending',
    notes: 'Math done. Backpack ready for check.',
  },
  {
    id: 'completion-leo-bed',
    questId: 'quest-bed',
    childId: 'leo',
    completedAt: isoOffset(0, 8),
    status: 'pending',
    notes: 'Room mostly reset and ready for a parent check.',
  },
  {
    id: 'completion-leo-move',
    questId: 'quest-move',
    childId: 'leo',
    completedAt: isoOffset(0, 15),
    status: 'autoApproved',
    approvedBy: 'Auto-approved',
    notes: 'Thirty minute bike ride complete.',
  },
  {
    id: 'completion-ava-prev',
    questId: 'quest-move',
    childId: 'ava',
    completedAt: isoOffset(-1, 17),
    status: 'autoApproved',
    approvedBy: 'Auto-approved',
    notes: 'Wall passing drill.',
  },
  {
    id: 'completion-ava-reset-prev',
    questId: 'quest-family-reset',
    childId: 'ava',
    completedAt: isoOffset(-2, 19),
    status: 'approved',
    approvedBy: 'Parent',
    notes: 'Living room reset looked great.',
  },
  {
    id: 'completion-leo-read-prev',
    questId: 'quest-read',
    childId: 'leo',
    completedAt: isoOffset(-1, 11),
    status: 'autoApproved',
    approvedBy: 'Auto-approved',
    notes: 'Read with a blanket fort.',
  },
];

const BONUS_MOMENTS: BonusMoment[] = [
  {
    id: 'bonus-ava-1',
    childId: 'ava',
    points: 10,
    awardedAt: isoOffset(-3, 18),
    note: 'Helped a sibling without being asked.',
  },
  {
    id: 'bonus-leo-1',
    childId: 'leo',
    points: 5,
    awardedAt: isoOffset(0, 18),
    note: 'Great attitude during a hard reset.',
  },
];

const SEED_REWARD_REDEMPTIONS: RewardRedemption[] = [];

const REWARDS: Reward[] = [
  {
    id: 'reward-dessert',
    title: 'Pick dessert night',
    pointCost: 80,
    type: 'choice',
    active: true,
    requiresParentApproval: true,
  },
  {
    id: 'reward-movie',
    title: 'Choose the family movie',
    pointCost: 100,
    type: 'choice',
    active: true,
    requiresParentApproval: false,
  },
  {
    id: 'reward-five',
    title: '$5 quest cash-out',
    pointCost: 150,
    type: 'money',
    active: true,
    requiresParentApproval: true,
  },
  {
    id: 'reward-outing',
    title: 'Mini shopping trip',
    pointCost: 220,
    type: 'outing',
    active: true,
    requiresParentApproval: true,
  },
  {
    id: 'reward-one-on-one',
    title: 'One-on-one parent time',
    pointCost: 140,
    type: 'outing',
    active: true,
    requiresParentApproval: false,
  },
];

const PRIVILEGE_RULES: PrivilegeRule[] = [
  {
    id: 'priv-screen',
    title: 'Screen time unlock',
    type: 'screenTime',
    requirements: ['Required quests complete', 'Respectful attitude', 'Parent sign-off when needed'],
    activeModes: ['school-year', 'summer-break', 'weekend', 'minimum-day', 'vacation'],
  },
  {
    id: 'priv-friends',
    title: 'Friend hangouts',
    type: 'friends',
    requirements: ['Responsibilities current', 'Kind attitude', 'Family plans checked first'],
    activeModes: ['school-year', 'summer-break', 'weekend', 'vacation'],
  },
  {
    id: 'priv-sleepover',
    title: 'Sleepovers',
    type: 'sleepover',
    requirements: ['Strong overall week', 'Room reset current', 'Parent approval'],
    activeModes: ['summer-break', 'weekend', 'vacation'],
  },
  {
    id: 'priv-games',
    title: 'Video games',
    type: 'videoGames',
    requirements: ['Core quests done', 'No pending redo tasks'],
    activeModes: ['school-year', 'weekend', 'minimum-day', 'summer-break'],
  },
];

const GOALS: Goal[] = [
  {
    id: 'goal-ava-books',
    childId: 'ava',
    title: 'Books read this year',
    current: 8,
    target: 12,
    unit: 'books',
    category: 'mind',
    activeModes: ['school-year', 'summer-break', 'christmas-break'],
  },
  {
    id: 'goal-ava-serves',
    childId: 'ava',
    title: 'Volleyball serve reps',
    current: 340,
    target: 500,
    unit: 'serves',
    category: 'body',
    activeModes: ['school-year', 'summer-break', 'weekend'],
  },
  {
    id: 'goal-leo-bike',
    childId: 'leo',
    title: 'Miles biked this month',
    current: 9,
    target: 15,
    unit: 'miles',
    category: 'body',
    activeModes: ['school-year', 'summer-break', 'weekend'],
  },
  {
    id: 'goal-leo-leadership',
    childId: 'leo',
    title: 'Leadership challenges',
    current: 3,
    target: 5,
    unit: 'wins',
    category: 'leadership',
    activeModes: ['school-year', 'summer-break', 'weekend'],
  },
];

const JOURNAL_ENTRIES: JournalEntry[] = [
  {
    id: 'journal-ava',
    childId: 'ava',
    date: isoOffset(0, 20),
    accomplished: 'I finished my reading before dinner and helped reset the kitchen.',
    learned: 'It is easier to stay calm when I do the hard thing first.',
    proudOf: 'I practiced serves even though I wanted to skip.',
    parentReaction: 'Star',
    parentNote: 'Strong follow-through today.',
    needsParentResponse: false,
  },
  {
    id: 'journal-leo',
    childId: 'leo',
    date: isoOffset(-1, 20),
    accomplished: 'I biked farther than last time.',
    learned: 'If I start cleaning with music it goes faster.',
    proudOf: 'I helped without arguing.',
    needsParentResponse: true,
  },
];
