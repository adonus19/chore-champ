import { Injectable, inject } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Firestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
} from 'firebase/firestore';

import { environment } from '../../../environments/environment';
import { looksLikeEmail, normalizeChildUsername } from '../utils/child-login';
import { FirebaseAuthService } from './firebase-auth.service';

interface UsernameIndexDocument {
  internalEmailAlias?: string | null;
  status?: 'reserved' | 'active' | 'disabled';
}

interface ChildLoginResult {
  ok: boolean;
  message?: string;
}

const GENERIC_CHILD_LOGIN_ERROR = "We couldn't sign you in with that username and password.";

@Injectable({
  providedIn: 'root',
})
export class FirebaseChildLoginService {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly app = createFirebaseApp();
  private readonly firestore = this.app ? createFirestore(this.app) : null;

  async signInWithUsernameOrEmail(identifier: string, password: string): Promise<ChildLoginResult> {
    const trimmedIdentifier = identifier.trim();

    if (!trimmedIdentifier) {
      return {
        ok: false,
        message: 'Enter the child username or email for this account.',
      };
    }

    if (looksLikeEmail(trimmedIdentifier)) {
      const result = await this.firebaseAuth.signInWithEmailPassword(trimmedIdentifier, password);
      return result.ok
        ? result
        : {
            ok: false,
            message: GENERIC_CHILD_LOGIN_ERROR,
          };
    }

    const firestore = this.firestore;

    if (!firestore) {
      return {
        ok: false,
        message: 'Firestore is not configured yet. Add your Firebase keys before using child username login.',
      };
    }

    const normalizedUsername = normalizeChildUsername(trimmedIdentifier);

    if (!normalizedUsername) {
      return {
        ok: false,
        message: GENERIC_CHILD_LOGIN_ERROR,
      };
    }

    try {
      const usernameSnapshot = await getDoc(doc(firestore, environment.firebase.usernameIndexCollection, normalizedUsername));

      if (!usernameSnapshot.exists()) {
        return {
          ok: false,
          message: GENERIC_CHILD_LOGIN_ERROR,
        };
      }

      const usernameData = usernameSnapshot.data() as UsernameIndexDocument;

      if (usernameData.status !== 'active' || !usernameData.internalEmailAlias?.trim()) {
        return {
          ok: false,
          message: GENERIC_CHILD_LOGIN_ERROR,
        };
      }

      const result = await this.firebaseAuth.signInWithEmailPassword(usernameData.internalEmailAlias, password);

      return result.ok
        ? result
        : {
            ok: false,
            message: GENERIC_CHILD_LOGIN_ERROR,
          };
    } catch (error) {
      return {
        ok: false,
        message: describeChildLoginLookupError(error),
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

function describeChildLoginLookupError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firestore blocked the child username lookup. Update the child-login security rules before trying again.';
    case 'unavailable':
    case 'firestore/unavailable':
      return 'Firestore could not be reached while looking up that child username. Check the network and try again.';
    default:
      return GENERIC_CHILD_LOGIN_ERROR;
  }
}
