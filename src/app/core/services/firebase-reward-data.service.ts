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
import { AuthBootstrapProfile, Reward, RewardRedemption } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const CHILD_STATE_SUBCOLLECTION = 'childState';
const REWARD_REDEMPTIONS_SUBCOLLECTION = 'rewardRedemptions';

interface RewardRedemptionDocument extends Omit<RewardRedemption, 'id'> {
  redemptionId?: string;
}

export interface RewardMutationResult {
  message?: string;
  ok: boolean;
  redemption?: RewardRedemption;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseRewardDataService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _rewardRedemptions = signal<RewardRedemption[] | null>(null);
  readonly rewardRedemptions = this._rewardRedemptions.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private rewardsSubscription: Unsubscribe | null = null;
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
    this._rewardRedemptions.set([]);
    this._lastSyncError.set('');

    const redemptionsQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, REWARD_REDEMPTIONS_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, REWARD_REDEMPTIONS_SUBCOLLECTION));

    this.rewardsSubscription = onSnapshot(
      redemptionsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({
          id: item.id,
          ...(item.data() as RewardRedemptionDocument),
        }));

        this._rewardRedemptions.set(
          items
            .map((item) => mapRewardRedemptionDocument(item))
            .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
        );
        this._lastSyncError.set('');
      },
      () => {
        this._lastSyncError.set("We couldn't keep reward requests updated right now.");
      },
    );
  }

  async loadSnapshot(profile: AuthBootstrapProfile): Promise<RewardRedemption[]> {
    const firestore = this.firestore;
    const householdId = profile.householdId ?? '';

    if (!firestore || !householdId || profile.source !== 'authAccount') {
      return [];
    }

    const redemptionsQuery =
      profile.role === 'child'
        ? query(
            collection(firestore, HOUSEHOLDS_COLLECTION, householdId, REWARD_REDEMPTIONS_SUBCOLLECTION),
            where('childId', '==', profile.personId),
          )
        : query(collection(firestore, HOUSEHOLDS_COLLECTION, householdId, REWARD_REDEMPTIONS_SUBCOLLECTION));
    const snapshot = await getDocs(redemptionsQuery);

    return snapshot.docs
      .map((item) => mapRewardRedemptionDocument({ id: item.id, ...(item.data() as RewardRedemptionDocument) }))
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  stopSync() {
    this.rewardsSubscription?.();
    this.rewardsSubscription = null;
    this.currentSyncKey = '';
    this._rewardRedemptions.set(null);
    this._lastSyncError.set('');
  }

  async redeemReward(reward: Reward, childId: string): Promise<RewardMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'Reward requests are not ready yet. Refresh and try again.',
      };
    }

    if (!reward.active) {
      return {
        ok: false,
        message: 'That reward is not active right now.',
      };
    }

    try {
      const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, childId);
      const rewardRequestsSnapshot = await getDocs(
        query(
          collection(firestore, HOUSEHOLDS_COLLECTION, householdId, REWARD_REDEMPTIONS_SUBCOLLECTION),
          where('childId', '==', childId),
        ),
      );
      const childStateSnapshot = await getDoc(childStateRef);

      const availablePoints = Math.max(
        0,
        Math.round((childStateSnapshot.data()?.['points'] as number | undefined) ?? 0) -
          rewardRequestsSnapshot.docs.reduce((sum, item) => {
            const redemption = mapRewardRedemptionDocument({
              id: item.id,
              ...(item.data() as RewardRedemptionDocument),
            });

            return redemption.status === 'pending' || redemption.status === 'fulfilled'
              ? sum + redemption.pointCost
              : sum;
          }, 0),
      );
      const hasPendingRequest = rewardRequestsSnapshot.docs.some((item) => {
        const redemption = item.data() as RewardRedemptionDocument;

        return redemption.rewardId === reward.id && redemption.status === 'pending';
      });

      if (hasPendingRequest) {
        return {
          ok: false,
          message: 'That reward is already waiting for a parent review.',
        };
      }

      if (availablePoints < reward.pointCost) {
        return {
          ok: false,
          message: `This reward needs ${reward.pointCost} points, but only ${availablePoints} are still available to spend.`,
        };
      }

      const redemptionRef = doc(
        collection(firestore, HOUSEHOLDS_COLLECTION, householdId, REWARD_REDEMPTIONS_SUBCOLLECTION),
      );
      const redemption: RewardRedemption = {
        id: redemptionRef.id,
        rewardId: reward.id,
        childId,
        requestedAt: new Date().toISOString(),
        status: reward.requiresParentApproval ? 'pending' : 'fulfilled',
        pointCost: reward.pointCost,
        note: reward.requiresParentApproval
          ? 'Points are reserved while a parent reviews this reward request.'
          : 'Reward redeemed from the family reward store.',
      };

      await setDoc(redemptionRef, {
        redemptionId: redemption.id,
        rewardId: redemption.rewardId,
        childId: redemption.childId,
        requestedAt: redemption.requestedAt,
        status: redemption.status,
        pointCost: redemption.pointCost,
        note: redemption.note,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { ok: true, redemption };
    } catch (error) {
      return {
        ok: false,
        message: describeRewardMutationError(error, 'redeem'),
      };
    }
  }

  async approveRewardRequest(redemptionId: string): Promise<RewardMutationResult> {
    return this.updateRewardRequest(redemptionId, 'fulfilled');
  }

  async declineRewardRequest(redemptionId: string): Promise<RewardMutationResult> {
    return this.updateRewardRequest(redemptionId, 'declined');
  }

  private async updateRewardRequest(
    redemptionId: string,
    status: 'declined' | 'fulfilled',
  ): Promise<RewardMutationResult> {
    const firestore = this.firestore;
    const householdId = this.householdIdForWrites();

    if (!firestore || !householdId) {
      return {
        ok: false,
        message: 'Reward reviews are not ready yet. Refresh and try again.',
      };
    }

    const redemptionRef = doc(
      firestore,
      HOUSEHOLDS_COLLECTION,
      householdId,
      REWARD_REDEMPTIONS_SUBCOLLECTION,
      redemptionId,
    );

    try {
      const redemptionSnapshot = await getDoc(redemptionRef);

      if (!redemptionSnapshot.exists()) {
        throw new Error('redemption-missing');
      }

      const redemption = redemptionSnapshot.data() as RewardRedemptionDocument;

      if (redemption.status !== 'pending') {
        return {
          ok: true,
          redemption: mapRewardRedemptionDocument({
            id: redemptionSnapshot.id,
            ...redemption,
          }),
        };
      }
      const updatedRedemption: RewardRedemption = {
        ...mapRewardRedemptionDocument({
          id: redemptionSnapshot.id,
          ...redemption,
        }),
        status,
        note:
          status === 'fulfilled'
            ? 'Reward approved by a parent and moved into the family plan.'
            : 'Reward request declined by a parent. The reserved points are available again.',
      };

      await updateDoc(redemptionRef, {
        status: updatedRedemption.status,
        note: updatedRedemption.note,
        updatedAt: serverTimestamp(),
      });

      return { ok: true, redemption: updatedRedemption };
    } catch (error) {
      return {
        ok: false,
        message: describeRewardMutationError(error, status === 'fulfilled' ? 'approve' : 'decline'),
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

function mapRewardRedemptionDocument(document: RewardRedemptionDocument & { id: string }): RewardRedemption {
  return {
    id: document.redemptionId?.trim() || document.id,
    rewardId: document.rewardId?.trim() || '',
    childId: document.childId?.trim() || '',
    requestedAt: document.requestedAt?.trim() || new Date().toISOString(),
    status: document.status ?? 'pending',
    pointCost: Math.max(0, Math.round(document.pointCost ?? 0)),
    note: document.note?.trim() || undefined,
  };
}

function describeRewardMutationError(
  error: unknown,
  action: 'approve' | 'decline' | 'redeem',
) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';

  switch (message) {
    case 'redemption-missing':
      return 'That reward request could not be found. Refresh the reward queue and try again.';
    default:
      break;
  }

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return `That reward ${action} action is not allowed right now.`;
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while saving reward data. Check the network and try again.";
    default:
      return `The reward ${action} action could not be completed right now.`;
  }
}
