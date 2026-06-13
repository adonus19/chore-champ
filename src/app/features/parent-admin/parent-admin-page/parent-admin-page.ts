import { computed, Component, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  FormField,
  form,
  min,
  minLength,
  required,
  validate,
} from '@angular/forms/signals';

import {
  ApprovalItem,
  ChildProfile,
  Quest,
  QuestBoardStatus,
  QuestCategory,
  QuestDifficulty,
  QuestDraft,
  QuestRecurrence,
  RewardRequestItem,
  RewardType,
  SeasonalMode,
} from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';
import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';

@Component({
  selector: 'app-parent-admin-page',
  imports: [FormField, RouterLink],
  templateUrl: './parent-admin-page.html',
  styleUrl: './parent-admin-page.scss',
})
export class ParentAdminPage {
  private readonly familyData = inject(MockFamilyData);
  readonly questEditorPanel = viewChild<ElementRef<HTMLElement>>('questEditorPanel');

  readonly QUEST_CATEGORY_OPTIONS = QUEST_CATEGORY_OPTIONS;
  readonly RECURRENCE_OPTIONS = RECURRENCE_OPTIONS;
  readonly DIFFICULTY_OPTIONS = DIFFICULTY_OPTIONS;
  readonly QUEST_PRESET_OPTIONS = QUEST_PRESET_OPTIONS;
  readonly CATEGORY_LABELS = CATEGORY_LABELS;
  readonly RECURRENCE_LABELS = RECURRENCE_LABELS;
  readonly DIFFICULTY_LABELS = DIFFICULTY_LABELS;
  readonly REWARD_TYPE_LABELS = REWARD_TYPE_LABELS;
  readonly children = this.familyData.children;
  readonly seasonalModes = this.familyData.seasonalModes;
  readonly activeMode = this.familyData.activeMode;
  // Children plus, for a real signed-in parent, a "Myself" assignee so quests can be assigned to the parent.
  readonly assignableTargets = computed(() => this.buildAssignableTargets());
  readonly usesParentSelfBoard = this.familyData.usesParentSelfBoard;
  readonly currentParentDisplayName = this.familyData.currentParentDisplayName;
  readonly pendingApprovals = this.familyData.pendingApprovals;
  readonly pendingRewardRequests = this.familyData.pendingRewardRequests;
  readonly editingQuestId = signal('');
  readonly selectedQuestPresetId = signal<QuestPresetId>('custom');
  readonly lastSavedQuest = signal<{ action: 'created' | 'updated' | 'deleted'; title: string } | null>(null);
  readonly lastBonusAward = signal<{ childName: string; points: number; note: string } | null>(null);
  readonly lastOverrideAction = signal<{ childName: string; questTitle: string; statusLabel: string } | null>(null);
  readonly rewardFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingRewardRequestId = signal('');
  readonly actionError = signal('');
  readonly questModel = signal(this.createQuestFormModel());
  readonly bonusModel = signal(this.createBonusFormModel());
  readonly selectedOverrideChildId = signal(this.children()[0]?.id ?? '');
  readonly questForm = form(this.questModel, (path) => {
    required(path.title, { message: 'Give this quest a short title.' });
    minLength(path.title, 3, { message: 'Use at least 3 characters for the title.' });

    required(path.description, { message: 'Add a quick quest description.' });
    minLength(path.description, 12, {
      message: 'Add a little more detail so kids know what the quest is asking for.',
    });

    required(path.instructions, { message: 'Add a simple finish line for this quest.' });
    minLength(path.instructions, 8, { message: 'Instructions should be a little more specific.' });

    min(path.points, 1, { message: 'Choose at least 1 point.' });

    validate(path.points, ({ value }) =>
      Number.isInteger(value()) ? undefined : { kind: 'wholeNumber', message: 'Use a whole number for points.' },
    );

    validate(path.assignees, ({ value }) =>
      value().some(Boolean) ? undefined : { kind: 'required', message: 'Choose at least one child.' },
    );

    validate(path.activeModes, ({ value }) =>
      value().some(Boolean) ? undefined : { kind: 'required', message: 'Choose at least one seasonal mode.' },
    );
  });
  readonly bonusForm = form(this.bonusModel, (path) => {
    required(path.childId, { message: 'Choose which child gets the bonus points.' });
    min(path.points, 1, { message: 'Award at least 1 bonus point.' });

    validate(path.points, ({ value }) =>
      Number.isInteger(value()) ? undefined : { kind: 'wholeNumber', message: 'Use a whole number for bonus points.' },
    );

    required(path.note, { message: 'Add a quick note so the bonus has context.' });
    minLength(path.note, 4, { message: 'Use a short phrase that explains the win.' });
  });
  readonly editingQuest = computed(() => this.familyData.questById(this.editingQuestId()) ?? null);
  readonly overrideChild = computed(
    () => this.familyData.childById(this.selectedOverrideChildId()) ?? this.children()[0] ?? null,
  );
  readonly bonusQuestSelected = computed(() => this.questModel().category === 'bonus');
  readonly selectedCategory = computed(
    () => this.QUEST_CATEGORY_OPTIONS.find((option) => option.value === this.questModel().category) ?? this.QUEST_CATEGORY_OPTIONS[0],
  );
  readonly questLibrary = computed(() => {
    const targetNames = new Map(this.assignableTargets().map((target) => [target.id, target.name]));
    const modeNames = new Map(this.seasonalModes().map((mode) => [mode.id, mode.name]));

    return this.familyData
      .quests()
      .map((quest) => ({
        quest,
        assigneeNames: quest.assignedTo.map((personId) => targetNames.get(personId) ?? personId),
        modeNames: quest.activeModes.map((modeId) => modeNames.get(modeId) ?? modeId),
        liveInCurrentMode: quest.activeModes.includes(this.activeMode().id),
      }));
  });
  readonly approvalQueue = computed(() =>
    this.pendingApprovals().map((item) => {
      const summary = this.familyData.getChildSummary(item.child.id);
      const remainingBeforeApproval = summary?.remainingForScreenTime ?? 0;
      const unlocksScreenTime = item.quest.requiredBeforeScreenTime && remainingBeforeApproval === 1;
      const remainingAfterApproval = item.quest.requiredBeforeScreenTime
        ? Math.max(remainingBeforeApproval - 1, 0)
        : remainingBeforeApproval;

      return {
        ...item,
        completedLabel: formatClockTime(item.completion.completedAt),
        unlocksScreenTime,
        impactLabel: buildImpactLabel(item, unlocksScreenTime, remainingAfterApproval),
      };
    }),
  );
  readonly approvalGroups = computed(() =>
    this.children()
      .map((child) => {
        const items = this.approvalQueue().filter((item) => item.child.id === child.id);

        if (items.length === 0) {
          return null;
        }

        return {
          child,
          items,
          totalPoints: items.reduce((sum, item) => sum + item.quest.points, 0),
          unlockCount: items.filter((item) => item.unlocksScreenTime).length,
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null),
  );
  readonly approvalHighlights = computed(() => {
    const queue = this.approvalQueue();
    const kidsWaiting = new Set(queue.map((item) => item.child.id)).size;
    const pointsWaiting = queue.reduce((sum, item) => sum + item.quest.points, 0);

    return [
      {
        label: 'Waiting now',
        value: queue.length.toString(),
      },
      {
        label: 'Points at stake',
        value: pointsWaiting.toString(),
      },
      {
        label: 'Can unlock screens',
        value: queue.filter((item) => item.unlocksScreenTime).length.toString(),
      },
      {
        label: 'Kids waiting',
        value: kidsWaiting.toString(),
      },
    ];
  });
  readonly rewardRequestQueue = computed(() =>
    this.pendingRewardRequests().map((item) => ({
      ...item,
      requestedLabel: formatClockTime(item.redemption.requestedAt),
      impactLabel: buildRewardImpactLabel(item),
    })),
  );
  readonly rewardRequestGroups = computed(() =>
    this.children()
      .map((child) => {
        const items = this.rewardRequestQueue().filter((item) => item.child.id === child.id);

        if (items.length === 0) {
          return null;
        }

        return {
          child,
          items,
          reservedPoints: items.reduce((sum, item) => sum + item.redemption.pointCost, 0),
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null),
  );
  readonly rewardRequestHighlights = computed(() => {
    const queue = this.rewardRequestQueue();
    const kidsWaiting = new Set(queue.map((item) => item.child.id)).size;
    const reservedPoints = queue.reduce((sum, item) => sum + item.redemption.pointCost, 0);

    return [
      {
        label: 'Requests waiting',
        value: queue.length.toString(),
      },
      {
        label: 'Points reserved',
        value: reservedPoints.toString(),
      },
      {
        label: 'Kids waiting',
        value: kidsWaiting.toString(),
      },
    ];
  });
  readonly totalPendingReviews = computed(
    () => this.pendingApprovals().length + this.pendingRewardRequests().length,
  );
  readonly overrideBoard = computed(() => {
    const child = this.overrideChild();

    if (!child) {
      return null;
    }

    const summary = this.familyData.getChildSummary(child.id);
    const board = this.familyData.getQuestBoard(child.id);
    const recentBonusMoments = this.familyData
      .bonusMoments()
      .filter((moment) => moment.childId === child.id)
      .slice()
      .sort((left, right) => right.awardedAt.localeCompare(left.awardedAt))
      .slice(0, 3)
      .map((moment) => ({
        moment,
        awardedLabel: formatClockTime(moment.awardedAt),
      }));

    if (!summary) {
      return null;
    }

    return {
      child,
      summary,
      recentBonusMoments,
      items: board.map((item) => ({
        ...item,
        statusLabel: QUEST_OVERRIDE_STATUS_LABELS[item.status],
        canApprove: item.status !== 'approved',
        canPending: item.status !== 'pending',
        canReject: item.status !== 'rejected',
        canClear: item.status !== 'open',
      })),
    };
  });

  readonly quickStats = computed(() => [
    {
      label: 'Quest Library',
      value: this.familyData.quests().length.toString(),
      hint: 'Quests available in the current household board',
    },
    {
      label: 'Children',
      value: this.children().length.toString(),
      hint: 'Parents can assign one quest to one or many kids',
    },
    {
      label: 'Seasonal Modes',
      value: this.seasonalModes().length.toString(),
      hint: `Current rhythm: ${this.activeMode().name}`,
    },
    {
      label: 'Pending Reviews',
      value: this.totalPendingReviews().toString(),
      hint: 'Quest checks and reward requests stay together so the parent flow stays in one place',
    },
  ]);

  constructor() {
    effect(() => {
      const firstChildId = this.children()[0]?.id ?? '';

      if (!this.selectedOverrideChildId() && firstChildId) {
        this.selectedOverrideChildId.set(firstChildId);
      }

      if (!this.bonusModel().childId && firstChildId) {
        this.bonusModel.update((model) => ({
          ...model,
          childId: firstChildId,
        }));
      }
    });
  }

  onSubmit(submitEvent?: Event) {
    submitWithValidationFocus(this.questForm, submitEvent, async () => {
      const draft = this.buildQuestDraft();
      const editingQuestId = this.editingQuestId();
      this.actionError.set('');
      this.lastSavedQuest.set(null);

      if (editingQuestId) {
        const result = await this.familyData.updateQuest(editingQuestId, draft);

        if (!result.ok) {
          this.actionError.set(result.message ?? 'The quest could not be saved right now.');
          return;
        }

        this.lastSavedQuest.set({
          action: 'updated',
          title: draft.title,
        });
      } else {
        const result = await this.familyData.addQuest(draft);

        if (!result.ok) {
          this.actionError.set(result.message ?? 'The quest could not be saved right now.');
          return;
        }

        this.lastSavedQuest.set({
          action: 'created',
          title: draft.title,
        });
      }

      this.cancelEdit();
    });
  }

  awardBonusPoints(submitEvent?: Event) {
    submitWithValidationFocus(this.bonusForm, submitEvent, async () => {
      const value = this.bonusForm().value();
      const child = this.familyData.childById(value.childId);
      const note = value.note.trim();
      const points = Math.round(value.points);

      if (!child) {
        return;
      }

      this.actionError.set('');
      this.lastBonusAward.set(null);
      const result = await this.familyData.awardBonusPoints(child.id, points, note);

      if (!result.ok) {
        this.actionError.set(result.message ?? 'The bonus points could not be awarded right now.');
        return;
      }

      this.lastBonusAward.set({
        childName: child.name,
        points,
        note,
      });
      this.bonusModel.set(this.createBonusFormModel(child.id));
      this.selectedOverrideChildId.set(child.id);
    });
  }

  startEdit(questId: string) {
    const quest = this.familyData.questById(questId);

    if (!quest) {
      return;
    }

    this.editingQuestId.set(questId);
    this.selectedQuestPresetId.set('custom');
    this.lastSavedQuest.set(null);
    this.actionError.set('');
    this.questModel.set(this.createQuestFormModel(quest));
    this.scrollQuestEditorIntoView();
  }

  cancelEdit() {
    this.editingQuestId.set('');
    this.selectedQuestPresetId.set('custom');
    this.actionError.set('');
    this.questModel.set(this.createQuestFormModel());
  }

  async deleteEditingQuest() {
    const quest = this.editingQuest();

    if (!quest) {
      return;
    }

    this.actionError.set('');
    this.lastSavedQuest.set(null);
    const result = await this.familyData.deleteQuest(quest.id);

    if (!result.ok) {
      this.actionError.set(result.message ?? 'The quest could not be deleted right now.');
      return;
    }

    this.lastSavedQuest.set({
      action: 'deleted',
      title: quest.title,
    });
    this.cancelEdit();
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  async approveCompletion(completionId: string) {
    this.actionError.set('');
    const result = await this.familyData.approveCompletion(completionId);

    if (!result.ok) {
      this.actionError.set(result.message ?? 'That approval could not be completed right now.');
    }
  }

  async rejectCompletion(completionId: string) {
    this.actionError.set('');
    const result = await this.familyData.rejectCompletion(completionId);

    if (!result.ok) {
      this.actionError.set(result.message ?? 'That retry action could not be completed right now.');
    }
  }

  async approveRewardRequest(redemptionId: string) {
    const item = this.pendingRewardRequests().find((entry) => entry.redemption.id === redemptionId);
    this.rewardFeedback.set(null);
    this.pendingRewardRequestId.set(redemptionId);
    const result = await this.familyData.approveRewardRequest(redemptionId);
    this.pendingRewardRequestId.set('');

    if (!result.ok) {
      this.rewardFeedback.set({
        kind: 'error',
        text: result.message ?? 'That reward approval could not be saved right now.',
      });
      return;
    }

    this.rewardFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s "${item.reward.title}" is approved and synced.`
        : 'That reward approval is synced.',
    });
  }

  async declineRewardRequest(redemptionId: string) {
    const item = this.pendingRewardRequests().find((entry) => entry.redemption.id === redemptionId);
    this.rewardFeedback.set(null);
    this.pendingRewardRequestId.set(redemptionId);
    const result = await this.familyData.declineRewardRequest(redemptionId);
    this.pendingRewardRequestId.set('');

    if (!result.ok) {
      this.rewardFeedback.set({
        kind: 'error',
        text: result.message ?? 'That reward decline could not be saved right now.',
      });
      return;
    }

    this.rewardFeedback.set({
      kind: 'success',
      text: item
        ? `${item.child.name}'s "${item.reward.title}" was declined and those points are available again.`
        : 'That reward request was declined and the points are available again.',
    });
  }

  selectOverrideChild(childId: string) {
    this.selectedOverrideChildId.set(childId);
  }

  async overrideQuestStatus(childId: string, questId: string, status: QuestBoardStatus) {
    const child = this.familyData.childById(childId);
    const quest = this.familyData.questById(questId);

    if (!child || !quest) {
      return;
    }

    this.actionError.set('');
    this.lastOverrideAction.set(null);
    const result = await this.familyData.overrideQuestStatus(questId, childId, status);

    if (!result.ok) {
      this.actionError.set(result.message ?? 'The quest override could not be saved right now.');
      return;
    }

    this.lastOverrideAction.set({
      childName: child.name,
      questTitle: quest.title,
      statusLabel: QUEST_OVERRIDE_ACTION_LABELS[status],
    });
  }

  childTrackBy(index: number, child: ChildProfile) {
    return `${index}-${child.id}`;
  }

  modeTrackBy(index: number, mode: SeasonalMode) {
    return `${index}-${mode.id}`;
  }

  applyQuestPreset(presetId: string) {
    this.selectedQuestPresetId.set(isQuestPresetId(presetId) ? presetId : 'custom');

    if (!isQuestPresetId(presetId) || presetId === 'custom') {
      return;
    }

    const preset = QUEST_PRESET_MAP[presetId];

    this.questModel.update((model) => ({
      ...model,
      title: preset.title,
      description: preset.description,
      category: preset.category,
      points: preset.points,
      recurrence: preset.recurrence,
      difficulty: preset.difficulty,
      instructions: preset.instructions,
      requiresApproval: preset.requiresApproval,
      requiredBeforeScreenTime: preset.requiredBeforeScreenTime,
    }));
    this.actionError.set('');
  }

  private buildAssignableTargets() {
    const targets = this.familyData.children().map((child) => ({ id: child.id, name: child.name }));
    const personId = this.familyData.currentParentPersonId();

    if (personId) {
      targets.push({ id: personId, name: `Myself (${this.familyData.currentParentDisplayName()})` });
    }

    return targets;
  }

  private buildQuestDraft(): QuestDraft {
    const value = this.questForm().value();
    const assignedTo = this.buildAssignableTargets()
      .filter((_, index) => value.assignees[index])
      .map((target) => target.id);
    const activeModes = this.seasonalModes()
      .filter((_, index) => value.activeModes[index])
      .map((mode) => mode.id);

    return {
      title: value.title.trim(),
      description: value.description.trim(),
      category: value.category,
      assignedTo,
      points: Math.round(value.points),
      recurrence: value.recurrence,
      requiresApproval: value.requiresApproval,
      requiredBeforeScreenTime: value.category === 'bonus' ? false : value.requiredBeforeScreenTime,
      instructions: value.instructions.trim(),
      dueDate: value.dueDate || undefined,
      activeModes,
      difficulty: value.difficulty,
    };
  }

  private createQuestFormModel(quest?: Quest) {
    return {
      title: quest?.title ?? '',
      description: quest?.description ?? '',
      category: quest?.category ?? ('home' as QuestCategory),
      points: quest?.points ?? 15,
      recurrence: quest?.recurrence ?? ('daily' as QuestRecurrence),
      difficulty: quest?.difficulty ?? ('normal' as QuestDifficulty),
      instructions: quest?.instructions ?? '',
      dueDate: quest?.dueDate ?? '',
      requiresApproval: quest?.requiresApproval ?? true,
      requiredBeforeScreenTime: quest?.requiredBeforeScreenTime ?? true,
      assignees: this.buildAssignableTargets().map((target) => (quest ? quest.assignedTo.includes(target.id) : false)),
      activeModes: this.seasonalModes().map((mode) =>
        quest ? quest.activeModes.includes(mode.id) : mode.id === this.familyData.activeModeId(),
      ),
    };
  }

  private createBonusFormModel(childId = this.children()[0]?.id ?? '') {
    return {
      childId,
      points: 10,
      note: '',
    };
  }

  private scrollQuestEditorIntoView() {
    this.questEditorPanel()?.nativeElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }
}

function buildImpactLabel(item: ApprovalItem, unlocksScreenTime: boolean, remainingAfterApproval: number) {
  if (item.quest.requiredBeforeScreenTime) {
    if (unlocksScreenTime) {
      return 'Approving this clears the last screen-time gate for today.';
    }

    return `${remainingAfterApproval} screen-time quest${remainingAfterApproval === 1 ? '' : 's'} would still remain after approval.`;
  }

  return 'This one adds points and momentum without changing the screen-time gate.';
}

function formatClockTime(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoDate));
}

function buildRewardImpactLabel(item: RewardRequestItem) {
  if (item.reward.requiresParentApproval) {
    return 'Approving keeps the points spent and confirms the reward is officially on the family plan.';
  }

  return 'This reward should normally auto-complete, but this review keeps the mock flow visible while we tune the store.';
}

const QUEST_CATEGORY_OPTIONS: Array<{ value: QuestCategory; label: string; hint: string }> = [
  { value: 'home', label: 'Home', hint: 'Reset spaces and daily responsibilities.' },
  { value: 'mind', label: 'Mind', hint: 'Reading, academics, and learning momentum.' },
  { value: 'body', label: 'Body', hint: 'Movement, sports practice, and energy outlets.' },
  { value: 'leadership', label: 'Leadership', hint: 'Helping, organizing, and leading well.' },
  { value: 'lifeSkill', label: 'Life Skill', hint: 'Real-world independence practice.' },
  { value: 'school', label: 'School', hint: 'Homework and school-year follow-through.' },
  { value: 'family', label: 'Family', hint: 'Shared reset tasks and team wins.' },
  { value: 'bonus', label: 'Bonus', hint: 'Extra sparkle without gating privileges.' },
];

const RECURRENCE_OPTIONS: Array<{ value: QuestRecurrence; label: string }> = [
  { value: 'once', label: 'One-time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom rhythm' },
];

const DIFFICULTY_OPTIONS: Array<{ value: QuestDifficulty; label: string }> = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
  { value: 'boss', label: 'Boss' },
];

type QuestPresetId =
  | 'custom'
  | 'laundry'
  | 'dishwasher'
  | 'vacuum'
  | 'bedroom'
  | 'trash'
  | 'petCare'
  | 'kitchenReset';

interface QuestPreset {
  title: string;
  description: string;
  category: QuestCategory;
  points: number;
  recurrence: QuestRecurrence;
  difficulty: QuestDifficulty;
  instructions: string;
  requiresApproval: boolean;
  requiredBeforeScreenTime: boolean;
}

const QUEST_PRESET_OPTIONS: Array<{ value: QuestPresetId; label: string }> = [
  { value: 'custom', label: 'Custom quest' },
  { value: 'laundry', label: 'Do the laundry' },
  { value: 'dishwasher', label: 'Empty the dishwasher' },
  { value: 'vacuum', label: 'Vacuum the main room' },
  { value: 'bedroom', label: 'Clean bedroom' },
  { value: 'trash', label: 'Take out trash & recycling' },
  { value: 'petCare', label: 'Feed or care for the pet' },
  { value: 'kitchenReset', label: 'Wipe counters & reset kitchen' },
];

const QUEST_PRESET_MAP: Record<Exclude<QuestPresetId, 'custom'>, QuestPreset> = {
  laundry: {
    title: 'Laundry reset',
    description: 'Wash, dry, fold, and put away one full load of laundry.',
    category: 'lifeSkill',
    points: 20,
    recurrence: 'weekly',
    difficulty: 'normal',
    instructions: 'Clothes are folded, sorted, and fully put away where they belong.',
    requiresApproval: true,
    requiredBeforeScreenTime: false,
  },
  dishwasher: {
    title: 'Empty the dishwasher',
    description: 'Unload the clean dishes and return everything to the right cabinets.',
    category: 'home',
    points: 10,
    recurrence: 'daily',
    difficulty: 'easy',
    instructions: 'Top and bottom racks are empty and the kitchen is reset when you finish.',
    requiresApproval: true,
    requiredBeforeScreenTime: true,
  },
  vacuum: {
    title: 'Vacuum the main room',
    description: 'Vacuum the shared living area and leave the floor clear and fresh.',
    category: 'home',
    points: 15,
    recurrence: 'weekly',
    difficulty: 'normal',
    instructions: 'Floors are vacuumed edge to edge and the vacuum is put back neatly.',
    requiresApproval: true,
    requiredBeforeScreenTime: false,
  },
  bedroom: {
    title: 'Clean bedroom',
    description: 'Reset the bedroom so the floor, bed, and surfaces all feel calm again.',
    category: 'home',
    points: 15,
    recurrence: 'daily',
    difficulty: 'normal',
    instructions: 'Bed is made, floor is clear, and anything out of place is put away.',
    requiresApproval: true,
    requiredBeforeScreenTime: true,
  },
  trash: {
    title: 'Take out trash and recycling',
    description: 'Empty the bins and replace liners so the house is ready for the next round.',
    category: 'family',
    points: 10,
    recurrence: 'weekly',
    difficulty: 'easy',
    instructions: 'Trash and recycling are taken out fully and new liners are in place afterward.',
    requiresApproval: true,
    requiredBeforeScreenTime: false,
  },
  petCare: {
    title: 'Feed and care for the pet',
    description: 'Handle the feeding routine and make sure the pet basics are covered.',
    category: 'family',
    points: 10,
    recurrence: 'daily',
    difficulty: 'easy',
    instructions: 'Food or water is refreshed and the pet area is left tidy when you finish.',
    requiresApproval: true,
    requiredBeforeScreenTime: true,
  },
  kitchenReset: {
    title: 'Kitchen counter reset',
    description: 'Wipe counters and clear the kitchen so the next meal starts with a clean slate.',
    category: 'home',
    points: 10,
    recurrence: 'daily',
    difficulty: 'easy',
    instructions: 'Counters are wiped, stray dishes are handled, and the room feels reset.',
    requiresApproval: true,
    requiredBeforeScreenTime: true,
  },
};

function isQuestPresetId(value: string): value is QuestPresetId {
  return QUEST_PRESET_OPTIONS.some((option) => option.value === value);
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

const RECURRENCE_LABELS: Record<QuestRecurrence, string> = {
  once: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  custom: 'Custom rhythm',
};

const DIFFICULTY_LABELS: Record<QuestDifficulty, string> = {
  easy: 'Easy quest',
  normal: 'Steady quest',
  hard: 'Challenge quest',
  boss: 'Boss quest',
};

const REWARD_TYPE_LABELS: Record<RewardType, string> = {
  money: 'Money',
  outing: 'Outing',
  choice: 'Choice',
  custom: 'Custom',
};

const QUEST_OVERRIDE_STATUS_LABELS: Record<QuestBoardStatus, string> = {
  open: 'Open',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Needs another pass',
};

const QUEST_OVERRIDE_ACTION_LABELS: Record<QuestBoardStatus, string> = {
  open: 'Cleared for today',
  pending: 'Moved to pending review',
  approved: 'Approved by parent',
  rejected: 'Sent back for another pass',
};
