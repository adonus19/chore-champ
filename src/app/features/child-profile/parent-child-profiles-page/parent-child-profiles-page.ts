import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, form, min, minLength, pattern, required, validate } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';

import { ChildProfile, ChildProfileDraft, HouseholdSwitchPolicy } from '../../../core/models/family.models';
import {
  FirebaseChildHouseholdLinksService,
  normalizeChildLinkCode,
} from '../../../core/services/firebase-child-household-links.service';
import { FirebaseChildProfilesService } from '../../../core/services/firebase-child-profiles.service';
import { FirebaseHouseholdParentsService } from '../../../core/services/firebase-household-parents.service';
import { FirebaseUserProfileService } from '../../../core/services/firebase-user-profile.service';
import { childUsernameHelpText, normalizeChildUsername, suggestChildUsername } from '../../../core/utils/child-login';
import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';
import { generateTempPassword } from '../../../core/utils/temp-password';
import { MockFamilyData } from '../../../core/services/mock-family-data';

type ProfileKind = 'child' | 'parent';

// Prototype-only convenience for same-device testing. Remove before release so shared-child acceptance
// always starts empty and requires the receiving parent to paste the code manually.
const LATEST_CHILD_LINK_STORAGE_KEY = 'chore-champ.latest-child-link';

interface LatestChildLink {
  childId: string;
  childName: string;
  code: string;
  expiresAtLabel: string;
}

@Component({
  selector: 'app-parent-child-profiles-page',
  imports: [FormField, RouterLink],
  templateUrl: './parent-child-profiles-page.html',
  styleUrl: './parent-child-profiles-page.scss',
})
export class ParentChildProfilesPage {
  private readonly firebaseChildHouseholdLinks = inject(FirebaseChildHouseholdLinksService);
  private readonly familyData = inject(MockFamilyData);
  private readonly firebaseChildProfiles = inject(FirebaseChildProfilesService);
  private readonly firebaseHouseholdParents = inject(FirebaseHouseholdParentsService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly loginUsernameInput = viewChild<ElementRef<HTMLInputElement>>('loginUsernameInput');

  readonly children = this.familyData.children;
  readonly activeMode = this.familyData.activeMode;
  readonly currentHouseholdLabel = this.familyData.currentHouseholdLabel;
  readonly editingChildId = signal('');
  readonly loginChildId = signal('');
  readonly lastSavedChild = signal<
    { action: 'created' | 'updated' | 'loginEnabled'; name: string; source: 'firebase' | 'local' } | null
  >(null);
  readonly householdSwitchFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly latestCreatedLink = signal<LatestChildLink | null>(readStoredLatestChildLink());
  readonly pendingHouseholdChildId = signal('');
  readonly pendingLinkChildId = signal('');
  readonly saveError = signal('');
  readonly loginError = signal('');
  readonly acceptLinkError = signal('');
  readonly inviteError = signal('');
  readonly profileKind = signal<ProfileKind>('child');
  readonly invitedParent = signal<{ displayName: string; email: string; tempPassword: string } | null>(null);
  readonly childLoginHint = childUsernameHelpText();
  readonly childLinkPolicyOptions: Array<{
    description: string;
    label: string;
    value: HouseholdSwitchPolicy;
  }> = [
    {
      value: 'parentOnly',
      label: 'Parent controlled',
      description: 'The child can land here only when a parent points the account to this household.',
    },
    {
      value: 'childAllowed',
      label: 'Child can switch',
      description: 'The child can move between linked households from their own household lane.',
    },
    {
      value: 'childRequest',
      label: 'Child can ask',
      description: 'The child can see the linked household, but approval-based switching still comes later.',
    },
  ];
  readonly usesFirebaseChildProfiles = computed(() => {
    const profile = this.firebaseUserProfile.currentProfile();

    return Boolean(profile?.source === 'authAccount' && profile.role === 'parent' && profile.householdId);
  });
  readonly childModel = signal(this.createChildFormModel());
  readonly childForm = form(this.childModel, (path) => {
    required(path.name, { message: 'Add the child name.' });
    minLength(path.name, 2, { message: 'Use at least 2 characters for the name.' });

    required(path.avatar, { message: 'Add a short avatar label or initials.' });
    minLength(path.avatar, 1, { message: 'Use 1 to 3 letters for the avatar.' });
    validate(path.avatar, ({ value }) =>
      value().trim().length <= 3 ? undefined : { kind: 'length', message: 'Keep the avatar to 3 letters or fewer.' },
    );

    required(path.themeColor, { message: 'Choose a theme color.' });

    min(path.age, 1, { message: 'Choose an age greater than zero.' });
    min(path.level, 1, { message: 'Level should be at least 1.' });
    min(path.points, 0, { message: 'Points cannot be negative.' });
    min(path.streakDays, 0, { message: 'Streak days cannot be negative.' });
  });
  readonly editingChild = computed(() => this.familyData.childById(this.editingChildId()) ?? null);
  readonly loginChild = computed(() => this.familyData.childById(this.loginChildId()) ?? null);
  readonly loginModel = signal(this.createLoginFormModel());
  readonly loginForm = form(this.loginModel, (path) => {
    required(path.username, { message: 'Choose a username for this child.' });
    minLength(path.username, 3, { message: 'Use at least 3 characters for the username.' });
    validate(path.username, ({ value }) =>
      normalizeChildUsername(value()) ? undefined : { kind: 'pattern', message: this.childLoginHint },
    );

    required(path.password, { message: 'Add a starter password for this child.' });
    minLength(path.password, 6, { message: 'Starter passwords should be at least 6 characters.' });
  });
  readonly acceptLinkModel = signal(this.createAcceptLinkFormModel());
  readonly acceptLinkForm = form(this.acceptLinkModel, (path) => {
    required(path.code, { message: 'Paste the child household link code here.' });
    validate(path.code, ({ value }) =>
      normalizeChildLinkCode(value()).length >= 10
        ? undefined
        : { kind: 'pattern', message: 'Use the full child link code from the source household.' },
    );

    required(path.householdSwitchPolicy, { message: 'Choose how this household should handle child switching.' });
  });
  readonly parentModel = signal(this.createParentFormModel());
  readonly parentForm = form(this.parentModel, (path) => {
    required(path.displayName, { message: 'Add the co-parent name that should appear inside the app.' });
    minLength(path.displayName, 2, { message: 'Use at least 2 characters for the parent name.' });

    required(path.email, { message: 'Add the email this parent will use to sign in.' });
    pattern(path.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'Enter a valid email address.' });

    required(path.themeColor, { message: 'Choose a theme color.' });
  });
  readonly quickStats = computed(() => {
    const children = this.children();
    const totalPoints = children.reduce((sum, child) => sum + child.points, 0);
    const averageLevel = children.length === 0 ? 0 : Math.round(children.reduce((sum, child) => sum + child.level, 0) / children.length);

    return [
      {
        label: 'Children',
        value: children.length.toString(),
        hint: this.usesFirebaseChildProfiles()
          ? 'Profiles currently active in this Firestore household'
          : 'Profiles currently active in the mock family',
      },
      {
        label: 'Total Points',
        value: totalPoints.toString(),
        hint: 'Combined point bank across the whole family',
      },
      {
        label: 'Average Level',
        value: averageLevel.toString(),
        hint: 'A quick pulse on how the family growth board is trending',
      },
      {
        label: 'Current Mode',
        value: this.activeMode().name,
        hint: 'New profiles join the family in the active seasonal rhythm',
      },
    ];
  });
  readonly childCards = computed(() =>
    this.children().map((child) => ({
      child,
      summary: this.familyData.getChildSummary(child.id, child.activeModeId),
    })),
  );
  readonly canUseLatestLinkCode = computed(() => Boolean(this.latestCreatedLink()?.code));

  onSubmit(submitEvent?: Event) {
    submitWithValidationFocus(this.childForm, submitEvent, async () => {
      const draft = this.buildChildDraft();
      const editingChildId = this.editingChildId();
      this.saveError.set('');

      if (this.usesFirebaseChildProfiles()) {
        const result = editingChildId
          ? await this.firebaseChildProfiles.updateChildProfile(editingChildId, draft, this.activeMode().id)
          : await this.firebaseChildProfiles.createChildProfile(draft, this.activeMode().id);

        if (!result.ok || !result.child) {
          this.saveError.set(result.message ?? 'The Firestore child profile could not be saved yet.');
          return;
        }

        this.familyData.upsertChildProfile(result.child);
        this.lastSavedChild.set({
          action: editingChildId ? 'updated' : 'created',
          name: result.child.name,
          source: 'firebase',
        });
      } else {
        if (editingChildId) {
          this.familyData.updateChildProfile(editingChildId, draft);
          this.lastSavedChild.set({
            action: 'updated',
            name: draft.name,
            source: 'local',
          });
        } else {
          this.familyData.addChildProfile(draft);
          this.lastSavedChild.set({
            action: 'created',
            name: draft.name,
            source: 'local',
          });
        }
      }

      this.cancelEdit();
    });
  }

  startEdit(childId: string) {
    const child = this.familyData.childById(childId);

    if (!child) {
      return;
    }

    this.profileKind.set('child');
    this.editingChildId.set(childId);
    this.lastSavedChild.set(null);
    this.saveError.set('');
    this.childModel.set(this.createChildFormModel(child));
  }

  startLoginSetup(childId: string) {
    const child = this.familyData.childById(childId);

    if (!child || child.login?.enabled) {
      return;
    }

    this.loginChildId.set(childId);
    this.lastSavedChild.set(null);
    this.loginError.set('');
    this.loginModel.set(this.createLoginFormModel(child));

    queueMicrotask(() => {
      requestAnimationFrame(() => {
        this.loginUsernameInput()?.nativeElement.focus();
        this.loginUsernameInput()?.nativeElement.select();
      });
    });
  }

  cancelEdit() {
    this.editingChildId.set('');
    this.saveError.set('');
    this.childModel.set(this.createChildFormModel());
  }

  cancelLoginSetup() {
    this.loginChildId.set('');
    this.loginError.set('');
    this.loginModel.set(this.createLoginFormModel());
  }

  clearSaveError() {
    this.saveError.set('');
  }

  clearLoginError() {
    this.loginError.set('');
  }

  clearAcceptLinkError() {
    this.acceptLinkError.set('');
  }

  clearInviteError() {
    this.inviteError.set('');
  }

  setProfileKind(kind: ProfileKind) {
    if (this.profileKind() === kind) {
      return;
    }

    this.profileKind.set(kind);
    this.saveError.set('');
    this.inviteError.set('');

    if (kind === 'parent') {
      // Editing only applies to children; drop any in-progress child edit when flipping to the parent invite.
      this.cancelEdit();
      this.parentModel.set(this.createParentFormModel());
    }
  }

  dismissInvitedParent() {
    this.invitedParent.set(null);
  }

  onInviteParent(submitEvent?: Event) {
    submitWithValidationFocus(this.parentForm, submitEvent, async () => {
      this.inviteError.set('');
      const tempPassword = generateTempPassword();
      const formValue = this.parentForm().value();
      const result = await this.firebaseHouseholdParents.inviteParent({
        displayName: formValue.displayName,
        email: formValue.email,
        themeColor: formValue.themeColor,
        password: tempPassword,
      });

      if (!result.ok || !result.parent) {
        this.inviteError.set(result.message ?? 'That co-parent could not be added to this household yet.');
        return;
      }

      this.invitedParent.set({
        displayName: result.parent.displayName,
        email: result.parent.email,
        tempPassword,
      });
      this.parentModel.set(this.createParentFormModel());
    });
  }

  async createChildHouseholdLink(childId: string) {
    this.householdSwitchFeedback.set(null);
    this.pendingLinkChildId.set(childId);
    const result = await this.firebaseChildHouseholdLinks.createChildHouseholdLink(childId);
    this.pendingLinkChildId.set('');

    if (!result.ok || !result.code || !result.childName || !result.expiresAtLabel) {
      this.householdSwitchFeedback.set({
        kind: 'error',
        text: result.message ?? 'That child household link code could not be created yet.',
      });
      return;
    }

    const latestLink = {
      childId,
      childName: result.childName,
      code: result.code,
      expiresAtLabel: result.expiresAtLabel,
    } satisfies LatestChildLink;

    this.latestCreatedLink.set(latestLink);
    storeLatestChildLink(latestLink);
    this.householdSwitchFeedback.set({
      kind: 'success',
      text: `${result.childName}'s household link code is ready. Sign in to the receiving household and paste the code into the link panel below.`,
    });
  }

  async pointChildToCurrentHousehold(childId: string) {
    this.householdSwitchFeedback.set(null);
    this.pendingHouseholdChildId.set(childId);
    const result = await this.familyData.pointChildAccountToCurrentHousehold(childId);
    this.pendingHouseholdChildId.set('');

    if (!result.ok) {
      this.householdSwitchFeedback.set({
        kind: 'error',
        text: result.message ?? 'That child account could not be pointed at this household yet.',
      });
      return;
    }

    const child = this.familyData.childById(childId);
    this.householdSwitchFeedback.set({
      kind: 'success',
      text: `${child?.name ?? 'This child'} will now reopen in ${this.currentHouseholdLabel()} when the signed-in account refreshes.`,
    });
  }

  useLatestChildLinkCode() {
    const latestLink = this.latestCreatedLink();

    if (!latestLink) {
      return;
    }

    this.acceptLinkModel.set(this.createAcceptLinkFormModel(latestLink.code));
    this.acceptLinkError.set('');
  }

  onAcceptChildHouseholdLink(submitEvent?: Event) {
    submitWithValidationFocus(this.acceptLinkForm, submitEvent, async () => {
      this.acceptLinkError.set('');
      const formValue = this.acceptLinkForm().value();
      const result = await this.firebaseChildHouseholdLinks.acceptChildHouseholdLink(
        formValue.code,
        formValue.householdSwitchPolicy,
        this.activeMode().id,
      );

      if (!result.ok || !result.child) {
        this.acceptLinkError.set(result.message ?? 'That child could not be linked into this household yet.');
        return;
      }

      this.familyData.upsertChildProfile(result.child);

      if (normalizeChildLinkCode(formValue.code) === normalizeChildLinkCode(this.latestCreatedLink()?.code ?? '')) {
        clearStoredLatestChildLink();
        this.latestCreatedLink.set(null);
      }

      this.acceptLinkModel.set(this.createAcceptLinkFormModel());
      this.householdSwitchFeedback.set({
        kind: 'success',
        text:
          `${result.child.name} now belongs to ${this.currentHouseholdLabel()} too. ` +
          'If this child already has login enabled, use the household pointer action in the roster card to send their signed-in device here.',
      });
    });
  }

  onEnableLogin(submitEvent?: Event) {
    submitWithValidationFocus(this.loginForm, submitEvent, async () => {
      const child = this.loginChild();

      if (!child) {
        this.loginError.set('Choose a child from the roster before enabling sign-in.');
        return;
      }

      this.loginError.set('');
      const result = await this.firebaseChildProfiles.enableChildLogin(child.id, {
        username: this.loginForm().value().username,
        password: this.loginForm().value().password,
      });

      if (!result.ok || !result.child) {
        this.loginError.set(result.message ?? 'The child login could not be enabled yet.');
        return;
      }

      this.familyData.upsertChildProfile(result.child);
      this.lastSavedChild.set({
        action: 'loginEnabled',
        name: result.child.name,
        source: 'firebase',
      });
      this.cancelLoginSetup();
    });
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  private buildChildDraft(): ChildProfileDraft {
    const value = this.childForm().value();

    return {
      name: value.name.trim(),
      age: Math.round(value.age),
      avatar: value.avatar.trim().toUpperCase(),
      themeColor: value.themeColor,
      level: Math.round(value.level),
      points: Math.round(value.points),
      streakDays: Math.round(value.streakDays),
      currentBook: value.currentBook.trim(),
      currentLifeSkill: value.currentLifeSkill.trim(),
      sportsGoal: value.sportsGoal.trim(),
      yearGoal: value.yearGoal.trim(),
    };
  }

  private createChildFormModel(child?: ChildProfile) {
    return {
      name: child?.name ?? '',
      age: child?.age ?? 8,
      avatar: child?.avatar ?? '',
      themeColor: child?.themeColor ?? '#ff7b59',
      level: child?.level ?? 1,
      points: child?.points ?? 0,
      streakDays: child?.streakDays ?? 0,
      currentBook: child?.currentBook ?? '',
      currentLifeSkill: child?.currentLifeSkill ?? '',
      sportsGoal: child?.sportsGoal ?? '',
      yearGoal: child?.yearGoal ?? '',
    };
  }

  private createLoginFormModel(child?: ChildProfile) {
    return {
      username: child?.login?.usernameDisplay ?? suggestChildUsername(child?.name ?? ''),
      password: '',
    };
  }

  private createAcceptLinkFormModel(code = '') {
    return {
      code,
      householdSwitchPolicy: 'parentOnly' as HouseholdSwitchPolicy,
    };
  }

  private createParentFormModel() {
    return {
      displayName: '',
      email: '',
      themeColor: '#4f7cff',
    };
  }
}

function readStoredLatestChildLink(): LatestChildLink | null {
  try {
    const rawValue = globalThis.localStorage?.getItem(LATEST_CHILD_LINK_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<LatestChildLink>;

    if (!parsed.code || !parsed.childId || !parsed.childName || !parsed.expiresAtLabel) {
      return null;
    }

    return {
      childId: parsed.childId,
      childName: parsed.childName,
      code: parsed.code,
      expiresAtLabel: parsed.expiresAtLabel,
    };
  } catch {
    return null;
  }
}

function storeLatestChildLink(link: LatestChildLink) {
  try {
    globalThis.localStorage?.setItem(LATEST_CHILD_LINK_STORAGE_KEY, JSON.stringify(link));
  } catch {
    // Ignore local storage failures so link creation still succeeds.
  }
}

function clearStoredLatestChildLink() {
  try {
    globalThis.localStorage?.removeItem(LATEST_CHILD_LINK_STORAGE_KEY);
  } catch {
    // Ignore local storage failures so acceptance still succeeds.
  }
}
