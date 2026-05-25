import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonToggleChange, MatButtonToggleModule } from '@angular/material/button-toggle';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { ReportGeneratorComponent } from '../report-generator/report-generator.component';
import { ReportsComponent } from '../reports/reports.component';

type StatisticsViewMode = 'statistics' | 'reports';

@Component({
  selector: 'app-statistics-hub',
  imports: [CommonModule, MatButtonToggleModule, ReportsComponent, ReportGeneratorComponent],
  templateUrl: './statistics-hub.component.html',
  styleUrls: ['./statistics-hub.component.scss']
})
export class StatisticsHubComponent implements OnInit, OnDestroy {
  viewMode: StatisticsViewMode = 'statistics';

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        const view = params.get('view');
        this.viewMode = view === 'reports' ? 'reports' : 'statistics';
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onViewModeChange(event: MatButtonToggleChange): void {
    const mode: StatisticsViewMode = event.value === 'reports' ? 'reports' : 'statistics';
    this.setView(mode);
  }

  setView(mode: StatisticsViewMode): void {
    if (mode === this.viewMode) {
      return;
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: mode },
      queryParamsHandling: 'merge'
    });
  }
}