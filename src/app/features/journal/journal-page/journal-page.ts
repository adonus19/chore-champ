import { computed, Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormField, form, minLength, required } from '@angular/forms/signals';
import { map } from 'rxjs';

import { JournalEntry } from '../../../core/models/family.models';
import { MockFamilyData } from '../../../core/services/mock-family-data';
import { submitWithValidationFocus } from '../../../core/utils/submit-with-validation-focus';

@Component({
  selector: 'app-journal-page',
  imports: [FormField, RouterLink],
  templateUrl: './journal-page.html',
  styleUrl: './journal-page.scss',
})
export class JournalPage {
  private readonly route = inject(ActivatedRoute);
  private readonly familyData = inject(MockFamilyData);
  private readonly childId = toSignal(this.route.paramMap.pipe(map((params) => params.get('childId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('childId') ?? '',
  });

  readonly journalModel = signal(this.createJournalModel());
  readonly actionFeedback = signal<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  readonly isSaving = signal(false);
  readonly todayEntry = computed(() => {
    const childId = this.childId();
    return childId ? this.familyData.getTodaysJournalEntry(childId) : undefined;
  });
  readonly journalForm = form(this.journalModel, (path) => {
    required(path.accomplished, { message: 'Share one thing you accomplished today.' });
    minLength(path.accomplished, 8, { message: 'Add a little more detail to the win.' });

    required(path.learned, { message: 'Share one thing you learned today.' });
    minLength(path.learned, 8, { message: 'A short reflection helps this feel more meaningful.' });

    required(path.proudOf, { message: 'Share one thing you feel proud of today.' });
    minLength(path.proudOf, 8, { message: 'Name the moment so it is easy to remember later.' });
  });
  readonly vm = computed(() => {
    const childId = this.childId();
    const child = this.familyData.childById(childId);

    if (!child) {
      return null;
    }

    const activeMode = this.familyData.activeMode();
    const entries = this.familyData.getJournalEntriesForChild(childId);
    const todayEntry = this.todayEntry();
    const parentResponseCount = entries.filter((entry) => entry.parentReaction || entry.parentNote).length;

    return {
      child,
      activeMode,
      entries,
      todayEntry,
      todayStatusLabel: todayEntry ? 'Reflection saved' : "Ready for today's win",
      heroMessage: buildJournalHeroMessage(child.name, todayEntry),
      headlineStats: [
        {
          label: 'Entries Logged',
          value: entries.length.toString(),
          hint: 'Saved reflections in this family journal timeline',
        },
        {
          label: 'Today',
          value: todayEntry ? 'Saved' : 'Ready',
          hint: todayEntry ? "You can still edit today's reflection" : 'Capture the win while it is still fresh',
        },
        {
          label: 'Parent Responses',
          value: parentResponseCount.toString(),
          hint: 'Notes or reactions already added by a parent',
        },
        {
          label: 'Mode',
          value: activeMode.name,
          hint: 'The journal stays available in every family rhythm',
        },
      ],
    };
  });

  constructor() {
    effect(() => {
      const childId = this.childId();
      const todayEntry = this.todayEntry();

      if (!childId) {
        return;
      }

      this.journalModel.set(this.createJournalModel(todayEntry));
    });
  }

  onSubmit(submitEvent?: Event) {
    submitWithValidationFocus(this.journalForm, submitEvent, async () => {
      const childId = this.childId();

      if (!childId) {
        return;
      }

      const value = this.journalForm().value();
      this.actionFeedback.set(null);
      this.isSaving.set(true);

      try {
        const result = await this.familyData.saveJournalEntry(childId, {
          accomplished: value.accomplished.trim(),
          learned: value.learned.trim(),
          proudOf: value.proudOf.trim(),
        });

        if (!result.ok) {
          this.actionFeedback.set({
            kind: 'error',
            text: result.message ?? "Today's journal could not be saved right now. Try again in a moment.",
          });
          return;
        }

        this.actionFeedback.set({
          kind: 'success',
          text: "Today's reflection is saved and ready for parents to see.",
        });
      } finally {
        this.isSaving.set(false);
      }
    });
  }

  errorMessage(messages: ReadonlyArray<{ message?: string }>) {
    return messages[0]?.message ?? 'Check this field and try again.';
  }

  formatEntryDate(date: string) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(date));
  }

  private createJournalModel(entry?: JournalEntry) {
    return {
      accomplished: entry?.accomplished ?? '',
      learned: entry?.learned ?? '',
      proudOf: entry?.proudOf ?? '',
    };
  }
}

function buildJournalHeroMessage(childName: string, todayEntry?: JournalEntry) {
  if (todayEntry) {
    return `${childName}'s win of the day is already saved. Journal time can stay light while still capturing the good stuff.`;
  }

  return `Capture one win, one lesson, and one proud moment so ${childName}'s progress feels real instead of invisible.`;
}
