import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Unsubscribe,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, JournalEntry, JournalReaction } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const JOURNAL_ENTRIES_SUBCOLLECTION = 'journalEntries';

interface JournalEntryDocument extends Omit<JournalEntry, 'id'> {
  journalEntryId?: string;
}

export interface JournalMutationResult {
  entry?: JournalEntry;
  entryId?: string;
  message?: string;
  ok: boolean;
  source?: 'firebase' | 'local';
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseJournalDataService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _journalEntries = signal<JournalEntry[] | null>(null);
  readonly journalEntries = this._journalEntries.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private journalSubscription: Unsubscribe | null = null;
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
    this._journalEntries.set([]);
    this._lastSyncError.set('');

    const entriesQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, JOURNAL_ENTRIES_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, JOURNAL_ENTRIES_SUBCOLLECTION));

    this.journalSubscription = onSnapshot(
      entriesQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as JournalEntryDocument),
        }));

        this._journalEntries.set(
          items
            .map((item) => mapJournalEntryDocument(item))
            .sort((left, right) => right.date.localeCompare(left.date)),
        );
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set("We couldn't keep journal entries updated right now.");
      },
    );
  }

  async loadSnapshot(profile: AuthBootstrapProfile): Promise<JournalEntry[]> {
    const firestore = this.firestore;
    const householdId = profile.householdId ?? '';

    if (!firestore || !householdId || profile.source !== 'authAccount') {
      return [];
    }

    const entriesQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, JOURNAL_ENTRIES_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, JOURNAL_ENTRIES_SUBCOLLECTION));
    const snapshot = await getDocs(entriesQuery);

    return snapshot.docs
      .map((item) => mapJournalEntryDocument({ id: item.id, ...(item.data() as JournalEntryDocument) }))
      .sort((left, right) => right.date.localeCompare(left.date));
  }

  stopSync() {
    this.journalSubscription?.();
    this.journalSubscription = null;
    this.currentSyncKey = '';
    this._journalEntries.set(null);
    this._lastSyncError.set('');
  }

  async saveJournalEntry(
    childId: string,
    draft: {
      accomplished: string;
      learned: string;
      proudOf: string;
    },
    existingEntry?: JournalEntry,
  ): Promise<JournalMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();
    const normalizedDraft = normalizeJournalDraft(draft);

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'Journal saving is not ready yet. Refresh and try again.',
      };
    }

    if (!normalizedDraft || !childId.trim()) {
      return {
        ok: false,
        message: 'This journal entry needs all three reflection prompts before it can save.',
      };
    }

    const todayKey = formatDateKey(new Date());
    const entryId = existingEntry?.id ?? `journal_${childId}_${todayKey}`;
    const needsParentResponse = !existingEntry || hasJournalContentChanged(existingEntry, normalizedDraft);
    const entry: JournalEntry = {
      id: entryId,
      childId,
      date: existingEntry?.date ?? new Date().toISOString(),
      ...normalizedDraft,
      parentReaction: needsParentResponse ? undefined : existingEntry?.parentReaction,
      parentNote: needsParentResponse ? undefined : existingEntry?.parentNote,
      needsParentResponse,
    };

    try {
      await setDoc(
        doc(firestore, HOUSEHOLDS_COLLECTION, householdId, JOURNAL_ENTRIES_SUBCOLLECTION, entryId),
        {
          journalEntryId: entry.id,
          childId: entry.childId,
          date: entry.date,
          accomplished: entry.accomplished,
          learned: entry.learned,
          proudOf: entry.proudOf,
          needsParentResponse,
          parentReaction: needsParentResponse ? null : (entry.parentReaction ?? null),
          parentNote: needsParentResponse ? null : (entry.parentNote ?? null),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return { ok: true, entry, source: 'firebase' };
    } catch (error) {
      return {
        ok: false,
        message: describeJournalMutationError(error, 'save'),
      };
    }
  }

  async respondToJournalEntry(
    entryId: string,
    response: {
      reaction: JournalReaction;
      note: string;
    },
  ): Promise<JournalMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();
    const note = response.note.trim();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'Journal replies are not ready yet. Refresh and try again.',
      };
    }

    if (!entryId.trim() || !note) {
      return {
        ok: false,
        message: 'Choose a journal entry and add an encouraging note before replying.',
      };
    }

    try {
      const entryRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, JOURNAL_ENTRIES_SUBCOLLECTION, entryId);
      const entrySnapshot = await getDoc(entryRef);

      if (!entrySnapshot.exists()) {
        return {
          ok: false,
          message: 'That journal entry could not be found. Refresh and try again.',
        };
      }

      await updateDoc(entryRef, {
        parentReaction: response.reaction,
        parentNote: note,
        needsParentResponse: false,
        updatedAt: serverTimestamp(),
      });

      return {
        ok: true,
        entry: {
          ...mapJournalEntryDocument({
            id: entrySnapshot.id,
            ...(entrySnapshot.data() as JournalEntryDocument),
          }),
          parentReaction: response.reaction,
          parentNote: note,
          needsParentResponse: false,
        },
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describeJournalMutationError(error, 'reply'),
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

function normalizeJournalDraft(draft: {
  accomplished: string;
  learned: string;
  proudOf: string;
}) {
  const accomplished = draft.accomplished.trim();
  const learned = draft.learned.trim();
  const proudOf = draft.proudOf.trim();

  if (!accomplished || !learned || !proudOf) {
    return null;
  }

  return {
    accomplished,
    learned,
    proudOf,
  };
}

function mapJournalEntryDocument(document: JournalEntryDocument & { id: string }): JournalEntry {
  const reaction = document.parentReaction === 'Heart' || document.parentReaction === 'Star'
    ? document.parentReaction
    : undefined;
  const parentNote = document.parentNote?.trim() || undefined;
  const needsParentResponse =
    document.needsParentResponse ?? (!reaction && !parentNote);

  return {
    id: document.journalEntryId?.trim() || document.id,
    childId: document.childId?.trim() || '',
    date: document.date?.trim() || new Date().toISOString(),
    accomplished: document.accomplished?.trim() || '',
    learned: document.learned?.trim() || '',
    proudOf: document.proudOf?.trim() || '',
    parentReaction: reaction,
    parentNote,
    needsParentResponse,
  };
}

function hasJournalContentChanged(
  entry: JournalEntry,
  draft: {
    accomplished: string;
    learned: string;
    proudOf: string;
  },
) {
  return entry.accomplished !== draft.accomplished || entry.learned !== draft.learned || entry.proudOf !== draft.proudOf;
}

function describeJournalMutationError(error: unknown, action: 'reply' | 'save') {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'invalid-argument':
    case 'firestore/invalid-argument':
      return 'The journal entry has a value that could not be saved. Check it and try again.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return `That journal ${action} action is not allowed right now.`;
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while saving the journal. Check the network and try again.";
    default:
      return `The journal ${action} action could not be completed right now.`;
  }
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}
