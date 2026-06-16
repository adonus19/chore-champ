import { Injectable, inject } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { FirebaseAuthService } from './firebase-auth.service';

const HOUSEHOLDS_COLLECTION = 'households';
const MEMBERS_SUBCOLLECTION = 'members';

interface ParentBootstrapDraft {
  displayName: string;
  email: string;
  householdName: string;
}

interface BootstrapResult {
  ok: boolean;
  created?: boolean;
  householdId?: string;
  message?: string;
}

interface ExistingAuthAccount {
  personId?: string;
  accountType?: 'parent' | 'child';
  defaultHouseholdId?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseAccountBootstrapService {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;

  async bootstrapCurrentParentAccount(draft: ParentBootstrapDraft): Promise<BootstrapResult> {
    const firestore = this.firestore;
    const currentUser = this.firebaseAuth.currentUser();
    const normalizedDraft = normalizeParentBootstrapDraft(draft);

    if (!firestore) {
      return {
        ok: false,
        message: 'Family setup is not ready for this build yet.',
      };
    }

    if (!currentUser?.uid) {
      return {
        ok: false,
        message: 'Sign in or create the parent account first, then finish setup.',
      };
    }

    if (!normalizedDraft) {
      return {
        ok: false,
        message: 'Add a parent name, email, and household name before creating the family workspace.',
      };
    }

    const uid = currentUser.uid;
    const personId = `person_${uid}`;
    const authAccountRef = doc(firestore, environment.firebase.authAccountCollection, uid);
    const personRef = doc(firestore, environment.firebase.peopleCollection, personId);
    const householdRef = doc(collection(firestore, HOUSEHOLDS_COLLECTION));
    const membershipRef = doc(firestore, HOUSEHOLDS_COLLECTION, householdRef.id, MEMBERS_SUBCOLLECTION, personId);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

    try {
      return await runTransaction(firestore, async (transaction) => {
        const existingAccountSnapshot = await transaction.get(authAccountRef);

        if (existingAccountSnapshot.exists()) {
          const existingAccount = existingAccountSnapshot.data() as ExistingAuthAccount;

          if (existingAccount.accountType && existingAccount.accountType !== 'parent') {
            return {
              ok: false,
              message: 'This account is already linked to a child profile and cannot start a parent household.',
            };
          }

          return {
            ok: true,
            created: false,
            householdId: existingAccount.defaultHouseholdId ?? undefined,
          };
        }

        transaction.set(authAccountRef, {
          uid,
          personId,
          accountType: 'parent',
          status: 'active',
          defaultHouseholdId: householdRef.id,
          lastActiveHouseholdId: householdRef.id,
          login: {
            provider: 'password',
            email: normalizedDraft.email,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(personRef, {
          personId,
          type: 'parent',
          displayName: normalizedDraft.displayName,
          avatarUrl: null,
          themeColor: null,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(householdRef, {
          householdId: householdRef.id,
          name: normalizedDraft.householdName,
          createdByPersonId: personId,
          status: 'active',
          settings: {
            timezone,
            defaultModeId: null,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        transaction.set(membershipRef, {
          personId,
          role: 'owner',
          status: 'active',
          permissions: {
            canManageChildren: true,
            canManageQuests: true,
            canApproveRewards: true,
            canInviteParents: true,
            canManageChildCredentials: true,
          },
          joinedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        return {
          ok: true,
          created: true,
          householdId: householdRef.id,
        };
      });
    } catch (error) {
      return {
        ok: false,
        message: describeBootstrapError(error),
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

function normalizeParentBootstrapDraft(draft: ParentBootstrapDraft) {
  const displayName = draft.displayName.trim();
  const householdName = draft.householdName.trim();
  const email = draft.email.trim().toLowerCase();

  if (!displayName || !householdName || !email) {
    return null;
  }

  return {
    displayName,
    householdName,
    email,
  };
}

function describeBootstrapError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'We could not finish setting up this family right now.';
    case 'unavailable':
    case 'firestore/unavailable':
      return "We couldn't reach the server while creating the family space. Check the network and try again.";
    default:
      return 'The parent account was created, but the family setup could not finish yet.';
  }
}
