import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, minLength, pattern, required, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';

import { FirebaseAccountBootstrapService } from '../../../core/services/firebase-account-bootstrap';
import { FirebaseAuthService } from '../../../core/services/firebase-auth.service';
import { FirebaseUserProfileService } from '../../../core/services/firebase-user-profile.service';
import { MockFamilyData } from '../../../core/services/mock-family-data';

@Component({
  selector: 'app-parent-signup-page',
  imports: [FormField, RouterLink],
  templateUrl: './parent-signup-page.html',
  styleUrl: './parent-signup-page.scss',
})
export class ParentSignupPage {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseBootstrap = inject(FirebaseAccountBootstrapService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly familyData = inject(MockFamilyData);
  private readonly router = inject(Router);

  readonly firebaseEnabled = this.firebaseAuth.firebaseEnabled;
  readonly authReady = this.firebaseAuth.authReady;
  readonly currentFirebaseEmail = computed(() => this.firebaseAuth.currentUser()?.email?.trim().toLowerCase() ?? '');
  readonly accountExistsNote = computed(() => {
    const email = this.currentFirebaseEmail();

    if (!email) {
      return null;
    }

    return `Firebase already knows ${email}. If Firestore bootstrap did not finish earlier, submitting this form again will resume setup instead of creating a second family.`;
  });
  readonly signupError = signal('');
  readonly signupModel = signal({
    displayName: '',
    householdName: '',
    email: '',
    password: '',
  });
  readonly signupForm = form(this.signupModel, (path) => {
    required(path.displayName, {
      message: 'Add the parent name that should appear inside the app.',
    });
    minLength(path.displayName, 2, {
      message: 'Use at least 2 characters for the parent name.',
    });
    required(path.householdName, {
      message: 'Add the household name for this family workspace.',
    });
    minLength(path.householdName, 2, {
      message: 'Use at least 2 characters for the household name.',
    });
    required(path.email, {
      message: 'Add the parent email for this Firebase account.',
    });
    pattern(path.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
      message: 'Enter a valid email address.',
    });
    required(path.password, {
      message: 'Add a password for this new Firebase account.',
    });
    minLength(path.password, 6, {
      message: 'Choose a password with at least 6 characters.',
    });
  });

  createParentAccount() {
    submit(this.signupForm, async () => {
      if (!this.firebaseEnabled) {
        this.signupError.set('Firebase Auth is not configured yet. Add the Firebase keys before creating real accounts.');
        return;
      }

      const { displayName, householdName, email, password } = this.signupForm().value();
      const normalizedEmail = email.trim().toLowerCase();
      const signedInEmail = this.currentFirebaseEmail();

      if (signedInEmail !== normalizedEmail) {
        const createResult = await this.firebaseAuth.createUserWithEmailPassword(normalizedEmail, password);

        if (!createResult.ok) {
          this.signupError.set(createResult.message ?? 'Firebase could not create the parent account.');
          return;
        }
      }

      const bootstrapResult = await this.firebaseBootstrap.bootstrapCurrentParentAccount({
        displayName,
        householdName,
        email: normalizedEmail,
      });

      if (!bootstrapResult.ok) {
        this.signupError.set(bootstrapResult.message ?? 'The family workspace bootstrap could not finish.');
        return;
      }

      await this.firebaseUserProfile.refreshCurrentProfile();
      await this.firebaseUserProfile.waitForProfileReady();
      const profile = this.firebaseUserProfile.currentProfile();

      if (!profile || profile.role !== 'parent') {
        this.signupError.set(
          this.firebaseUserProfile.lastProfileError() ||
            'The Firebase account exists now, but the parent lane could not be resolved from Firestore yet.',
        );
        return;
      }

      this.familyData.setParentViewer();
      this.signupError.set('');
      this.signupModel.set({
        displayName: '',
        householdName: '',
        email: '',
        password: '',
      });
      void this.router.navigateByUrl('/family-access');
    });
  }

  clearSignupError() {
    this.signupError.set('');
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }
}
