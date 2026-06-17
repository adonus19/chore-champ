export type UserRole = 'parent' | 'child';
export type QuestCategory =
  | 'home'
  | 'mind'
  | 'body'
  | 'leadership'
  | 'lifeSkill'
  | 'bonus'
  | 'school'
  | 'family';
export type QuestRecurrence = 'once' | 'daily' | 'weekly' | 'custom';
export type QuestDifficulty = 'easy' | 'normal' | 'hard' | 'boss';
export type CompletionStatus = 'pending' | 'approved' | 'rejected' | 'autoApproved';
export type RewardType = 'money' | 'outing' | 'choice' | 'custom';
export type RewardRedemptionStatus = 'pending' | 'fulfilled' | 'declined';
export type PrivilegeType = 'screenTime' | 'friends' | 'sleepover' | 'videoGames' | 'youtube';
export type ModeIntensity = 'light' | 'normal' | 'high';
export type QuestBoardStatus = 'open' | 'pending' | 'approved' | 'rejected';
export type JournalReaction = 'Heart' | 'Star';
export type ViewerKind = 'shared' | 'parent' | 'child';
export type HouseholdSwitchPolicy = 'parentOnly' | 'childAllowed' | 'childRequest';

export interface UserProfile {
  id: string;
  role: UserRole;
  displayName: string;
  avatarUrl: string;
  themeColor: string;
}

export type BootstrapProfileSource = 'authAccount' | 'legacyUserProfile';

export interface AuthBootstrapProfile {
  uid: string;
  personId: string;
  role: UserRole;
  displayName: string;
  householdId: string | null;
  defaultHouseholdId: string | null;
  lastActiveHouseholdId: string | null;
  source: BootstrapProfileSource;
  childId?: string;
  avatarUrl?: string;
  themeColor?: string;
  mustChangePassword?: boolean;
}

export interface ViewerSession {
  kind: ViewerKind;
  profileId?: string;
}

export interface ViewerBadge {
  label: string;
  helper: string;
  themeColor: string;
}

export interface ChildProfile {
  id: string;
  name: string;
  age: number;
  avatar: string;
  themeColor: string;
  level: number;
  points: number;
  streakDays: number;
  activeModeId: string;
  currentBook?: string;
  currentLifeSkill?: string;
  sportsGoal?: string;
  yearGoal?: string;
  login?: {
    enabled: boolean;
    authUid?: string;
    usernameNormalized?: string;
    usernameDisplay?: string;
    householdSwitchPolicy?: HouseholdSwitchPolicy;
    mustChangePassword?: boolean;
  };
}

export interface ChildProfileDraft {
  name: string;
  age: number;
  avatar: string;
  themeColor: string;
  level: number;
  points: number;
  streakDays: number;
  currentBook?: string;
  currentLifeSkill?: string;
  sportsGoal?: string;
  yearGoal?: string;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  category: QuestCategory;
  assignedTo: string[];
  points: number;
  recurrence: QuestRecurrence;
  requiresApproval: boolean;
  requiredBeforeScreenTime: boolean;
  instructions: string;
  dueDate?: string;
  activeModes: string[];
  difficulty: QuestDifficulty;
}

export interface QuestCompletion {
  id: string;
  questId: string;
  childId: string;
  completedAt: string;
  status: CompletionStatus;
  approvedBy?: string;
  proofUrl?: string;
  notes?: string;
}

export interface Reward {
  id: string;
  title: string;
  pointCost: number;
  type: RewardType;
  active: boolean;
  requiresParentApproval: boolean;
}

export interface RewardRedemption {
  id: string;
  rewardId: string;
  childId: string;
  requestedAt: string;
  status: RewardRedemptionStatus;
  pointCost: number;
  note?: string;
}

export interface PrivilegeRule {
  id: string;
  title: string;
  type: PrivilegeType;
  requirements: string[];
  activeModes: string[];
}

export interface PrivilegeRuleDraft {
  title: string;
  requirements: string[];
  activeModes: string[];
}

export interface DailyMinimum {
  label: string;
  target: string;
}

export interface SeasonalMode {
  id: string;
  name: string;
  description: string;
  intensity: ModeIntensity;
  pauseStreaks: boolean;
  requiredCategories: QuestCategory[];
  defaultScreenTimeRule: string;
  dailyMinimums: DailyMinimum[];
}

export interface SeasonalModeDraft {
  description: string;
  intensity: ModeIntensity;
  pauseStreaks: boolean;
  requiredCategories: QuestCategory[];
  defaultScreenTimeRule: string;
  dailyMinimums: DailyMinimum[];
}

export interface JournalEntry {
  id: string;
  childId: string;
  date: string;
  accomplished: string;
  learned: string;
  proudOf: string;
  parentReaction?: JournalReaction;
  parentNote?: string;
  needsParentResponse?: boolean;
}

export interface Goal {
  id: string;
  childId: string;
  title: string;
  target: number;
  current: number;
  unit: string;
  category: QuestCategory;
  activeModes: string[];
}

export interface GoalDraft {
  childId: string;
  title: string;
  target: number;
  current: number;
  unit: string;
  category: QuestCategory;
  activeModes: string[];
}

export interface BonusMoment {
  id: string;
  childId: string;
  points: number;
  awardedAt: string;
  note: string;
}

export interface QuestDraft {
  title: string;
  description: string;
  category: QuestCategory;
  assignedTo: string[];
  points: number;
  recurrence: QuestRecurrence;
  requiresApproval: boolean;
  requiredBeforeScreenTime: boolean;
  instructions: string;
  dueDate?: string;
  activeModes: string[];
  difficulty: QuestDifficulty;
}

export interface QuestBoardItem {
  child: ChildProfile;
  quest: Quest;
  status: QuestBoardStatus;
  note: string;
  pointsEarned: number;
  countsTowardRequired: boolean;
  countsTowardScreenTime: boolean;
}

export interface ChildDaySummary {
  child: ChildProfile;
  completedRequired: number;
  totalRequired: number;
  pendingApprovals: number;
  bonusCompleted: number;
  pointsToday: number;
  screenTimeUnlocked: boolean;
  remainingForScreenTime: number;
  momentumLabel: string;
  nextFocus: string;
}

export interface ApprovalItem {
  completion: QuestCompletion;
  child: ChildProfile;
  quest: Quest;
}

export interface RewardRequestItem {
  redemption: RewardRedemption;
  child: ChildProfile;
  reward: Reward;
}

export interface JournalReviewItem {
  entry: JournalEntry;
  child: ChildProfile;
}

export interface FamilySnapshot {
  currentMode: SeasonalMode;
  totalPoints: number;
  weeklyPoints: number;
  familyStreak: number;
  childrenReadyForScreenTime: number;
  pendingApprovals: number;
}

export interface GoalSpotlight {
  child: ChildProfile;
  goal: Goal;
  progress: number;
  remaining: number;
}
