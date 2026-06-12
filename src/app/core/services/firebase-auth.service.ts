import { Injectable, computed, signal } from '@angular/core';
import { FirebaseApp, deleteApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  User,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { environment } from '../../../environments/environment';

interface AuthResult {
  ok: boolean;
  message?: string;
}

interface SecondaryUserCreateResult extends AuthResult {
  cleanup?: () => Promise<void>;
  rollback?: () => Promise<void>;
  uid?: string;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseAuthService {
  private readonly app = createFirebaseApp();
  private readonly auth = this.app ? createFirebaseAuth(this.app) : null;
  private readonly _authReady = signal(!this.auth);
  readonly authReady = this._authReady.asReadonly();
  private readonly _currentUser = signal<User | null>(null);
  readonly currentUser = this._currentUser.asReadonly();
  readonly firebaseEnabled = Boolean(this.auth);
  readonly isAuthenticated = computed(() => Boolean(this.currentUser()));
  private readonly readyPromise: Promise<void>;
  private resolveReady: (() => void) | null = null;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    if (!this.auth) {
      this.markAuthReady();
      return;
    }

    onAuthStateChanged(
      this.auth,
      (user) => {
        this._currentUser.set(user);
        this.markAuthReady();
      },
      () => {
        this._currentUser.set(null);
        this.markAuthReady();
      },
    );
  }

  waitForAuthReady() {
    return this.readyPromise;
  }

  async signInWithEmailPassword(email: string, password: string): Promise<AuthResult> {
    if (!this.auth) {
      return {
        ok: false,
        message: 'Firebase Auth is not configured yet. Add your Firebase keys to the environment files first.',
      };
    }

    try {
      const credential = await signInWithEmailAndPassword(this.auth, email.trim(), password);
      this._currentUser.set(credential.user);

      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async createUserWithEmailPassword(email: string, password: string): Promise<AuthResult> {
    if (!this.auth) {
      return {
        ok: false,
        message: 'Firebase Auth is not configured yet. Add your Firebase keys to the environment files first.',
      };
    }

    try {
      const credential = await createUserWithEmailAndPassword(this.auth, email.trim(), password);
      this._currentUser.set(credential.user);

      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async createSecondaryUserWithEmailPassword(email: string, password: string): Promise<SecondaryUserCreateResult> {
    if (!hasFirebaseConfig()) {
      return {
        ok: false,
        message: 'Firebase Auth is not configured yet. Add your Firebase keys to the environment files first.',
      };
    }

    const secondaryApp = initializeApp(
      environment.firebase,
      `child-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const secondaryAuth = createFirebaseAuth(secondaryApp);

    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
      const cleanup = async () => {
        await safeDisposeSecondaryAuth(secondaryAuth, secondaryApp);
      };
      const rollback = async () => {
        try {
          await deleteUser(credential.user);
        } finally {
          await safeDisposeSecondaryAuth(secondaryAuth, secondaryApp);
        }
      };

      return {
        ok: true,
        uid: credential.user.uid,
        cleanup,
        rollback,
      };
    } catch (error) {
      await safeDisposeSecondaryAuth(secondaryAuth, secondaryApp);
      return {
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async signOut() {
    if (!this.auth) {
      return;
    }

    await signOut(this.auth);
    this._currentUser.set(null);
  }

  private markAuthReady() {
    if (!this._authReady()) {
      this._authReady.set(true);
    }

    this.resolveReady?.();
    this.resolveReady = null;
  }
}

function createFirebaseApp(): FirebaseApp | null {
  if (!hasFirebaseConfig()) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(environment.firebase);
}

let authEmulatorConnected = false;

function createFirebaseAuth(app: FirebaseApp) {
  const auth = getAuth(app);

  if (environment.firebase.useAuthEmulator && !authEmulatorConnected) {
    connectAuthEmulator(auth, environment.firebase.authEmulatorUrl, {
      disableWarnings: true,
    });
    authEmulatorConnected = true;
  }

  return auth;
}

async function safeDisposeSecondaryAuth(auth: Auth, app: FirebaseApp) {
  try {
    await signOut(auth);
  } catch {
    // Ignore secondary session cleanup failures so the primary app stays unaffected.
  }

  try {
    await deleteApp(app);
  } catch {
    // Ignore app disposal failures during prototype child-account creation cleanup.
  }
}

function hasFirebaseConfig() {
  const { apiKey, authDomain, projectId, appId } = environment.firebase;

  return Boolean(apiKey && authDomain && projectId && appId);
}

function describeFirebaseAuthError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look valid.';
    case 'auth/missing-password':
      return 'Enter the password for this account.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'That email and password combination did not match an account.';
    case 'auth/email-already-in-use':
      return 'That email already has a Firebase account. Sign in instead, or finish setup if this account was just created.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Firebase temporarily slowed sign-in after too many attempts. Try again in a bit.';
    case 'auth/network-request-failed':
      return 'Firebase could not be reached. Check the network and try again.';
    default:
      return 'Firebase sign-in could not be completed right now.';
  }
}
