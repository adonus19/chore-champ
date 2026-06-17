import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { generateTempPassword } from './temp-password';

initializeApp();

// Pin the region so the web client can target the same one with getFunctions(app, REGION).
const REGION = 'us-central1';

const PARENT_ROLES = ['owner', 'parent_admin', 'parent_member'];

interface ResetChildPasswordRequest {
  childId?: unknown;
  householdId?: unknown;
}

interface ResetChildPasswordResponse {
  tempPassword: string;
  username: string | null;
}

/**
 * Parent-mediated reset of a child's forgotten sign-in password.
 *
 * A forgotten password for another account is the one credential action the Firebase client SDK
 * cannot perform, so it lives here behind the Admin SDK. The function sets a fresh temporary
 * password, revokes the child's existing sessions, and flags `mustChangePassword` so the child is
 * forced to choose their own password (client-side) on next sign-in. The temp password is returned
 * to the authenticated parent only and is never persisted to Firestore.
 */
export const resetChildPassword = onCall<ResetChildPasswordRequest>(
  { region: REGION },
  async (request): Promise<ResetChildPasswordResponse> => {
    const callerUid = request.auth?.uid;

    if (!callerUid) {
      throw new HttpsError('unauthenticated', 'Sign in before resetting a child sign-in.');
    }

    const childId = typeof request.data.childId === 'string' ? request.data.childId.trim() : '';

    if (!childId) {
      throw new HttpsError('invalid-argument', 'A child id is required to reset a child sign-in.');
    }

    const firestore = getFirestore();

    const callerAccountSnapshot = await firestore.doc(`authAccounts/${callerUid}`).get();
    const callerAccount = callerAccountSnapshot.data();

    if (!callerAccountSnapshot.exists || !callerAccount || callerAccount.accountType !== 'parent') {
      throw new HttpsError('permission-denied', 'Only a parent account can reset a child sign-in.');
    }

    const callerPersonId = typeof callerAccount.personId === 'string' ? callerAccount.personId : '';
    const requestedHouseholdId =
      typeof request.data.householdId === 'string' && request.data.householdId.trim()
        ? request.data.householdId.trim()
        : '';
    const householdId =
      requestedHouseholdId ||
      (typeof callerAccount.defaultHouseholdId === 'string' ? callerAccount.defaultHouseholdId : '');

    if (!callerPersonId || !householdId) {
      throw new HttpsError('failed-precondition', 'The parent household context is not ready yet.');
    }

    const callerMembershipSnapshot = await firestore
      .doc(`households/${householdId}/members/${callerPersonId}`)
      .get();
    const callerMembership = callerMembershipSnapshot.data();

    const callerIsActiveParent =
      callerMembershipSnapshot.exists &&
      !!callerMembership &&
      callerMembership.status === 'active' &&
      PARENT_ROLES.includes(callerMembership.role);

    const callerCanManageCredentials =
      callerIsActiveParent &&
      (callerMembership?.permissions?.canManageChildCredentials === true ||
        callerMembership?.permissions?.canManageChildren === true);

    if (!callerCanManageCredentials) {
      throw new HttpsError(
        'permission-denied',
        'This parent account cannot manage child sign-ins in this household.',
      );
    }

    const childMembershipSnapshot = await firestore
      .doc(`households/${householdId}/members/${childId}`)
      .get();
    const childMembership = childMembershipSnapshot.data();

    const childIsActiveMember =
      childMembershipSnapshot.exists &&
      !!childMembership &&
      childMembership.role === 'child' &&
      childMembership.status === 'active';

    if (!childIsActiveMember) {
      throw new HttpsError('not-found', 'That child is not an active member of this household.');
    }

    const childProfileSnapshot = await firestore.doc(`childProfiles/${childId}`).get();
    const childProfile = childProfileSnapshot.data();
    const childLogin = childProfile?.login;

    if (!childProfileSnapshot.exists || childLogin?.enabled !== true) {
      throw new HttpsError('failed-precondition', 'This child does not have sign-in enabled yet.');
    }

    const childAuthUid = typeof childLogin.authUid === 'string' ? childLogin.authUid : '';

    if (!childAuthUid) {
      throw new HttpsError('failed-precondition', 'This child sign-in is missing its auth account.');
    }

    const tempPassword = generateTempPassword();

    try {
      await getAuth().updateUser(childAuthUid, { password: tempPassword });
      await getAuth().revokeRefreshTokens(childAuthUid);
    } catch (error) {
      logger.error('Failed to update child auth password', { childId, childAuthUid, error });
      throw new HttpsError('internal', 'The child sign-in could not be reset right now.');
    }

    const resetAt = FieldValue.serverTimestamp();
    const batch = firestore.batch();
    batch.set(
      firestore.doc(`childProfiles/${childId}`),
      { login: { mustChangePassword: true, passwordResetAt: resetAt }, updatedAt: resetAt },
      { merge: true },
    );
    batch.set(
      firestore.doc(`authAccounts/${childAuthUid}`),
      { login: { mustChangePassword: true, passwordResetAt: resetAt }, updatedAt: resetAt },
      { merge: true },
    );
    await batch.commit();

    logger.info('Reset child sign-in password', { householdId, childId, callerPersonId });

    return {
      tempPassword,
      username: typeof childLogin.usernameDisplay === 'string' ? childLogin.usernameDisplay : null,
    };
  },
);
