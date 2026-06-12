import { Injectable, inject, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Unsubscribe,
  collectionGroup,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  where,
  query,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { AuthBootstrapProfile, HouseholdSwitchPolicy } from '../models/family.models';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const MEMBERS_SUBCOLLECTION = 'members';

interface HouseholdDocument {
  householdId?: string;
  name?: string;
  householdName?: string;
  status?: string;
  title?: string;
  profile?: {
    name?: string;
  };
  settings?: {
    householdName?: string;
    title?: string;
  };
}

interface MembershipDocument {
  personId?: string;
  role?: string;
  status?: string;
  childPolicies?: {
    householdSwitchPolicy?: HouseholdSwitchPolicy;
  };
}

interface AuthAccountDocument {
  accountType?: 'parent' | 'child';
  defaultHouseholdId?: string | null;
  lastActiveHouseholdId?: string | null;
  personId?: string;
}

export interface HouseholdAccessOption {
  childSwitchPolicy?: HouseholdSwitchPolicy;
  householdId: string;
  name: string;
  role: 'child' | 'owner' | 'parent_admin' | 'parent_member';
  selfSwitchAllowed: boolean;
}

export interface HouseholdAccessMutationResult {
  householdId?: string;
  message?: string;
  ok: boolean;
  source?: 'firebase' | 'local';
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseHouseholdAccessService {
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;
  private readonly _accessibleHouseholds = signal<HouseholdAccessOption[] | null>(null);
  readonly accessibleHouseholds = this._accessibleHouseholds.asReadonly();
  private readonly _currentHouseholdName = signal<string | null>(null);
  readonly currentHouseholdName = this._currentHouseholdName.asReadonly();
  private readonly _lastSyncError = signal('');
  readonly lastSyncError = this._lastSyncError.asReadonly();
  private membershipsSubscription: Unsubscribe | null = null;
  private currentHouseholdSubscription: Unsubscribe | null = null;
  private currentSyncKey = '';
  private currentHouseholdKey = '';
  private currentLoadToken = 0;

  startSync(profile: AuthBootstrapProfile) {
    const firestore = this.firestore;
    const membershipPersonIds = resolveMembershipPersonIds(profile);

    if (!firestore || profile.source !== 'authAccount' || membershipPersonIds.length === 0) {
      this.stopSync();
      return;
    }

    const syncKey = `${profile.uid}:${profile.role}:${membershipPersonIds.join('|')}`;

    if (this.currentSyncKey === syncKey) {
      this.startCurrentHouseholdSync(profile.householdId ?? '');
      return;
    }

    this.stopSync();
    this.currentSyncKey = syncKey;
    this._accessibleHouseholds.set(null);
    this._lastSyncError.set('');
    this.startCurrentHouseholdSync(profile.householdId ?? '');

    const membershipFilter =
      membershipPersonIds.length === 1
        ? where('personId', '==', membershipPersonIds[0])
        : where('personId', 'in', membershipPersonIds);

    this.membershipsSubscription = onSnapshot(
      query(collectionGroup(firestore, MEMBERS_SUBCOLLECTION), membershipFilter),
      (snapshot) => {
        void this.hydrateHouseholds(snapshot.docs);
      },
      () => {
        this._lastSyncError.set('Firestore could not keep the household access list in sync for this account.');
      },
    );
  }

  stopSync() {
    this.membershipsSubscription?.();
    this.membershipsSubscription = null;
    this.currentHouseholdSubscription?.();
    this.currentHouseholdSubscription = null;
    this.currentSyncKey = '';
    this.currentHouseholdKey = '';
    this.currentLoadToken = 0;
    this._accessibleHouseholds.set(null);
    this._currentHouseholdName.set(null);
    this._lastSyncError.set('');
  }

  async switchCurrentHousehold(targetHouseholdId: string): Promise<HouseholdAccessMutationResult> {
    const firestore = this.firestore;
    const profile = this.firebaseUserProfile.currentProfile();
    const target = (this.accessibleHouseholds() ?? []).find((option) => option.householdId === targetHouseholdId);

    if (!firestore || !profile || profile.source !== 'authAccount') {
      return {
        ok: false,
        message: 'The signed-in household context is not ready yet. Refresh and try again.',
      };
    }

    if (!target) {
      return {
        ok: false,
        message: 'That household is not available for this signed-in account.',
      };
    }

    if (profile.role === 'child' && !target.selfSwitchAllowed) {
      return {
        ok: false,
        message: 'A parent controls household switching for this child account right now.',
      };
    }

    if (profile.householdId === targetHouseholdId && profile.defaultHouseholdId === targetHouseholdId) {
      return {
        ok: true,
        householdId: targetHouseholdId,
        source: 'firebase',
      };
    }

    try {
      await updateDoc(doc(firestore, environment.firebase.authAccountCollection, profile.uid), {
        defaultHouseholdId: targetHouseholdId,
        lastActiveHouseholdId: targetHouseholdId,
        updatedAt: serverTimestamp(),
      });
      await this.firebaseUserProfile.refreshCurrentProfile();

      return {
        ok: true,
        householdId: targetHouseholdId,
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describeHouseholdMutationError(error, 'switch'),
      };
    }
  }

  async pointChildAccountToCurrentHousehold(
    childId: string,
    childAuthUid: string,
  ): Promise<HouseholdAccessMutationResult> {
    const firestore = this.firestore;
    const profile = this.firebaseUserProfile.currentProfile();
    const currentHouseholdId = profile?.householdId ?? '';

    if (!firestore || !profile || profile.source !== 'authAccount' || profile.role !== 'parent' || !currentHouseholdId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh and try again.',
      };
    }

    if (!childAuthUid) {
      return {
        ok: false,
        message: 'This child does not have sign-in enabled yet, so there is no household target to switch.',
      };
    }

    const membershipRef = doc(firestore, HOUSEHOLDS_COLLECTION, currentHouseholdId, MEMBERS_SUBCOLLECTION, childId);
    const authAccountRef = doc(firestore, environment.firebase.authAccountCollection, childAuthUid);

    try {
      const [membershipSnapshot, authAccountSnapshot] = await Promise.all([getDoc(membershipRef), getDoc(authAccountRef)]);

      if (!membershipSnapshot.exists()) {
        return {
          ok: false,
          message: 'This child is not linked to the current household yet, so the account cannot point here.',
        };
      }

      if (!authAccountSnapshot.exists()) {
        return {
          ok: false,
          message: 'The child sign-in account could not be found. Reopen the child login setup before trying again.',
        };
      }

      const authAccount = authAccountSnapshot.data() as AuthAccountDocument;

      if (authAccount.accountType !== 'child' || authAccount.personId !== childId) {
        return {
          ok: false,
          message: 'The child sign-in account is not linked to the expected child profile.',
        };
      }

      if (authAccount.defaultHouseholdId === currentHouseholdId && authAccount.lastActiveHouseholdId === currentHouseholdId) {
        return {
          ok: true,
          householdId: currentHouseholdId,
          source: 'firebase',
        };
      }

      await updateDoc(authAccountRef, {
        defaultHouseholdId: currentHouseholdId,
        lastActiveHouseholdId: currentHouseholdId,
        updatedAt: serverTimestamp(),
      });

      return {
        ok: true,
        householdId: currentHouseholdId,
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describeHouseholdMutationError(error, 'point-child'),
      };
    }
  }

  private async hydrateHouseholds(
    membershipDocs: Array<{
      data(): MembershipDocument;
      ref: {
        parent: {
          parent: {
            id: string;
          } | null;
        };
      };
    }>,
  ) {
    const firestore = this.firestore;

    if (!firestore) {
      return;
    }

    try {
      const loadToken = ++this.currentLoadToken;
      const membershipsByHousehold = new Map<
        string,
        {
          householdId: string;
          role: HouseholdAccessOption['role'];
          childSwitchPolicy?: HouseholdSwitchPolicy;
        }
      >();

      for (const snapshot of membershipDocs) {
        const data = snapshot.data();
        const householdId = snapshot.ref.parent.parent?.id ?? '';
        const role = normalizeMembershipRole(data.role);

        if (!householdId || data.status !== 'active' || !role) {
          continue;
        }

        membershipsByHousehold.set(householdId, {
          householdId,
          role,
          childSwitchPolicy: data.childPolicies?.householdSwitchPolicy ?? undefined,
        });
      }

      const memberships = [...membershipsByHousehold.values()];

      const households = await Promise.all(
        memberships.map(async (membership) => {
          try {
            const householdSnapshot = await getDoc(doc(firestore, HOUSEHOLDS_COLLECTION, membership.householdId));
            const householdData = householdSnapshot.exists() ? (householdSnapshot.data() as HouseholdDocument) : null;

            return {
              householdId: membership.householdId,
              name: normalizeHouseholdName(householdData, membership.householdId),
              role: membership.role,
              childSwitchPolicy: membership.childSwitchPolicy,
              selfSwitchAllowed:
                membership.role === 'child' ? membership.childSwitchPolicy === 'childAllowed' : true,
            } satisfies HouseholdAccessOption;
          } catch {
            return {
              householdId: membership.householdId,
              name: fallbackHouseholdName(),
              role: membership.role,
              childSwitchPolicy: membership.childSwitchPolicy,
              selfSwitchAllowed:
                membership.role === 'child' ? membership.childSwitchPolicy === 'childAllowed' : true,
            } satisfies HouseholdAccessOption;
          }
        }),
      );

      if (loadToken !== this.currentLoadToken) {
        return;
      }

      this._accessibleHouseholds.set(households.sort((left, right) => left.name.localeCompare(right.name)));
      this._lastSyncError.set('');
    } catch {
      this._lastSyncError.set('Firestore could not finish loading the accessible household list for this account.');
    }
  }

  private startCurrentHouseholdSync(householdId: string) {
    const firestore = this.firestore;

    if (!firestore) {
      return;
    }

    if (!householdId) {
      this.currentHouseholdSubscription?.();
      this.currentHouseholdSubscription = null;
      this.currentHouseholdKey = '';
      this._currentHouseholdName.set(null);
      return;
    }

    if (this.currentHouseholdKey === householdId) {
      return;
    }

    this.currentHouseholdSubscription?.();
    this.currentHouseholdSubscription = null;
    this.currentHouseholdKey = householdId;
    this._currentHouseholdName.set(null);

    this.currentHouseholdSubscription = onSnapshot(
      doc(firestore, HOUSEHOLDS_COLLECTION, householdId),
      (snapshot) => {
        const household = snapshot.exists() ? (snapshot.data() as HouseholdDocument) : null;
        this._currentHouseholdName.set(normalizeHouseholdName(household, householdId));
      },
      () => {
        this._currentHouseholdName.set(null);
      },
    );
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

function normalizeMembershipRole(role: string | undefined) {
  switch (role) {
    case 'owner':
    case 'parent_admin':
    case 'parent_member':
    case 'child':
      return role;
    default:
      return null;
  }
}

function resolveMembershipPersonIds(profile: AuthBootstrapProfile) {
  if (profile.role !== 'child') {
    return profile.personId ? [profile.personId] : [];
  }

  const personIds = [profile.childId, profile.personId]
    .map((value) => value?.trim() ?? '')
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);

  return personIds;
}

function normalizeHouseholdName(household: HouseholdDocument | null, householdId: string) {
  const trimmedName = [
    household?.name,
    household?.householdName,
    household?.title,
    household?.profile?.name,
    household?.settings?.householdName,
    household?.settings?.title,
  ]
    .map((value) => value?.trim() ?? '')
    .find((value) => value.length > 0) ?? '';

  if (trimmedName) {
    return trimmedName;
  }

  return fallbackHouseholdName(householdId);
}

function fallbackHouseholdName(_householdId?: string) {
  return 'Family household';
}

function describeHouseholdMutationError(error: unknown, action: 'switch' | 'point-child') {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return action === 'switch'
        ? 'Firestore blocked this household switch. Update the household-switch security rules before trying again.'
        : 'Firestore blocked the parent-controlled household switch. Update the child household-switch security rules before trying again.';
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached while switching households. Check the network and try again.';
    default:
      return action === 'switch'
        ? 'The household switch could not be completed right now.'
        : 'The child household target could not be updated right now.';
  }
}
