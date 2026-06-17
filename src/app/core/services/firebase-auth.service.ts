import { Injectable, computed, signal } from '@angular/core';
import { FirebaseApp, deleteApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  EmailAuthProvider,
  User,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';

import { environment } from '../../../environments/environment';

interface AuthResult {
  code?: string;
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
        message: 'Secure sign-in is not set up for this build yet.',
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
        code: firebaseAuthErrorCode(error),
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async createUserWithEmailPassword(email: string, password: string): Promise<AuthResult> {
    if (!this.auth) {
      return {
        ok: false,
        message: 'Secure sign-in is not set up for this build yet.',
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
        code: firebaseAuthErrorCode(error),
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async sendPasswordReset(email: string): Promise<AuthResult> {
    if (!this.auth) {
      return {
        ok: false,
        message: 'Secure password recovery is not set up for this build yet.',
      };
    }

    try {
      await sendPasswordResetEmail(this.auth, email.trim());

      return {
        ok: true,
      };
    } catch (error) {
      return {
        code: firebaseAuthErrorCode(error),
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async reauthenticateCurrentUser(password: string): Promise<AuthResult> {
    const user = this.auth?.currentUser ?? null;

    if (!this.auth || !user || !user.email) {
      return {
        ok: false,
        message: 'Sign in again before confirming this action.',
      };
    }

    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);

      return {
        ok: true,
      };
    } catch (error) {
      return {
        code: firebaseAuthErrorCode(error),
        ok: false,
        message: describeReauthError(error),
      };
    }
  }

  async updateCurrentUserPassword(newPassword: string): Promise<AuthResult> {
    const user = this.auth?.currentUser ?? null;

    if (!this.auth || !user) {
      return {
        ok: false,
        message: 'Sign in again before changing the password.',
      };
    }

    try {
      await updatePassword(user, newPassword);

      return {
        ok: true,
      };
    } catch (error) {
      return {
        code: firebaseAuthErrorCode(error),
        ok: false,
        message: describeFirebaseAuthError(error),
      };
    }
  }

  async createSecondaryUserWithEmailPassword(email: string, password: string): Promise<SecondaryUserCreateResult> {
    if (!hasFirebaseConfig()) {
      return {
        ok: false,
        message: 'Secure sign-in is not set up for this build yet.',
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
        code: firebaseAuthErrorCode(error),
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
  const code = firebaseAuthErrorCode(error);

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
      return 'That email already has an account. Sign in instead, or finish setup if this account was just created.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Sign-in was temporarily slowed after too many attempts. Try again in a bit.';
    case 'auth/network-request-failed':
      return "We couldn't reach the sign-in service. Check the network and try again.";
    default:
      return 'Sign-in could not be completed right now.';
  }
}

function describeReauthError(error: unknown) {
  const code = firebaseAuthErrorCode(error);

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/invalid-login-credentials':
      return 'That password did not match this account. Try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return "We couldn't reach the sign-in service. Check the network and try again.";
    default:
      return 'We could not confirm your password right now.';
  }
}

function firebaseAuthErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}
