import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormField, form, minLength, required, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import {
  ModeIntensity,
  PrivilegeRule,
  QuestCategory,
  SeasonalMode,
  SeasonalModeDraft,
} from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';
import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';
import { InfoTooltip } from '../../../shared/ui/info-tooltip/info-tooltip';

@Component({
  selector: 'app-seasonal-modes-page',
  imports: [FormField, RouterLink, InfoTooltip],
  templateUrl: './seasonal-modes-page.html',
  styleUrl: './seasonal-modes-page.scss',
})
export class SeasonalModesPage {
  private readonly familyData = inject(MockFamilyData);

  readonly INTENSITY_OPTIONS = INTENSITY_OPTIONS;
  readonly CATEGORY_TOGGLE_OPTIONS = CATEGORY_TOGGLE_OPTIONS;
  readonly CATEGORY_LABELS = CATEGORY_LABELS;
  readonly activeMode = this.familyData.activeMode;
  readonly seasonalModes = this.familyData.seasonalModes;
  readonly selectedModeId = signal('');
  readonly selectedMode = computed(
    () => this.seasonalModes().find((mode) => mode.id === this.selectedModeId()) ?? this.activeMode(),
  );
  readonly lastSavedModeName = signal('');
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingActiveModeId = signal('');
  readonly seasonalModeModel = signal(this.createModeFormModel(this.selectedMode()));
  readonly seasonalModeForm = form(this.seasonalModeModel, (path) => {
    required(path.description, { message: 'Add a short description for this seasonal rhythm.' });
    minLength(path.description, 12, { message: 'Add a little more detail so the mode feels clear.' });

    required(path.defaultScreenTimeRule, { message: 'Add the screen-time guidance for this mode.' });
    minLength(path.defaultScreenTimeRule, 12, {
      message: 'Write a fuller sentence so the screen-time rhythm is easy to understand.',
    });

    validate(path.requiredCategories, ({ value }) =>
      value().some(Boolean)
        ? undefined
        : { kind: 'required', message: 'Choose at least one required track for this mode.' },
    );

    validate(path.dailyMinimums, ({ value }) =>
      value().every((minimum) => minimum.label.trim().length >= 2 && minimum.target.trim().length >= 2)
        ? undefined
        : { kind: 'required', message: 'Each daily minimum needs both a label and a target.' },
    );
  });
  readonly editorDirty = computed(
    () => serializeModeFormModel(this.seasonalModeModel()) !== serializeModeFormModel(this.createModeFormModel(this.selectedMode())),
  );
  readonly modeCards = computed(() =>
    this.seasonalModes().map((mode) => {
      const modeQuests = this.familyData.quests().filter((quest) => quest.activeModes.includes(mode.id));

      return {
        mode,
        isActive: mode.id === this.activeMode().id,
        isSelected: mode.id === this.selectedMode().id,
        requiredQuestCount: modeQuests.filter((quest) => mode.requiredCategories.includes(quest.category)).length,
        screenTimeQuestCount: modeQuests.filter(
          (quest) => quest.requiredBeforeScreenTime && mode.requiredCategories.includes(quest.category),
        ).length,
        liveQuestCount: modeQuests.length,
      };
    }),
  );
  readonly vm = computed(() => {
    const mode = this.selectedMode();
    const screenTimeRule = this.familyData
      .privilegeRules()
      .find((rule) => rule.type === 'screenTime' && rule.activeModes.includes(mode.id));
    const privilegeRules = this.familyData
      .privilegeRules()
      .filter((rule) => rule.type !== 'screenTime' && rule.activeModes.includes(mode.id));
    const modeQuests = this.familyData.quests().filter((quest) => quest.activeModes.includes(mode.id));
    const requiredQuestCount = modeQuests.filter((quest) => mode.requiredCategories.includes(quest.category)).length;
    const optionalQuestCount = modeQuests.filter(
      (quest) => quest.category !== 'bonus' && !mode.requiredCategories.includes(quest.category),
    ).length;

    return {
      mode,
      screenTimeRule,
      privilegeRules,
      childPreviews: this.familyData
        .children()
        .map((child) => buildChildPreview(this.familyData, child.id, mode))
        .filter((preview): preview is NonNullable<typeof preview> => preview !== null),
      questMix: CATEGORY_ORDER.map((category) => {
        const matchingQuests = modeQuests.filter((quest) => quest.category === category);
        const required = mode.requiredCategories.includes(category);

        if (matchingQuests.length === 0 && !required) {
          return null;
        }

        return {
          category,
          label: CATEGORY_LABELS[category],
          questCount: matchingQuests.length,
          required,
          screenTimeCount: matchingQuests.filter(
            (quest) => quest.requiredBeforeScreenTime && mode.requiredCategories.includes(category),
          ).length,
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null),
      heroMessage: buildModeHeroMessage(mode, mode.id === this.activeMode().id),
      requiredCategoryLabels: mode.requiredCategories.map((category) => CATEGORY_LABELS[category]),
      stats: [
        {
          label: 'Mode Intensity',
          value: INTENSITY_LABELS[mode.intensity],
          hint: 'How heavy the family rhythm feels in this season',
        },
        {
          label: 'Required Tracks',
          value: mode.requiredCategories.length.toString(),
          hint: "Categories that count as today's must-do board",
        },
        {
          label: 'Live Quests',
          value: requiredQuestCount.toString(),
          hint: `${optionalQuestCount} extra quest${optionalQuestCount === 1 ? '' : 's'} stay available without being required`,
        },
        {
          label: 'Streak Policy',
          value: mode.pauseStreaks ? 'Paused' : 'Running',
          hint: mode.pauseStreaks
            ? 'Recovery and travel modes do not punish the streak'
            : 'Consistency still counts in this mode',
        },
      ],
    };
  });

  constructor() {
    effect(() => {
      this.seasonalModeModel.set(this.createModeFormModel(this.selectedMode()));
    });
  }

  previewMode(modeId: string) {
    this.selectedModeId.set(modeId);
    this.lastSavedModeName.set('');
    this.actionFeedback.set(null);
  }

  async activateSelectedMode() {
    const modeId = this.selectedMode().id;
    const modeName = this.selectedMode().name;
    this.actionFeedback.set(null);
    this.pendingActiveModeId.set(modeId);
    const result = await this.familyData.switchMode(modeId);
    this.pendingActiveModeId.set('');

    if (!result.ok) {
      this.actionFeedback.set({
        kind: 'error',
        text: result.message ?? 'That seasonal mode could not be made live right now. Try again in a moment.',
      });
      return;
    }

    this.selectedModeId.set(modeId);
    this.actionFeedback.set({
      kind: 'success',
      text: `${modeName} is now live for this household.`,
    });
  }

  saveModeChanges(submitEvent?: Event) {
    submitWithValidationFocus(this.seasonalModeForm, submitEvent, async () => {
      const mode = this.selectedMode();
      this.familyData.updateSeasonalMode(mode.id, this.buildSeasonalModeDraft());
      this.lastSavedModeName.set(mode.name);
    });
  }

  resetModeEditor() {
    this.seasonalModeModel.set(this.createModeFormModel(this.selectedMode()));
  }

  privilegeTypeLabel(rule: PrivilegeRule) {
    return PRIVILEGE_TYPE_LABELS[rule.type];
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  categoryTrackBy(index: number, category: { value: QuestCategory }) {
    return `${index}-${category.value}`;
  }

  private buildSeasonalModeDraft(): SeasonalModeDraft {
    const value = this.seasonalModeForm().value();

    return {
      description: value.description.trim(),
      intensity: value.intensity,
      pauseStreaks: value.pauseStreaks,
      requiredCategories: CATEGORY_TOGGLE_OPTIONS.filter((_, index) => value.requiredCategories[index]).map(
        (option) => option.value,
      ),
      defaultScreenTimeRule: value.defaultScreenTimeRule.trim(),
      dailyMinimums: value.dailyMinimums.map((minimum) => ({
        label: minimum.label.trim(),
        target: minimum.target.trim(),
      })),
    };
  }

  private createModeFormModel(mode: SeasonalMode) {
    return {
      description: mode.description,
      intensity: mode.intensity,
      pauseStreaks: mode.pauseStreaks,
      requiredCategories: CATEGORY_TOGGLE_OPTIONS.map((option) => mode.requiredCategories.includes(option.value)),
      defaultScreenTimeRule: mode.defaultScreenTimeRule,
      dailyMinimums: mode.dailyMinimums.map((minimum) => ({
        label: minimum.label,
        target: minimum.target,
      })),
    };
  }
}

function buildChildPreview(familyData: MockFamilyData, childId: string, mode: SeasonalMode) {
  const child = familyData.childById(childId);
  const summary = familyData.getChildSummary(childId, mode.id);

  if (!child || !summary) {
    return null;
  }

  const board = familyData.getQuestBoard(childId, mode.id);
  const requiredCount = board.filter((item) => item.countsTowardRequired).length;
  const optionalCount = board.filter((item) => !item.countsTowardRequired).length;
  const screenTimeCount = board.filter((item) => item.countsTowardScreenTime).length;
  const trackLabels = Array.from(
    new Set(
      board
        .filter((item) => item.countsTowardRequired)
        .map((item) => CATEGORY_LABELS[item.quest.category]),
    ),
  );

  return {
    child,
    summary,
    requiredCount,
    optionalCount,
    screenTimeCount,
    trackLabels,
    modeMessage: buildChildModeMessage(mode.name, summary.remainingForScreenTime, screenTimeCount, optionalCount),
  };
}

function buildModeHeroMessage(mode: SeasonalMode, isActive: boolean) {
  if (isActive) {
    return `${mode.name} is currently live. This preview shows what counts as must-do, what stays flexible, and how the screen-time gate shifts in this rhythm.`;
  }

  if (mode.pauseStreaks) {
    return `${mode.name} softens the board. Streaks pause, parent flexibility rises, and the app should feel supportive instead of demanding.`;
  }

  if (mode.intensity === 'high') {
    return `${mode.name} expands the board with more growth tracks while still keeping the rules understandable for kids.`;
  }

  return `${mode.name} changes the shape of the day before you make it live, so you can check the must-do load before switching the family over.`;
}

function buildChildModeMessage(
  modeName: string,
  remainingForScreenTime: number,
  screenTimeCount: number,
  optionalCount: number,
) {
  if (screenTimeCount === 0) {
    return `${modeName} uses a lighter, parent-guided screen-time rhythm for this child.`;
  }

  if (remainingForScreenTime === 0) {
    return 'This preview would leave the screen-time gate fully clear once required quests are approved.';
  }

  if (optionalCount > 0) {
    return `${remainingForScreenTime} quest${remainingForScreenTime === 1 ? '' : 's'} would still gate screen time, with ${optionalCount} extra track${optionalCount === 1 ? '' : 's'} available on the side.`;
  }

  return `${remainingForScreenTime} quest${remainingForScreenTime === 1 ? '' : 's'} would still gate screen time in this mode.`;
}

function serializeModeFormModel(model: ReturnType<SeasonalModesPage['createModeFormModel']>) {
  return JSON.stringify(model);
}

const CATEGORY_ORDER: QuestCategory[] = [
  'home',
  'school',
  'mind',
  'body',
  'lifeSkill',
  'leadership',
  'family',
  'bonus',
];

const CATEGORY_TOGGLE_OPTIONS: Array<{ value: QuestCategory; label: string; hint: string }> = [
  { value: 'home', label: 'Home', hint: 'Daily resets, room care, and family basics.' },
  { value: 'school', label: 'School', hint: 'Homework, backpacks, and school follow-through.' },
  { value: 'mind', label: 'Mind', hint: 'Reading, academics, and learning momentum.' },
  { value: 'body', label: 'Body', hint: 'Movement, sports practice, and energy outlets.' },
  { value: 'lifeSkill', label: 'Life Skill', hint: 'Independence builders like laundry, meals, or packing.' },
  { value: 'leadership', label: 'Leadership', hint: 'Helping well, leading well, and noticing others.' },
  { value: 'family', label: 'Family', hint: 'Shared contribution and team wins.' },
];

const CATEGORY_LABELS: Record<QuestCategory, string> = {
  home: 'Home',
  school: 'School',
  mind: 'Mind',
  body: 'Body',
  lifeSkill: 'Life Skill',
  leadership: 'Leadership',
  family: 'Family',
  bonus: 'Bonus',
};

const INTENSITY_OPTIONS: Array<{ value: ModeIntensity; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
];

const INTENSITY_LABELS: Record<ModeIntensity, string> = {
  light: 'Light',
  normal: 'Normal',
  high: 'High',
};

const PRIVILEGE_TYPE_LABELS: Record<PrivilegeRule['type'], string> = {
  screenTime: 'Screen time rhythm',
  friends: 'Friend hangout expectation',
  sleepover: 'Sleepover expectation',
  videoGames: 'Video game expectation',
  youtube: 'YouTube expectation',
};
