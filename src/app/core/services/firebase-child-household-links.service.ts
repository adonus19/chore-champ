import { Injectable, inject } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { ChildProfile, HouseholdSwitchPolicy } from '../models/family.models';
import { FirebaseChildProfilesService } from './firebase-child-profiles.service';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const CHILD_LINK_EXPIRATION_DAYS = 7;
const CHILD_LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOUSEHOLDS_COLLECTION = 'households';
const MEMBERS_SUBCOLLECTION = 'members';
const CHILD_STATE_SUBCOLLECTION = 'childState';

interface ChildLinkDocument {
  childPersonId?: string;
  createdByPersonId?: string;
  expiresAt?: Timestamp;
  sourceHouseholdId?: string;
  status?: 'pending' | 'accepted' | 'expired' | 'revoked';
  targetHouseholdId?: string | null;
}

export interface ChildHouseholdLinkCreateResult {
  childName?: string;
  code?: string;
  expiresAtLabel?: string;
  message?: string;
  ok: boolean;
  source?: 'firebase';
}

export interface ChildHouseholdLinkAcceptResult {
  child?: ChildProfile;
  childName?: string;
  message?: string;
  ok: boolean;
  source?: 'firebase';
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseChildHouseholdLinksService {
  private readonly firebaseChildProfiles = inject(FirebaseChildProfilesService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;

  async createChildHouseholdLink(childId: string): Promise<ChildHouseholdLinkCreateResult> {
    const firestore = this.firestore;
    const viewerProfile = this.firebaseUserProfile.currentProfile();

    if (!firestore) {
      return {
        ok: false,
        message: 'Child household linking is not ready for this build yet.',
      };
    }

    if (!viewerProfile || viewerProfile.role !== 'parent' || !viewerProfile.householdId || !viewerProfile.personId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh the session and try again.',
      };
    }

    const householdId = viewerProfile.householdId;
    const code = createChildLinkCode();
    const linkRef = doc(firestore, environment.firebase.childLinkCollection, code);
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + CHILD_LINK_EXPIRATION_DAYS * 24 * 60 * 60 * 1000));

    try {
      await setDoc(linkRef, {
        linkId: code,
        childPersonId: childId,
        sourceHouseholdId: householdId,
        targetHouseholdId: null,
        createdByPersonId: viewerProfile.personId,
        intendedChildPolicies: {
          householdSwitchPolicy: 'parentOnly',
        },
        status: 'pending',
        acceptedByPersonId: null,
        acceptedAt: null,
        expiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        ok: true,
        code: formatChildLinkCode(code),
        childName: childId,
        expiresAtLabel: formatLinkExpiration(expiresAt.toDate()),
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describeChildLinkCreateError(error),
      };
    }
  }

  async acceptChildHouseholdLink(
    rawCode: string,
    switchPolicy: HouseholdSwitchPolicy,
    fallbackModeId: string,
  ): Promise<ChildHouseholdLinkAcceptResult> {
    const firestore = this.firestore;
    const viewerProfile = this.firebaseUserProfile.currentProfile();
    const code = normalizeChildLinkCode(rawCode);

    if (!firestore) {
      return {
        ok: false,
        message: 'Firestore is not configured yet. Add your Firebase keys before linking an existing child.',
      };
    }

    if (!viewerProfile || viewerProfile.role !== 'parent' || !viewerProfile.householdId || !viewerProfile.personId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh the session and try again.',
      };
    }

    if (!code) {
      return {
        ok: false,
        message: 'Paste a valid child household link code first.',
      };
    }

    const householdId = viewerProfile.householdId;
    const linkRef = doc(firestore, environment.firebase.childLinkCollection, code);

    try {
      const childId = await runTransaction(firestore, async (transaction) => {
        const linkSnapshot = await transaction.get(linkRef);

        if (!linkSnapshot.exists()) {
          throw new Error('child-link-missing');
        }

        const link = linkSnapshot.data() as ChildLinkDocument;

        if (!link.childPersonId || !link.sourceHouseholdId) {
          throw new Error('child-link-invalid');
        }

        if (link.status !== 'pending') {
          throw new Error(link.status === 'accepted' ? 'child-link-accepted' : 'child-link-closed');
        }

        if (link.expiresAt && link.expiresAt.toMillis() <= Date.now()) {
          throw new Error('child-link-expired');
        }

        if (link.sourceHouseholdId === householdId) {
          throw new Error('child-link-same-household');
        }

        const membershipRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, link.childPersonId);
        const childStateRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, CHILD_STATE_SUBCOLLECTION, link.childPersonId);
        const membershipSnapshot = await transaction.get(membershipRef);

        if (membershipSnapshot.exists()) {
          throw new Error('child-link-already-member');
        }

        transaction.set(membershipRef, {
          personId: link.childPersonId,
          role: 'child',
          status: 'active',
          childPolicies: {
            householdSwitchPolicy: switchPolicy,
          },
          linkedByChildLinkId: code,
          joinedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(childStateRef, {
          childPersonId: link.childPersonId,
          points: 0,
          streakDays: 0,
          activeModeId: fallbackModeId,
          currentBook: null,
          currentLifeSkill: null,
          sportsGoal: null,
          yearGoal: null,
          linkedByChildLinkId: code,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.update(linkRef, {
          targetHouseholdId: householdId,
          acceptedByPersonId: viewerProfile.personId,
          acceptedAt: serverTimestamp(),
          acceptedChildPolicies: {
            householdSwitchPolicy: switchPolicy,
          },
          status: 'accepted',
          updatedAt: serverTimestamp(),
        });

        return link.childPersonId;
      });

      const child = await this.firebaseChildProfiles.loadChildForHousehold(householdId, childId, fallbackModeId);

      return {
        ok: true,
        child: child ?? undefined,
        childName: child?.name ?? childId,
        source: 'firebase',
      };
    } catch (error) {
      return {
        ok: false,
        message: describeChildLinkAcceptError(error),
      };
    }
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

function createChildLinkCode() {
  let code = '';

  for (let index = 0; index < 10; index += 1) {
    code += CHILD_LINK_CODE_ALPHABET[Math.floor(Math.random() * CHILD_LINK_CODE_ALPHABET.length)];
  }

  return code;
}

export function normalizeChildLinkCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatChildLinkCode(value: string) {
  const normalized = normalizeChildLinkCode(value);

  return normalized.replace(/(.{5})(?=.)/g, '$1-');
}

function formatLinkExpiration(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function describeChildLinkCreateError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';

  switch (message) {
    case 'child-membership-missing':
      return 'This child is not active in the current household anymore, so a share code could not be created.';
    case 'child-membership-inactive':
      return 'This child is not currently active in the household, so a share code could not be created.';
    case 'child-profile-missing':
      return 'The child profile could not be found while creating the household link. Refresh and try again.';
    default:
      break;
  }

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'That child household link could not be created right now.';
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while creating that child link. Check the network and try again.";
    case 'resource-exhausted':
    case 'firestore/resource-exhausted':
      return 'The server temporarily slowed child linking after too many requests. Wait a minute, then try again.';
    default:
      return 'The child household link could not be created right now.';
  }
}

function describeChildLinkAcceptError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';

  switch (message) {
    case 'child-link-missing':
      return 'That child household link code was not found. Check the code and try again.';
    case 'child-link-invalid':
      return 'That child household link is missing required data. Generate a fresh code and try again.';
    case 'child-link-accepted':
      return 'That child household link has already been accepted by another household.';
    case 'child-link-closed':
      return 'That child household link is no longer active. Generate a fresh code and try again.';
    case 'child-link-expired':
      return 'That child household link code has expired. Generate a fresh code from the source household.';
    case 'child-link-same-household':
      return 'That link was created from this same household, so there is nothing new to add here.';
    case 'child-link-already-member':
      return 'This household already has that child in its roster.';
    default:
      break;
  }

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'That child could not be linked to this household right now.';
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while linking that child to this household. Check the network and try again.";
    case 'resource-exhausted':
    case 'firestore/resource-exhausted':
      return 'The server temporarily slowed child linking after too many requests. Wait a minute, then try again.';
    default:
      return 'That child could not be linked into this household right now.';
  }
}
