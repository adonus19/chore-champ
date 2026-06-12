import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Unsubscribe,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, Goal, GoalDraft } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const GOALS_SUBCOLLECTION = 'goals';

interface GoalDocument extends Omit<Goal, 'id'> {
  goalId?: string;
}

export interface GoalMutationResult {
  goal?: Goal;
  goalId?: string;
  message?: string;
  ok: boolean;
  source?: 'firebase' | 'local';
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseGoalDataService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _goals = signal<Goal[] | null>(null);
  readonly goals = this._goals.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private goalsSubscription: Unsubscribe | null = null;
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
    this._goals.set([]);
    this._lastSyncError.set('');

    const goalsQuery =
      profile.role === 'child'
        ? query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, GOALS_SUBCOLLECTION), where('childId', '==', profile.personId))
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, GOALS_SUBCOLLECTION));

    this.goalsSubscription = onSnapshot(
      goalsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as GoalDocument),
        }));

        this._goals.set(
          items
            .map((item) => mapGoalDocument(item))
            .sort((left, right) => left.title.localeCompare(right.title)),
        );
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set('Firestore could not keep goals in sync for this household.');
      },
    );
  }

  stopSync() {
    this.goalsSubscription?.();
    this.goalsSubscription = null;
    this.currentSyncKey = '';
    this._goals.set(null);
    this._lastSyncError.set('');
  }

  async addGoal(draft: GoalDraft): Promise<GoalMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore goal creation yet.',
      };
    }

    const normalizedDraft = normalizeGoalDraft(draft);

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'This goal is missing required details.',
      };
    }

    try {
      const goalRef = doc(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, GOALS_SUBCOLLECTION));
      const goal: Goal = {
        id: goalRef.id,
        ...normalizedDraft,
      };

      await setDoc(goalRef, {
        goalId: goal.id,
        ...toGoalDocumentPayload(goal),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { ok: true, goal, source: 'firebase' };
    } catch (error) {
      return {
        ok: false,
        message: describeGoalMutationError(error, 'save'),
      };
    }
  }

  async updateGoal(goalId: string, draft: GoalDraft): Promise<GoalMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore goal editing yet.',
      };
    }

    const normalizedDraft = normalizeGoalDraft(draft);

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'This goal is missing required details.',
      };
    }

    const goal: Goal = {
      id: goalId,
      ...normalizedDraft,
    };

    try {
      await updateDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, GOALS_SUBCOLLECTION, goalId), {
        ...toGoalDocumentPayload(goal),
        updatedAt: serverTimestamp(),
      });

      return { ok: true, goal, source: 'firebase' };
    } catch (error) {
      return {
        ok: false,
        message: describeGoalMutationError(error, 'save'),
      };
    }
  }

  async deleteGoal(goalId: string): Promise<GoalMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore goal deletion yet.',
      };
    }

    try {
      await deleteDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, GOALS_SUBCOLLECTION, goalId));

      return { ok: true, goalId, source: 'firebase' };
    } catch (error) {
      return {
        ok: false,
        message: describeGoalMutationError(error, 'delete'),
      };
    }
  }

  async logGoalProgress(goalId: string, amount: number): Promise<GoalMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();
    const normalizedAmount = Math.max(1, Math.round(amount));

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore goal progress yet.',
      };
    }

    try {
      const goalRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, GOALS_SUBCOLLECTION, goalId);
      let updatedGoal: Goal | null = null;

      await runTransaction(firestore, async (transaction) => {
        const goalSnapshot = await transaction.get(goalRef);

        if (!goalSnapshot.exists()) {
          throw new Error('goal-missing');
        }

        const goal = mapGoalDocument({
          id: goalSnapshot.id,
          ...(goalSnapshot.data() as GoalDocument),
        });
        updatedGoal = {
          ...goal,
          current: Math.min(goal.current + normalizedAmount, goal.target),
        };

        transaction.update(goalRef, {
          current: updatedGoal.current,
          updatedAt: serverTimestamp(),
        });
      });

      return updatedGoal ? { ok: true, goal: updatedGoal, source: 'firebase' } : { ok: true, source: 'firebase' };
    } catch (error) {
      return {
        ok: false,
        message: describeGoalMutationError(error, 'progress'),
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

function normalizeGoalDraft(draft: GoalDraft) {
  const childId = draft.childId.trim();
  const title = draft.title.trim();
  const unit = draft.unit.trim();
  const target = Math.max(1, Math.round(draft.target));
  const current = Math.max(0, Math.round(draft.current));
  const activeModes = Array.from(new Set(draft.activeModes.map((modeId) => modeId.trim()).filter(Boolean)));

  if (!childId || !title || !unit || activeModes.length === 0) {
    return null;
  }

  return {
    childId,
    title,
    target,
    current: Math.min(current, target),
    unit,
    category: draft.category,
    activeModes,
  } satisfies GoalDraft;
}

function toGoalDocumentPayload(goal: Goal) {
  return {
    childId: goal.childId,
    title: goal.title,
    target: goal.target,
    current: goal.current,
    unit: goal.unit,
    category: goal.category,
    activeModes: goal.activeModes,
  };
}

function mapGoalDocument(document: GoalDocument & { id: string }): Goal {
  const target = Math.max(1, Math.round(document.target ?? 1));
  const current = Math.max(0, Math.round(document.current ?? 0));

  return {
    id: document.goalId?.trim() || document.id,
    childId: document.childId?.trim() || '',
    title: document.title?.trim() || 'Untitled goal',
    target,
    current: Math.min(current, target),
    unit: document.unit?.trim() || 'wins',
    category: document.category ?? 'mind',
    activeModes: Array.isArray(document.activeModes) ? document.activeModes.filter(Boolean) : [],
  };
}

function describeGoalMutationError(error: unknown, action: 'delete' | 'progress' | 'save') {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';

  if (message === 'goal-missing') {
    return 'That goal could not be found in Firestore. Refresh the goal board and try again.';
  }

  switch (code) {
    case 'invalid-argument':
    case 'firestore/invalid-argument':
      return 'The goal data included a Firestore-invalid value. Check the fields and try again.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return `Firestore blocked this goal ${action} action. Update the household goal security rules before trying again.`;
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached while syncing goals. Check the network and try again.';
    default:
      return `The Firestore goal ${action} action could not be completed right now.`;
  }
}
