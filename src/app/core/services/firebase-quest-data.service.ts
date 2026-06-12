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
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import {
  AuthBootstrapProfile,
  Quest,
  QuestBoardStatus,
  QuestCompletion,
  QuestDraft,
} from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const QUESTS_SUBCOLLECTION = 'quests';
const QUEST_COMPLETIONS_SUBCOLLECTION = 'questCompletions';
const CHILD_STATE_SUBCOLLECTION = 'childState';

interface QuestDocument extends Omit<Quest, 'id'> {
  questId?: string;
}

interface QuestCompletionDocument extends Omit<QuestCompletion, 'id'> {
  completionId?: string;
}

export interface QuestMutationResult {
  message?: string;
  ok: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseQuestDataService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _quests = signal<Quest[] | null>(null);
  readonly quests = this._quests.asReadonly();
  private readonly _completions = signal<QuestCompletion[] | null>(null);
  readonly completions = this._completions.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private questsSubscription: Unsubscribe | null = null;
  private completionsSubscription: Unsubscribe | null = null;
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
    this._quests.set([]);
    this._completions.set([]);
    this._lastSyncError.set('');

    const questsQuery = query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION));
    const completionsQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, QUEST_COMPLETIONS_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, QUEST_COMPLETIONS_SUBCOLLECTION));

    this.questsSubscription = onSnapshot(
      questsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as QuestDocument) }));
        this._quests.set(
          items
            .map((item) => mapQuestDocument(item))
            .sort((left, right) => left.title.localeCompare(right.title)),
        );
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set('Firestore could not keep the quest library in sync for this household.');
      },
    );

    this.completionsSubscription = onSnapshot(
      completionsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as QuestCompletionDocument) }));
        this._completions.set(
          items
            .map((item) => mapCompletionDocument(item))
            .sort((left, right) => right.completedAt.localeCompare(left.completedAt)),
        );
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set('Firestore could not keep the quest approvals in sync for this household.');
      },
    );
  }

  stopSync() {
    this.questsSubscription?.();
    this.completionsSubscription?.();
    this.questsSubscription = null;
    this.completionsSubscription = null;
    this.currentSyncKey = '';
    this._quests.set(null);
    this._completions.set(null);
    this._lastSyncError.set('');
  }

  async addQuest(draft: QuestDraft): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore quest creation yet.',
      };
    }

    const normalizedDraft = normalizeQuestDraft(draft);

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'This quest is missing required details.',
      };
    }

    try {
      const questRef = doc(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION));
      await setDoc(questRef, {
        questId: questRef.id,
        ...toQuestDocumentPayload(normalizedDraft),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, 'save'),
      };
    }
  }

  async updateQuest(questId: string, draft: QuestDraft): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore quest editing yet.',
      };
    }

    const normalizedDraft = normalizeQuestDraft(draft);

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'This quest is missing required details.',
      };
    }

    try {
      await updateDoc(doc(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION, questId), {
        ...toQuestDocumentPayload(normalizedDraft),
        updatedAt: serverTimestamp(),
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, 'save'),
      };
    }
  }

  async deleteQuest(questId: string): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore quest deletion yet.',
      };
    }

    try {
      const questRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION, questId);
      const completionsSnapshot = await getDocs(
        query(
          collection(firestore, HOUSEHOLDS_COLLECTION, householdId, QUEST_COMPLETIONS_SUBCOLLECTION),
          where('questId', '==', questId),
        ),
      );
      const batch = writeBatch(firestore);
      batch.delete(questRef);

      for (const completionDoc of completionsSnapshot.docs) {
        batch.delete(completionDoc.ref);
      }

      await batch.commit();

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, 'delete'),
      };
    }
  }

  async completeQuest(questId: string, childId: string): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore quest completion yet.',
      };
    }

    try {
      const questRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION, questId);
      const questSnapshot = await getDoc(questRef);

      if (!questSnapshot.exists()) {
        throw new Error('quest-missing');
      }

      const quest = mapQuestDocument({ id: questSnapshot.id, ...(questSnapshot.data() as QuestDocument) });
      const completionRef = doc(
        firestore,
        HOUSEHOLDS_COLLECTION,
        householdId,
        QUEST_COMPLETIONS_SUBCOLLECTION,
        completionIdForToday(childId, questId),
      );

      if (quest.requiresApproval) {
        await setDoc(
          completionRef,
          {
            completionId: completionRef.id,
            questId,
            childId,
            completedAt: new Date().toISOString(),
            status: 'pending',
            approvedBy: null,
            notes: 'Waiting for parent approval.',
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        return { ok: true };
      }

      await runTransaction(firestore, async (transaction) => {
        const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId);
        const completionSnapshot = await transaction.get(completionRef);
        const existingCompletion = completionSnapshot.exists()
          ? mapCompletionDocument({ id: completionSnapshot.id, ...(completionSnapshot.data() as QuestCompletionDocument) })
          : null;

        if (existingCompletion && ['approved', 'autoApproved', 'pending'].includes(existingCompletion.status)) {
          return;
        }

        const nextStatus = quest.requiresApproval ? 'pending' : 'autoApproved';
        transaction.set(completionRef, {
          completionId: completionRef.id,
          questId,
          childId,
          completedAt: new Date().toISOString(),
          status: nextStatus,
          approvedBy: quest.requiresApproval ? null : 'Auto-approved',
          notes: quest.requiresApproval ? 'Waiting for parent approval.' : 'Auto-approved by quest settings.',
          updatedAt: serverTimestamp(),
        });

        if (nextStatus === 'autoApproved') {
          transaction.set(
            childStateRef,
            {
              childPersonId: childId,
              points: increment(quest.points),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, 'complete'),
      };
    }
  }

  // Self-certified completion for a parent's own personal quest. Unlike completeQuest, this never touches a
  // childState points doc (parents have none) — it only writes/removes the questCompletions record.
  async setParentQuestCompletion(questId: string, parentPersonId: string, done: boolean): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId || !parentPersonId) {
      return {
        ok: false,
        message: 'The signed-in parent household is not ready for personal quest completion yet.',
      };
    }

    const completionRef = doc(
      firestore,
      HOUSEHOLDS_COLLECTION,
      householdId,
      QUEST_COMPLETIONS_SUBCOLLECTION,
      completionIdForToday(parentPersonId, questId),
    );

    try {
      if (!done) {
        await deleteDoc(completionRef);
        return { ok: true };
      }

      await setDoc(
        completionRef,
        {
          completionId: completionRef.id,
          questId,
          childId: parentPersonId,
          completedAt: new Date().toISOString(),
          status: 'autoApproved',
          approvedBy: 'Self-certified',
          notes: 'Self-certified by parent.',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, 'complete'),
      };
    }
  }

  async approveCompletion(completionId: string): Promise<QuestMutationResult> {
    return this.updateCompletionStatus(completionId, 'approved');
  }

  async rejectCompletion(completionId: string): Promise<QuestMutationResult> {
    return this.updateCompletionStatus(completionId, 'rejected');
  }

  async overrideQuestStatus(questId: string, childId: string, status: QuestBoardStatus): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore quest overrides yet.',
      };
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        const questRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION, questId);
        const completionRef = doc(
          firestore,
          HOUSEHOLDS_COLLECTION,
          householdId,
          QUEST_COMPLETIONS_SUBCOLLECTION,
          completionIdForToday(childId, questId),
        );
        const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId);
        const [questSnapshot, completionSnapshot] = await Promise.all([
          transaction.get(questRef),
          transaction.get(completionRef),
        ]);

        if (!questSnapshot.exists()) {
          throw new Error('quest-missing');
        }

        const quest = mapQuestDocument({ id: questSnapshot.id, ...(questSnapshot.data() as QuestDocument) });
        const existingCompletion = completionSnapshot.exists()
          ? mapCompletionDocument({ id: completionSnapshot.id, ...(completionSnapshot.data() as QuestCompletionDocument) })
          : null;
        const previousAwardedPoints =
          existingCompletion && (existingCompletion.status === 'approved' || existingCompletion.status === 'autoApproved')
            ? quest.points
            : 0;

        if (status === 'open') {
          if (!existingCompletion) {
            return;
          }

          transaction.delete(completionRef);

          if (previousAwardedPoints > 0) {
            transaction.set(
              childStateRef,
              {
                childPersonId: childId,
                points: increment(-previousAwardedPoints),
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
          }

          return;
        }

        const nextStatus: QuestCompletion['status'] =
          status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'rejected';
        const nextAwardedPoints = status === 'approved' ? quest.points : 0;
        const pointsDelta = nextAwardedPoints - previousAwardedPoints;

        transaction.set(
          completionRef,
          {
            completionId: completionRef.id,
            questId,
            childId,
            completedAt: existingCompletion?.completedAt ?? new Date().toISOString(),
            status: nextStatus,
            approvedBy: status === 'approved' ? 'Parent override' : null,
            notes:
              status === 'approved'
                ? 'Approved directly by a parent override.'
                : status === 'pending'
                  ? 'Placed back into parent review by override.'
                  : 'Marked for another pass by a parent override.',
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        if (pointsDelta !== 0) {
          transaction.set(
            childStateRef,
            {
              childPersonId: childId,
              points: increment(pointsDelta),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, 'override'),
      };
    }
  }

  private async updateCompletionStatus(
    completionId: string,
    nextStatus: 'approved' | 'rejected',
  ): Promise<QuestMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'The signed-in household is not ready for Firestore approval updates yet.',
      };
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        const completionRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, QUEST_COMPLETIONS_SUBCOLLECTION, completionId);
        const completionSnapshot = await transaction.get(completionRef);

        if (!completionSnapshot.exists()) {
          throw new Error('completion-missing');
        }

        const completion = mapCompletionDocument({
          id: completionSnapshot.id,
          ...(completionSnapshot.data() as QuestCompletionDocument),
        });
        const questRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, QUESTS_SUBCOLLECTION, completion.questId);
        const questSnapshot = await transaction.get(questRef);

        if (!questSnapshot.exists()) {
          throw new Error('quest-missing');
        }

        const quest = mapQuestDocument({ id: questSnapshot.id, ...(questSnapshot.data() as QuestDocument) });
        const childStateRef = doc(
          firestore,
          HOUSEHOLDS_COLLECTION,
          householdId,
          CHILD_STATE_SUBCOLLECTION,
          completion.childId,
        );

        if (completion.status !== 'pending') {
          return;
        }

        transaction.update(completionRef, {
          status: nextStatus,
          approvedBy: nextStatus === 'approved' ? 'Parent' : null,
          notes:
            nextStatus === 'approved'
              ? 'Nice work. Approved by a parent.'
              : 'Almost there. Clean it up once more and resubmit.',
          updatedAt: serverTimestamp(),
        });

        if (nextStatus === 'approved') {
          transaction.set(
            childStateRef,
            {
              childPersonId: completion.childId,
              points: increment(quest.points),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      });

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: describeQuestMutationError(error, nextStatus === 'approved' ? 'approve' : 'reject'),
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

function normalizeQuestDraft(draft: QuestDraft) {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const instructions = draft.instructions.trim();
  const assignedTo = draft.assignedTo.map((value) => value.trim()).filter(Boolean);
  const activeModes = draft.activeModes.map((value) => value.trim()).filter(Boolean);

  if (!title || !description || !instructions || assignedTo.length === 0 || activeModes.length === 0) {
    return null;
  }

  return {
    title,
    description,
    category: draft.category,
    assignedTo,
    points: Math.max(1, Math.round(draft.points)),
    recurrence: draft.recurrence,
    requiresApproval: draft.requiresApproval,
    requiredBeforeScreenTime: draft.requiredBeforeScreenTime,
    instructions,
    activeModes,
    difficulty: draft.difficulty,
    ...(draft.dueDate?.trim() ? { dueDate: draft.dueDate.trim() } : {}),
  } satisfies Omit<Quest, 'id'>;
}

function toQuestDocumentPayload(draft: Omit<Quest, 'id'>) {
  return {
    title: draft.title,
    description: draft.description,
    category: draft.category,
    assignedTo: draft.assignedTo,
    points: draft.points,
    recurrence: draft.recurrence,
    requiresApproval: draft.requiresApproval,
    requiredBeforeScreenTime: draft.requiredBeforeScreenTime,
    instructions: draft.instructions,
    activeModes: draft.activeModes,
    difficulty: draft.difficulty,
    ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
  };
}

function mapQuestDocument(document: QuestDocument & { id: string }): Quest {
  return {
    id: document.questId?.trim() || document.id,
    title: document.title?.trim() || 'Untitled quest',
    description: document.description?.trim() || '',
    category: document.category ?? 'home',
    assignedTo: Array.isArray(document.assignedTo) ? document.assignedTo.filter(Boolean) : [],
    points: Math.max(1, Math.round(document.points ?? 1)),
    recurrence: document.recurrence ?? 'daily',
    requiresApproval: Boolean(document.requiresApproval),
    requiredBeforeScreenTime: Boolean(document.requiredBeforeScreenTime),
    instructions: document.instructions?.trim() || '',
    dueDate: document.dueDate?.trim() || undefined,
    activeModes: Array.isArray(document.activeModes) ? document.activeModes.filter(Boolean) : [],
    difficulty: document.difficulty ?? 'normal',
  };
}

function mapCompletionDocument(document: QuestCompletionDocument & { id: string }): QuestCompletion {
  return {
    id: document.completionId?.trim() || document.id,
    questId: document.questId?.trim() || '',
    childId: document.childId?.trim() || '',
    completedAt: document.completedAt?.trim() || new Date().toISOString(),
    status: document.status ?? 'pending',
    approvedBy: document.approvedBy?.trim() || undefined,
    proofUrl: document.proofUrl?.trim() || undefined,
    notes: document.notes?.trim() || undefined,
  };
}

function completionIdForToday(childId: string, questId: string) {
  return `completion_${childId}_${questId}_${formatDateKey(new Date())}`;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function describeQuestMutationError(
  error: unknown,
  action: 'approve' | 'complete' | 'delete' | 'override' | 'reject' | 'save',
) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';

  switch (message) {
    case 'quest-missing':
      return 'That quest no longer exists in Firestore. Refresh the household board and try again.';
    case 'completion-missing':
      return 'That quest report could not be found in Firestore. Refresh the review queue and try again.';
    default:
      break;
  }

  switch (code) {
    case 'invalid-argument':
    case 'firestore/invalid-argument':
      return 'The quest data included a Firestore-invalid value. Check optional fields like due date and try again.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return `Firestore blocked this quest ${action} action. Update the household quest security rules before trying again.`;
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached while syncing quest data. Check the network and try again.';
    default:
      return `The Firestore quest ${action} action could not be completed right now.`;
  }
}
