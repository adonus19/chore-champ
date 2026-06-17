import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, minLength, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';

import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';
import { FirebaseAuthService } from '../../../core/services/firebase-auth.service';
import { FirebaseChildLoginService } from '../../../core/services/firebase-child-login.service';
import { FirebaseUserProfileService } from '../../../core/services/firebase-user-profile.service';
import { MockFamilyData } from '../../../core/services/mock-family-data';
import { withTimeout } from '../../../core/utils/with-timeout';

@Component({
  selector: 'app-login-page',
  imports: [FormField, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly familyData = inject(MockFamilyData);
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseChildLogin = inject(FirebaseChildLoginService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly router = inject(Router);

  readonly firebaseEnabled = this.firebaseAuth.firebaseEnabled;
  readonly authReady = this.firebaseAuth.authReady;
  readonly noteContent = computed(() =>
    this.firebaseEnabled
      ? {
          heading: 'Secure sign-in is ready',
          copy: 'Sign in with your email and password. After that, the app opens the right family view for this account.',
        }
      : {
          heading: 'Sign-in setup is incomplete',
          copy: 'This build is missing the secure sign-in settings right now.',
        },
  );
  readonly parentError = signal('');
  readonly childError = signal('');
  readonly parentDemoModel = signal({
    code: '',
  });
  readonly childDemoModel = signal({
    code: '',
  });
  readonly parentFirebaseModel = signal({
    email: '',
    password: '',
  });
  readonly childFirebaseModel = signal({
    identifier: '',
    password: '',
  });
  readonly parentDemoForm = form(this.parentDemoModel, (path) => {
    required(path.code, {
      message: 'Enter the parent access code to open the family lane.',
    });
  });
  readonly childDemoForm = form(this.childDemoModel, (path) => {
    required(path.code, {
      message: 'Enter the child access code to open the right child board.',
    });
  });
  readonly parentFirebaseForm = form(this.parentFirebaseModel, (path) => {
    required(path.email, {
      message: 'Enter the parent email for this account.',
    });
    required(path.password, {
      message: 'Enter the password for this account.',
    });
    minLength(path.password, 6, {
      message: 'Passwords are usually at least 6 characters.',
    });
  });
  readonly childFirebaseForm = form(this.childFirebaseModel, (path) => {
    required(path.identifier, {
      message: 'Enter the child username or email for this account.',
    });
    required(path.password, {
      message: 'Enter the password for this account.',
    });
    minLength(path.password, 6, {
      message: 'Passwords are usually at least 6 characters.',
    });
  });

  signInParentDemo(submitEvent?: Event) {
    submitWithValidationFocus(this.parentDemoForm, submitEvent, async () => {
      const code = this.parentDemoForm().value().code.trim();

      if (!this.familyData.signInParentWithCode(code)) {
        this.parentError.set('That parent access code did not match this device.');
        return;
      }

      this.parentError.set('');
      this.parentDemoModel.set({ code: '' });
      void this.router.navigateByUrl('/family-access');
    });
  }

  signInChildDemo(submitEvent?: Event) {
    submitWithValidationFocus(this.childDemoForm, submitEvent, async () => {
      const code = this.childDemoForm().value().code.trim();
      const childId = this.familyData.signInChildWithCode(code);

      if (!childId) {
        this.childError.set('That child access code did not match this device.');
        return;
      }

      this.childError.set('');
      this.childDemoModel.set({ code: '' });
      void this.router.navigateByUrl(this.familyData.childRoutePath(childId));
    });
  }

  signInParentFirebase(submitEvent?: Event) {
    submitWithValidationFocus(this.parentFirebaseForm, submitEvent, async () => {
      const { email, password } = this.parentFirebaseForm().value();
      const result = await this.firebaseAuth.signInWithEmailPassword(email, password);

      if (!result.ok) {
        this.parentError.set(result.message ?? 'Sign-in failed.');
        return;
      }

      await this.firebaseUserProfile.refreshCurrentProfile();
      try {
        await withTimeout(
          this.firebaseUserProfile.waitForProfileReady(),
          8000,
          'This account is taking too long to open.',
        );
      } catch {
        await this.handleMissingFirebaseProfile(
          'parent',
          this.firebaseUserProfile.lastProfileError() || 'This account is taking too long to open. Try signing in again.',
        );
        return;
      }

      const profile = this.firebaseUserProfile.currentProfile();

      if (!profile) {
        await this.handleMissingFirebaseProfile('parent', 'This account signed in, but it is not set up as a parent account yet.');
        return;
      }

      if (profile.role !== 'parent') {
        await this.handleMissingFirebaseProfile('parent', 'This account is not set up as a parent account.');
        return;
      }

      this.familyData.setParentViewer();
      this.parentError.set('');
      this.parentFirebaseModel.set({
        email: '',
        password: '',
      });
      void this.router.navigateByUrl('/family-access');
    });
  }

  signInChildFirebase(submitEvent?: Event) {
    submitWithValidationFocus(this.childFirebaseForm, submitEvent, async () => {
      const { identifier, password } = this.childFirebaseForm().value();
      const result = await this.firebaseChildLogin.signInWithUsernameOrEmail(identifier, password);

      if (!result.ok) {
        this.childError.set(result.message ?? 'Sign-in failed.');
        return;
      }

      await this.firebaseUserProfile.refreshCurrentProfile();
      try {
        await withTimeout(
          this.firebaseUserProfile.waitForProfileReady(),
          8000,
          'This account is taking too long to open.',
        );
      } catch {
        await this.handleMissingFirebaseProfile(
          'child',
          this.firebaseUserProfile.lastProfileError() || 'This account is taking too long to open. Try signing in again.',
        );
        return;
      }

      await this.familyData.refreshFirebaseHouseholdChildren();
      const profile = this.firebaseUserProfile.currentProfile();

      if (!profile) {
        await this.handleMissingFirebaseProfile('child', 'This account signed in, but it is not set up as a child account yet.');
        return;
      }

      if (profile.role !== 'child' || !profile.childId) {
        await this.handleMissingFirebaseProfile('child', 'This child account is missing setup details. Please ask a parent to finish setup.');
        return;
      }

      if (!this.familyData.childById(profile.childId)) {
        await this.handleMissingFirebaseProfile('child', 'This child account is linked, but the child board is not ready yet.');
        return;
      }

      this.familyData.setChildViewer(profile.childId);
      this.childError.set('');
      this.childFirebaseModel.set({
        identifier: '',
        password: '',
      });
      void this.router.navigateByUrl(this.familyData.childRoutePath(profile.childId));
    });
  }

  clearParentError() {
    this.parentError.set('');
  }

  clearChildError() {
    this.childError.set('');
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  private async handleMissingFirebaseProfile(target: 'parent' | 'child', message: string) {
    await this.firebaseAuth.signOut();
    this.familyData.signOut();
    if (target === 'parent') {
      this.parentError.set(message);
      this.childError.set('');
      return;
    }

    this.childError.set(message);
    this.parentError.set('');
  }
}
