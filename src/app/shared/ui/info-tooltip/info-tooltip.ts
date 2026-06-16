import { Component, ElementRef, inject, input, signal } from '@angular/core';

let nextTooltipId = 0;

@Component({
  selector: 'app-info-tooltip',
  imports: [],
  host: {
    class: 'info-tooltip',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
  },
  templateUrl: './info-tooltip.html',
  styleUrl: './info-tooltip.scss',
})
export class InfoTooltip {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly align = input<'end' | 'start'>('start');
  readonly ariaLabel = input.required<string>();
  readonly title = input('');
  readonly text = input.required<string>();
  readonly open = signal(false);
  readonly panelId = `info-tooltip-panel-${nextTooltipId += 1}`;

  toggle(event: Event) {
    event.stopPropagation();
    this.open.update((value) => !value);
  }

  close() {
    this.open.set(false);
  }

  onDocumentPointerDown(event: Event) {
    if (!this.open()) {
      return;
    }

    if (event.target instanceof Node && this.elementRef.nativeElement.contains(event.target)) {
      return;
    }

    this.close();
  }
}
