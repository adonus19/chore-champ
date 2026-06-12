import { computed, Component, effect, inject, signal } from '@angular/core';
import { FormField, form, minLength, required, submit, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import {
  ChildDaySummary,
  ChildProfile,
  PrivilegeRule,
  PrivilegeRuleDraft,
  PrivilegeType,
  SeasonalMode,
} from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-privileges-page',
  imports: [FormField, RouterLink],
  templateUrl: './privileges-page.html',
  styleUrl: './privileges-page.scss',
})
export class PrivilegesPage {
  private readonly familyData = inject(MockFamilyData);

  readonly TYPE_META = TYPE_META;
  readonly seasonalModes = this.familyData.seasonalModes;
  readonly activeMode = this.familyData.activeMode;
  readonly children = this.familyData.children;
  readonly currentScreenTimeRule = this.familyData.currentScreenTimeRule;
  readonly privilegeRulesSyncError = this.familyData.privilegeRulesSyncError;
  readonly selectedRuleId = signal(this.familyData.currentScreenTimeRule()?.id ?? this.familyData.privilegeRules()[0]?.id ?? '');
  readonly selectedRule = computed(
    () =>
      this.familyData.privilegeRules().find((rule) => rule.id === this.selectedRuleId()) ??
      this.familyData.currentScreenTimeRule() ??
      this.familyData.privilegeRules()[0] ??
      null,
  );
  readonly selectedRuleMeta = computed(() => TYPE_META[this.selectedRule()?.type ?? 'screenTime']);
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly pendingRuleId = signal('');
  readonly privilegeRuleModel = signal(this.createPrivilegeRuleFormModel(this.selectedRule()));
  readonly privilegeRuleForm = form(this.privilegeRuleModel, (path) => {
    required(path.title, { message: 'Add a short title for this privilege rule.' });
    minLength(path.title, 3, { message: 'Use at least 3 characters so the rule reads clearly.' });

    required(path.requirementLines, { message: 'Add at least one requirement line.' });
    validate(path.requirementLines, ({ value }) =>
      parseRequirements(value()).length > 0
        ? undefined
        : { kind: 'required', message: 'Add at least one requirement line.' },
    );

    validate(path.requirementLines, ({ value }) =>
      parseRequirements(value()).every((requirement) => requirement.length >= 3)
        ? undefined
        : { kind: 'length', message: 'Each requirement should be a short, complete phrase.' },
    );

    validate(path.activeModes, ({ value }) =>
      value().some(Boolean) ? undefined : { kind: 'required', message: 'Choose at least one seasonal mode.' },
    );
  });
  readonly editorDirty = computed(() => {
    const selectedRule = this.selectedRule();

    return selectedRule
      ? serializePrivilegeRuleFormModel(this.privilegeRuleModel()) !==
          serializePrivilegeRuleFormModel(this.createPrivilegeRuleFormModel(selectedRule))
      : false;
  });
  readonly quickStats = computed(() => {
    const activeMode = this.activeMode();
    const liveRules = this.familyData.privilegeRules().filter((rule) => rule.activeModes.includes(activeMode.id));
    const readyCount = this.familyData.childSummaries().filter((summary) => summary.screenTimeUnlocked).length;

    return [
      {
        label: 'Current mode',
        value: activeMode.name,
        hint: 'The family rhythm currently shaping quest expectations',
      },
      {
        label: 'Screen gate',
        value: this.currentScreenTimeRule() ? 'Quest gated' : 'Parent flex',
        hint: 'Whether the current mode uses the standard screen-time rule',
      },
      {
        label: 'Ready for screens',
        value: `${readyCount}/${this.children().length}`,
        hint: 'Children who have already cleared today’s gate',
      },
      {
        label: 'Live privileges',
        value: liveRules.length.toString(),
        hint: 'Privilege rules active in this mode right now',
      },
    ];
  });
  readonly ruleCards = computed(() => {
    const activeModeId = this.activeMode().id;

    return this.familyData.privilegeRules().map((rule) => ({
      rule,
      meta: TYPE_META[rule.type],
      isSelected: rule.id === this.selectedRule()?.id,
      activeInCurrentMode: rule.activeModes.includes(activeModeId),
      activeModeCount: rule.activeModes.length,
      requirementCount: rule.requirements.length,
    }));
  });
  readonly childGatePreviews = computed(() =>
    this.children().map((child) => {
      const summary = this.familyData.getChildSummary(child.id, this.activeMode().id);

      if (!summary) {
        return null;
      }

      return buildChildGatePreview(child, summary, this.currentScreenTimeRule() !== null);
    }).filter((preview): preview is NonNullable<typeof preview> => preview !== null),
  );

  constructor() {
    effect(() => {
      this.privilegeRuleModel.set(this.createPrivilegeRuleFormModel(this.selectedRule()));
    });
  }

  previewRule(ruleId: string) {
    this.selectedRuleId.set(ruleId);
    this.actionFeedback.set(null);
  }

  saveRuleChanges() {
    submit(this.privilegeRuleForm, async () => {
      const selectedRule = this.selectedRule();

      if (!selectedRule) {
        return;
      }

      const draft = this.buildPrivilegeRuleDraft();
      this.actionFeedback.set(null);
      this.pendingRuleId.set(selectedRule.id);
      const result = await this.familyData.updatePrivilegeRule(selectedRule.id, draft);
      this.pendingRuleId.set('');

      if (!result.ok) {
        this.actionFeedback.set({
          kind: 'error',
          text: result.message ?? 'That privilege rule could not be saved right now. Try again in a moment.',
        });
        return;
      }

      this.actionFeedback.set({
        kind: 'success',
        text:
          result.source === 'firebase'
            ? `${draft.title} now syncs through this household's shared privilege settings.`
            : `${draft.title} is now updated in the local demo privilege library.`,
      });
    });
  }

  resetRuleEditor() {
    const selectedRule = this.selectedRule();

    if (!selectedRule) {
      return;
    }

    this.privilegeRuleModel.set(this.createPrivilegeRuleFormModel(selectedRule));
    this.actionFeedback.set(null);
  }

  modeTrackBy(index: number, mode: SeasonalMode) {
    return `${index}-${mode.id}`;
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  private buildPrivilegeRuleDraft(): PrivilegeRuleDraft {
    const value = this.privilegeRuleForm().value();

    return {
      title: value.title.trim(),
      requirements: parseRequirements(value.requirementLines),
      activeModes: this.seasonalModes()
        .filter((_, index) => value.activeModes[index])
        .map((mode) => mode.id),
    };
  }

  private createPrivilegeRuleFormModel(rule: PrivilegeRule | null) {
    return {
      title: rule?.title ?? '',
      requirementLines: rule?.requirements.join('\n') ?? '',
      activeModes: this.seasonalModes().map((mode) => (rule ? rule.activeModes.includes(mode.id) : false)),
    };
  }
}

function parseRequirements(lines: string) {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function serializePrivilegeRuleFormModel(model: {
  title: string;
  requirementLines: string;
  activeModes: boolean[];
}) {
  return JSON.stringify({
    title: model.title.trim(),
    requirementLines: parseRequirements(model.requirementLines),
    activeModes: model.activeModes,
  });
}

function buildChildGatePreview(child: ChildProfile, summary: ChildDaySummary, usesScreenGate: boolean) {
  if (!usesScreenGate) {
    return {
      child,
      summary,
      statusLabel: 'Parent flex',
      statusClass: 'flex',
      message: 'This mode leaves screen-time timing in parent hands, so the app stays supportive and light.',
    };
  }

  if (summary.screenTimeUnlocked) {
    return {
      child,
      summary,
      statusLabel: 'Ready now',
      statusClass: 'ready',
      message: 'Required quests are current, so the gate is open once the family is good to go.',
    };
  }

  if (summary.pendingApprovals > 0 && summary.remainingForScreenTime === 0) {
    return {
      child,
      summary,
      statusLabel: 'Awaiting check',
      statusClass: 'pending',
      message: 'Everything required is turned in. A quick parent review is the last step.',
    };
  }

  return {
    child,
    summary,
    statusLabel: `${summary.remainingForScreenTime} left`,
    statusClass: 'progress',
    message: summary.momentumLabel,
  };
}

const TYPE_META: Record<
  PrivilegeType,
  {
    label: string;
    hint: string;
    accent: string;
  }
> = {
  screenTime: {
    label: 'Screen time',
    hint: 'Keep this tied to responsibilities, respectful attitude, and the family’s real rhythm instead of raw point spending.',
    accent: '#74c7ff',
  },
  friends: {
    label: 'Friend visits',
    hint: 'Friend time stays a normal privilege that depends on family readiness, not on buying it with points.',
    accent: '#ff7b59',
  },
  sleepover: {
    label: 'Sleepovers',
    hint: 'Sleepovers should reflect the bigger weekly picture: follow-through, respect, and family plans lining up well.',
    accent: '#b39dff',
  },
  videoGames: {
    label: 'Video games',
    hint: 'Game access should stay clear and consistent so kids know the gate without turning the whole app punitive.',
    accent: '#8ce8c8',
  },
  youtube: {
    label: 'YouTube',
    hint: 'Keep video access expectations specific enough that parents can stay aligned when the day gets messy.',
    accent: '#ffd86b',
  },
};
