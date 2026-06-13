import { submit } from '@angular/forms/signals';

interface FormStateWithInvalid {
  invalid(): boolean;
}

const FOCUSABLE_CONTROL_SELECTOR = 'input, textarea, select, button';
const INVALID_ANCHOR_SELECTOR = '.field, .choice-group, .minimum-editor-card';

export function submitWithValidationFocus<TForm extends () => FormStateWithInvalid>(
  formRef: TForm,
  submitEvent: Event | null | undefined,
  action: () => Promise<void>,
) {
  const formElement = submitEvent?.currentTarget instanceof HTMLFormElement ? submitEvent.currentTarget : null;

  void submit(formRef as never, async () => {
    await action();
  });

  if (!formElement || !formRef().invalid()) {
    return;
  }

  queueMicrotask(() => {
    requestAnimationFrame(() => {
      const firstError = formElement.querySelector<HTMLElement>('.field__error');

      if (!firstError) {
        return;
      }

      const scrollTarget = firstError.closest<HTMLElement>(INVALID_ANCHOR_SELECTOR) ?? firstError;
      const focusTarget = scrollTarget.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR) ?? firstError;

      scrollTarget.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
      focusTarget.focus({ preventScroll: true });
    });
  });
}
