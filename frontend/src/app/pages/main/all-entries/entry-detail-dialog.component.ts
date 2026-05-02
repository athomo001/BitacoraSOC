/**
 * File Purpose: frontend/src/app/pages/main/all-entries/entry-detail-dialog.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface EntryDetailDialogData {
  title: string;
  details: string;
  content: string;
}

@Component({
    selector: 'app-entry-detail-dialog',
    imports: [CommonModule, MatDialogModule, MatButtonModule],
    templateUrl: './entry-detail-dialog.component.html',
    styleUrls: ['./entry-detail-dialog.component.scss']
})
export class EntryDetailDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: EntryDetailDialogData) {}
}
