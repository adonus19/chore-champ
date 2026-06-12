import { Injectable, inject } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseUserProfileService } from './firebase-user-profile.service';

const HOUSEHOLDS_COLLECTION = 'households';
const MEMBERS_SUBCOLLECTION = 'members';

interface ParentInviteDraft {
  displayName: string;
  email: string;
  themeColor: string;
  password: string;
}

interface ParentInviteResult {
  ok: boolean;
  message?: string;
  parent?: {
    displayName: string;
    email: string;
    personId: string;
  };
}

// Full co-parent permission set. Mirrors the owner bootstrap permissions so an invited parent can run the
// household, including inviting further parents. The original creator stays role 'owner' so a later flow can
// reserve parent/child removal for the owner.
const COPARENT_PERMISSIONS = {
  canManageChildren: true,
  canManageQuests: true,
  canApproveRewards: true,
  canInviteParents: true,
  canManageChildCredentials: true,
} as const;

@Injectable({
  providedIn: 'root',
})
export class FirebaseHouseholdParentsService {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;

  async inviteParent(draft: ParentInviteDraft): Promise<ParentInviteResult> {
    const firestore = this.firestore;
    const viewerProfile = this.firebaseUserProfile.currentProfile();
    const normalizedDraft = normalizeParentInviteDraft(draft);

    if (!firestore) {
      return {
        ok: false,
        message: 'Firestore is not configured yet. Add your Firebase keys before inviting another parent.',
      };
    }

    if (!viewerProfile || viewerProfile.role !== 'parent' || !viewerProfile.householdId) {
      return {
        ok: false,
        message: 'The signed-in parent household context is not ready yet. Refresh the session and try again.',
      };
    }

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'Add the parent name, email, and theme color before sending the invite.',
      };
    }

    if (normalizedDraft.password.length < 6) {
      return {
        ok: false,
        message: 'The temporary password needs at least 6 characters.',
      };
    }

    const householdId = viewerProfile.householdId;

    // Mint the new parent's Firebase Auth user on a throwaway secondary app so the inviting parent stays
    // signed in. This matches how child sign-in accounts are provisioned.
    const authCreateResult = await this.firebaseAuth.createSecondaryUserWithEmailPassword(
      normalizedDraft.email,
      normalizedDraft.password,
    );

    if (!authCreateResult.ok || !authCreateResult.uid) {
      return {
        ok: false,
        message: authCreateResult.message ?? 'The co-parent sign-in account could not be created right now.',
      };
    }

    const uid = authCreateResult.uid;
    const personId = `person_${uid}`;
    const authAccountRef = doc(firestore, environment.firebase.authAccountCollection, uid);
    const personRef = doc(firestore, environment.firebase.peopleCollection, personId);
    const membershipRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdId, MEMBERS_SUBCOLLECTION, personId);

    try {
      // A WriteBatch (not a transaction) keeps the three creates atomic without reading the new parent's
      // authAccounts doc first — the inviting parent has no read permission on another parent's account, and
      // the freshly minted uid guarantees the doc cannot already exist. The create rules enforce !exists().
      const batch = writeBatch(firestore);

      batch.set(authAccountRef, {
        uid,
        personId,
        accountType: 'parent',
        status: 'active',
        defaultHouseholdId: householdId,
        lastActiveHouseholdId: householdId,
        login: {
          provider: 'password',
          email: normalizedDraft.email,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(personRef, {
        personId,
        type: 'parent',
        displayName: normalizedDraft.displayName,
        avatarUrl: null,
        themeColor: normalizedDraft.themeColor,
        status: 'active',
        createdByPersonId: viewerProfile.personId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(membershipRef, {
        personId,
        role: 'parent_admin',
        status: 'active',
        permissions: { ...COPARENT_PERMISSIONS },
        invitedByPersonId: viewerProfile.personId,
        joinedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      await authCreateResult.cleanup?.();

      return {
        ok: true,
        parent: {
          displayName: normalizedDraft.displayName,
          email: normalizedDraft.email,
          personId,
        },
      };
    } catch (error) {
      await authCreateResult.rollback?.();
      return {
        ok: false,
        message: describeParentInviteError(error),
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

function normalizeParentInviteDraft(draft: ParentInviteDraft) {
  const displayName = draft.displayName.trim();
  const email = draft.email.trim().toLowerCase();
  const themeColor = draft.themeColor.trim();
  const password = draft.password.trim();

  if (!displayName || !email || !themeColor) {
    return null;
  }

  return {
    displayName,
    email,
    themeColor,
    password,
  };
}

function describeParentInviteError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firestore blocked the co-parent invite write. Deploy the parent-invite security rules from FIREBASE_SETUP.md before trying again.';
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached while inviting the parent. Check the network and try again.';
    default:
      return 'The co-parent account was created in Firebase Auth, but the household membership write could not finish yet.';
  }
}
