import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { EscalationFlowStep } from '../../../models/escalation.model';

@Component({
  selector: 'app-escalation-flow-preview',
  imports: [CommonModule, MatIconModule],
  templateUrl: './escalation-flow-preview.component.html',
  styleUrls: ['./escalation-flow-preview.component.scss']
})
export class EscalationFlowPreviewComponent {
  @Input() clientName = '';
  @Input() clientSelected = false;
  @Input() flowSteps: EscalationFlowStep[] = [];
  @Input() legend = '';

  formatDateTime(isoString: string | null | undefined): string {
    if (!isoString) {
      return '';
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }
}