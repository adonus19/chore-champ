import { Component, inject, signal } from '@angular/core';
import { FormField, form, minLength, required, validate } from '@angular/forms/signals';
import { Router } from '@angular/router';

import { FirebaseAuthService } from '../../../core/services/firebase-auth.service';
import { FirebaseUserProfileService } from '../../../core/services/firebase-user-profile.service';
import { MockFamilyData } from '../../../core/services/mock-family-data';
import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';

@Component({
  selector: 'app-child-set-password-page',
  imports: [FormField],
  templateUrl: './child-set-password-page.html',
  styleUrl: './child-set-password-page.scss',
})
export class ChildSetPasswordPage {
  private readonly firebaseAuth = inject(FirebaseAuthService);
  private readonly firebaseUserProfile = inject(FirebaseUserProfileService);
  private readonly familyData = inject(MockFamilyData);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly errorMessageText = signal('');
  readonly childName = signal(this.firebaseUserProfile.currentProfile()?.displayName ?? '');
  readonly model = signal({
    password: '',
    confirmPassword: '',
  });
  readonly passwordForm = form(this.model, (path) => {
    required(path.password, { message: 'Choose a new password.' });
    minLength(path.password, 6, { message: 'Use at least 6 characters.' });

    required(path.confirmPassword, { message: 'Type the new password again.' });
    validate(path.confirmPassword, ({ value }) =>
      value() === this.model().password ? undefined : { kind: 'mismatch', message: 'The two passwords do not match.' },
    );
  });

  errorFor(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  clearError() {
    if (this.errorMessageText()) {
      this.errorMessageText.set('');
    }
  }

  onSubmit(submitEvent?: Event) {
    submitWithValidationFocus(this.passwordForm, submitEvent, async () => {
      this.busy.set(true);
      this.errorMessageText.set('');

      const newPassword = this.passwordForm().value().password;
      const passwordResult = await this.firebaseAuth.updateCurrentUserPassword(newPassword);

      if (!passwordResult.ok) {
        this.busy.set(false);
        this.errorMessageText.set(passwordResult.message ?? 'Your new password could not be saved. Try again.');
        return;
      }

      // The password is changed; clearing the flag just stops the next sign-in from re-prompting.
      await this.firebaseUserProfile.clearMustChangePassword();
      this.busy.set(false);

      const childId = this.firebaseUserProfile.currentProfile()?.childId;
      void this.router.navigateByUrl(childId ? this.familyData.childRoutePath(childId) : '/login');
    });
  }
}
