import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Unsubscribe,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, PrivilegeRule, PrivilegeRuleDraft, PrivilegeType } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const SETTINGS_SUBCOLLECTION = 'settings';
const PRIVILEGES_SETTINGS_DOC = 'privileges';

interface PrivilegeRuleDocument extends Omit<PrivilegeRule, 'id'> {
  ruleId?: string;
}

interface PrivilegeRulesSettingsDocument {
  rules?: PrivilegeRuleDocument[];
}

export interface PrivilegeMutationResult {
  message?: string;
  ok: boolean;
  rule?: PrivilegeRule;
  rules?: PrivilegeRule[];
  source?: 'firebase' | 'local';
}

@Injectable({
  providedIn: 'root',
})
export class FirebasePrivilegeRulesService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _privilegeRules = signal<PrivilegeRule[] | null>(null);
  readonly privilegeRules = this._privilegeRules.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private privilegesSubscription: Unsubscribe | null = null;
  private currentSyncKey = '';

  startSync(profile: AuthBootstrapProfile) {
    const firestore = this.firestore;
    const householdId = profile.householdId ?? '';

    if (!firestore || !householdId || profile.source !== 'authAccount') {
      this.stopSync();
      return;
    }

    const syncKey = `${profile.uid}:${profile.role}:${profile.personId}:${householdId}`;

    if (this.currentSyncKey === syncKey) {
      return;
    }

    this.stopSync();
    this.currentSyncKey = syncKey;
    this._privilegeRules.set(null);
    this._lastSyncError.set('');

    this.privilegesSubscription = onSnapshot(
      doc(firestore, HOUSEHOLDS_COLLECTION, householdId, SETTINGS_SUBCOLLECTION, PRIVILEGES_SETTINGS_DOC),
      (snapshot) => {
        if (!snapshot.exists()) {
          this._privilegeRules.set(null);
          this._lastSyncError.set('');
          return;
        }

        const data = snapshot.data() as PrivilegeRulesSettingsDocument;
        const rules = Array.isArray(data.rules)
          ? data.rules
              .map((rule, index) => mapPrivilegeRuleDocument(rule, index))
              .filter((rule): rule is PrivilegeRule => rule !== null)
          : [];

        this._privilegeRules.set(rules);
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set('Firestore could not keep privilege rules in sync for this household.');
      },
    );
  }

  stopSync() {
    this.privilegesSubscription?.();
    this.privilegesSubscription = null;
    this.currentSyncKey = '';
    this._privilegeRules.set(null);
    this._lastSyncError.set('');
  }

  async updateRule(
    ruleId: string,
    draft: PrivilegeRuleDraft,
    currentRules: PrivilegeRule[],
  ): Promise<PrivilegeMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();
    const normalizedDraft = normalizePrivilegeRuleDraft(draft);
    const existingRule = currentRules.find((rule) => rule.id === ruleId);

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore privilege settings yet.',
      };
    }

    if (!existingRule || !normalizedDraft) {
      return {
        ok: false,
        message: 'This privilege rule is missing required details.',
      };
    }

    const updatedRule: PrivilegeRule = {
      ...existingRule,
      ...normalizedDraft,
    };
    const updatedRules = currentRules.map((rule) => (rule.id === ruleId ? updatedRule : rule));

    try {
      await setDoc(
        doc(firestore, HOUSEHOLDS_COLLECTION, householdId, SETTINGS_SUBCOLLECTION, PRIVILEGES_SETTINGS_DOC),
        {
          rules: updatedRules.map((rule) => toPrivilegeRuleDocument(rule)),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return {
        ok: true,
        rule: updatedRule,
        rules: updatedRules,
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describePrivilegeMutationError(error),
      };
    }
  }

  private householdIdForWrites() {
    const profile = this.firebaseUserProfile.currentProfile();

    if (!this.firestore || !profile?.householdId || profile.source !== 'authAccount') {
      return null;
    }

    return profile.householdId;
  }
}

function createFirebaseApp(): FirebaseApp | null {
  if (!hasFirebaseConfig()) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
}

let firestoreEmulatorConnected = false;

function createFirestore(app: FirebaseApp) {
  const firestore = getFirestore(app);

  if (environment.firebase.useFirestoreEmulator && !firestoreEmulatorConnected) {
    connectFirestoreEmulator(
      firestore,
      environment.firebase.firestoreEmulatorHost,
      environment.firebase.firestoreEmulatorPort,
    );
    firestoreEmulatorConnected = true;
  }

  return firestore;
}

function hasFirebaseConfig() {
  const { apiKey, authDomain, projectId, appId } = environment.firebase;

  return Boolean(apiKey && authDomain && projectId && appId);
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

function toPrivilegeRuleDocument(rule: PrivilegeRule): PrivilegeRuleDocument {
  return {
    ruleId: rule.id,
    title: rule.title,
    type: rule.type,
    requirements: rule.requirements,
    activeModes: rule.activeModes,
  };
}

function mapPrivilegeRuleDocument(rule: PrivilegeRuleDocument, index: number): PrivilegeRule | null {
  const type = normalizePrivilegeType(rule.type);
  const title = rule.title?.trim() || '';
  const requirements = Array.isArray(rule.requirements)
    ? rule.requirements.map((requirement) => requirement.trim()).filter(Boolean)
    : [];
  const activeModes = Array.isArray(rule.activeModes) ? rule.activeModes.map((modeId) => modeId.trim()).filter(Boolean) : [];
  const id = rule.ruleId?.trim() || `privilege-${index + 1}`;

  if (!type || !title || requirements.length === 0 || activeModes.length === 0) {
    return null;
  }

  return {
    id,
    title,
    type,
    requirements,
    activeModes,
  };
}

function normalizePrivilegeType(type: PrivilegeType | undefined) {
  switch (type) {
    case 'screenTime':
    case 'friends':
    case 'sleepover':
    case 'videoGames':
    case 'youtube':
      return type;
    default:
      return null;
  }
}

function describePrivilegeMutationError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firestore blocked this privilege-rule save. Update the household privilege security rules before trying again.';
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached while saving privilege settings. Check the network and try again.';
    default:
      return 'The privilege rule could not be saved right now.';
  }
}
