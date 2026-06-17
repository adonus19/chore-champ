import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Unsubscribe,
  collection,
  connectFirestoreEmulator,
  doc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, BonusMoment } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const CHILD_STATE_SUBCOLLECTION = 'childState';
const BONUS_MOMENTS_SUBCOLLECTION = 'bonusMoments';

interface BonusMomentDocument extends Omit<BonusMoment, 'id'> {
  bonusId?: string;
}

export interface BonusMutationResult {
  bonusMoment?: BonusMoment;
  message?: string;
  ok: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseBonusDataService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _bonusMoments = signal<BonusMoment[] | null>(null);
  readonly bonusMoments = this._bonusMoments.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private bonusSubscription: Unsubscribe | null = null;
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
    this._bonusMoments.set([]);
    this._lastSyncError.set('');

    const bonusQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, BONUS_MOMENTS_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, BONUS_MOMENTS_SUBCOLLECTION));

    this.bonusSubscription = onSnapshot(
      bonusQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as BonusMomentDocument),
        }));

        this._bonusMoments.set(
          items
            .map((item) => mapBonusMomentDocument(item))
            .sort((left, right) => right.awardedAt.localeCompare(left.awardedAt)),
        );
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set("We couldn't keep bonus points updated right now.");
      },
    );
  }

  async loadSnapshot(profile: AuthBootstrapProfile): Promise<BonusMoment[]> {
    const firestore = this.firestore;
    const householdId = profile.householdId ?? '';

    if (!firestore || !householdId || profile.source !== 'authAccount') {
      return [];
    }

    const bonusQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, BONUS_MOMENTS_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, BONUS_MOMENTS_SUBCOLLECTION));
    const snapshot = await getDocs(bonusQuery);

    return snapshot.docs
      .map((item) => mapBonusMomentDocument({ id: item.id, ...(item.data() as BonusMomentDocument) }))
      .sort((left, right) => right.awardedAt.localeCompare(left.awardedAt));
  }

  stopSync() {
    this.bonusSubscription?.();
    this.bonusSubscription = null;
    this.currentSyncKey = '';
    this._bonusMoments.set(null);
    this._lastSyncError.set('');
  }

  async awardBonusPoints(childId: string, points: number, note: string): Promise<BonusMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();
    const normalizedPoints = Math.max(1, Math.round(points));
    const normalizedNote = note.trim();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'Bonus points are not ready yet. Refresh and try again.',
      };
    }

    if (!childId || !normalizedNote) {
      return {
        ok: false,
        message: 'Choose a child and add a short note before awarding bonus points.',
      };
    }

    try {
      const bonusRef = doc(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, BONUS_MOMENTS_SUBCOLLECTION));
      const bonusMoment: BonusMoment = {
        id: bonusRef.id,
        childId,
        points: normalizedPoints,
        awardedAt: new Date().toISOString(),
        note: normalizedNote,
      };

      await runTransaction(firestore, async (transaction) => {
        const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId);

        transaction.set(bonusRef, {
          bonusId: bonusMoment.id,
          childId: bonusMoment.childId,
          points: bonusMoment.points,
          awardedAt: bonusMoment.awardedAt,
          note: bonusMoment.note,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(
          childStateRef,
          {
            childPersonId: childId,
            points: increment(normalizedPoints),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });

      return { ok: true, bonusMoment };
    } catch (error) {
      return {
        ok: false,
        message: describeBonusMutationError(error),
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

function mapBonusMomentDocument(document: BonusMomentDocument & { id: string }): BonusMoment {
  return {
    id: document.bonusId?.trim() || document.id,
    childId: document.childId?.trim() || '',
    points: Math.max(1, Math.round(document.points ?? 1)),
    awardedAt: document.awardedAt?.trim() || new Date().toISOString(),
    note: document.note?.trim() || '',
  };
}

function describeBonusMutationError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'That bonus point award is not allowed right now.';
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while awarding bonus points. Check the network and try again.";
    default:
      return 'The bonus points could not be awarded right now.';
  }
}
