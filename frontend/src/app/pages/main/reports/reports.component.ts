/**
 * Componente de Reportes y Dashboard SOC
 * 
 * Funcionalidad:
 *   - Vista general de KPIs operacionales (últimos 30 días default)
 *   - Selección de período (7, 15, 30, 60, 90 días)
 *   - Gráficos interactivos con NGX-Charts
 *   - Exportación de entradas a CSV
 * 
 * Métricas mostradas:
 *   - Entradas por tipo (operativa/incidente) - pie chart
 *   - Tendencia temporal de entradas - line chart
 *   - Incidentes por analista (top 10) - bar chart
 *   - Tags más usados (top 15) - bar chart
 *   - Servicios con rojos (frecuencia) - bar chart
 *   - Comparación de tags por tendencia - multi-line chart
 *   - Mapa de calor día vs hora - heatmap
 *   - Total usuarios activos - card
 *   - Total checks de turno - card
 * 
 * Uso SOC:
 *   - Admin monitorea operación
 *   - Identificar analistas más activos, problemas recurrentes
 *   - Exportar para auditorías externas
 * 
 * Protección:
 *   - Solo admin (AdminGuard)
 *   - Guests NO acceden (NotGuestGuard)
 */
import { Component, OnInit, HostListener } from '@angular/core';
import { ReportService } from '../../../services/report.service';
import { ReportOverview } from '../../../models/report.model';
import { Color, ScaleType } from '@swimlane/ngx-charts';
import { NgIf, NgFor } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { NgxChartsModule } from '@swimlane/ngx-charts';

@Component({
    selector: 'app-reports',
    templateUrl: './reports.component.html',
    styleUrls: ['./reports.component.scss'],
    imports: [
      NgIf,
      NgFor,
      MatButton, 
      MatIconButton,
      MatIcon,
      MatButtonToggleModule,
      MatFormFieldModule,
      MatSelectModule,
      FormsModule,
      NgxChartsModule
    ]
})
export class ReportsComponent implements OnInit {
  overview: ReportOverview | null = null;
  selectedDays = 30;
  
  // Datos para gráficos
  entriesTrendData: any[] = [];
  entriesByTypeData: any[] = [];
  incidentsByUserData: any[] = [];
  topTagsData: any[] = [];
  redsByServiceData: any[] = [];
  entriesByLogSourceData: any[] = [];
  
  // Configuración de gráficos
  view: [number, number] = [700, 300];
  trendView: [number, number] = [1200, 320];
  logSourceBarView: [number, number] = [520, 320];
  logSourcePieView: [number, number] = [420, 320];
  colorScheme: Color = {
    name: 'soc',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: []
  };
  
  // Esquema de colores para heatmap (gradiente: verde=bajo, rojo=alto)
  heatmapColorScheme: Color = {
    name: 'heatmap',
    selectable: true,
    group: ScaleType.Linear,
    domain: []
  };
  
  // Selección de tags para comparación
  availableTags: string[] = [];
  selectedTagsForComparison: string[] = [];
  tagComparisonData: any[] = [];
  
  // Configuración del mapa de calor
  heatmapData: any[] = [];
  showHeatmap = false;
  heatmapMaxValue = 0;
  hoursLabels: string[] = Array.from({length: 24}, (_, i) => `${i}`);

  // Colores pre-cacheados para el heatmap
  private heatmapColors: string[] = [];
  private heatmapEmptyColor = '';

  constructor(private reportService: ReportService) {}

  ngOnInit(): void {
    this.updateTrendView();
    this.applyThemeColorSchemes();
    this.loadOverview();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateTrendView();
  }

  private updateTrendView(): void {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1400;
    const horizontalPadding = 220;
    const responsiveWidth = Math.max(900, Math.min(screenWidth - horizontalPadding, 1500));
    this.trendView = [responsiveWidth, 320];
    const cardWidth = Math.max(320, Math.min(Math.floor((screenWidth - 180) / 2), 620));
    this.logSourceBarView = [cardWidth, 320];
    this.logSourcePieView = [Math.max(320, cardWidth - 40), 320];
  }

  private applyThemeColorSchemes(): void {
    this.colorScheme = {
      ...this.colorScheme,
      domain: [
        this.getThemeColor('--chart-1'),
        this.getThemeColor('--chart-2'),
        this.getThemeColor('--chart-3'),
        this.getThemeColor('--chart-4'),
        this.getThemeColor('--chart-5'),
        this.getThemeColor('--chart-6'),
        this.getThemeColor('--chart-7'),
        this.getThemeColor('--chart-8')
      ]
    };

    this.heatmapColorScheme = {
      ...this.heatmapColorScheme,
      domain: [
        this.getThemeColor('--heatmap-low'),
        this.getThemeColor('--heatmap-low-mid'),
        this.getThemeColor('--heatmap-mid'),
        this.getThemeColor('--heatmap-high'),
        this.getThemeColor('--heatmap-very-high')
      ]
    };

    // Cache heatmap colors for the custom grid
    this.heatmapColors = [
      this.getThemeColor('--heatmap-low'),
      this.getThemeColor('--heatmap-low-mid'),
      this.getThemeColor('--heatmap-mid'),
      this.getThemeColor('--heatmap-high'),
      this.getThemeColor('--heatmap-very-high')
    ];
    this.heatmapEmptyColor = this.getThemeColor('--surface-muted') || '#f5f7fb';
  }

  private getThemeColor(variableName: string): string {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(variableName)
      .trim();
  }

  loadOverview(): void {
    this.reportService.getOverview(this.selectedDays).subscribe({
      next: (data) => {
        this.overview = data;
        this.prepareChartData();
      },
      error: (err) => console.error('Error cargando reporte:', err)
    });
  }
  
  onPeriodChange(days: number): void {
    this.selectedDays = days;
    this.loadOverview();
    if (this.showHeatmap) {
      this.heatmapData = [];
      this.loadHeatmap();
    }
  }
  
  prepareChartData(): void {
    if (!this.overview) return;
    
    // 1. Tendencia de entradas (line chart)
    this.entriesTrendData = [{
      name: 'Entradas',
      series: this.overview.entriesTrend.map((item: any) => ({
        name: item._id,
        value: item.count
      }))
    }];
    
    // 2. Entradas por tipo (pie chart)
    this.entriesByTypeData = Object.keys(this.overview.entriesByType || {}).map(key => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: (this.overview!.entriesByType as any)[key]
    }));
    
    // 3. Incidentes por usuario (bar chart horizontal)
    this.incidentsByUserData = this.overview.incidentsByUser.map((item: any) => ({
      name: item._id || 'Sin usuario',
      value: item.count
    }));
    
    // 4. Top tags (bar chart horizontal)
    this.topTagsData = this.overview.topTags.map((item: any) => ({
      name: item._id,
      value: item.count
    }));
    
    // 5. Servicios con rojos (bar chart horizontal)
    this.redsByServiceData = this.overview.redsByService.map((item: any) => ({
      name: item._id,
      value: item.count
    }));
    
    // 6. Tags disponibles para comparación
    this.availableTags = this.overview.topTags.map((item: any) => item._id);
    
    // 7. Cargar entradas por Log Source
    this.loadEntriesByLogSource();
  }
  
  loadEntriesByLogSource(): void {
    this.reportService.getEntriesByLogSource(this.selectedDays).subscribe({
      next: (data) => {
        this.entriesByLogSourceData = data;
      },
      error: (err) => console.error('Error cargando entradas por log source:', err)
    });
  }
  
  onTagSelectionChange(): void {
    if (this.selectedTagsForComparison.length === 0) {
      this.tagComparisonData = [];
      return;
    }
    
    // Solicitar datos de tendencia por tags seleccionados
    this.reportService.getTagsTrend(this.selectedTagsForComparison, this.selectedDays).subscribe({
      next: (data) => {
        this.tagComparisonData = data.map((tagData: any) => ({
          name: tagData.tag,
          series: tagData.trend.map((item: any) => ({
            name: item._id,
            value: item.count
          }))
        }));
      },
      error: (err) => console.error('Error cargando tendencia de tags:', err)
    });
  }
  
  toggleHeatmap(): void {
    this.showHeatmap = !this.showHeatmap;
    if (this.showHeatmap && this.heatmapData.length === 0) {
      this.loadHeatmap();
    }
  }
  
  loadHeatmap(): void {
    this.reportService.getHeatmapData(this.selectedDays).subscribe({
      next: (data) => {
        // Transformar datos para el formato de heatmap
        // data viene como [{dayOfWeek, hour, count}]
        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        
        // Compute max for color scaling
        this.heatmapMaxValue = 0;
        for (const d of data) {
          if (d.count > this.heatmapMaxValue) this.heatmapMaxValue = d.count;
        }
        if (this.heatmapMaxValue === 0) this.heatmapMaxValue = 1;
        
        this.heatmapData = days.map((day, dayIndex) => ({
          name: day,
          series: Array.from({length: 24}, (_, hour) => {
            const dataPoint = data.find((d: any) => d.dayOfWeek === dayIndex && d.hour === hour);
            return {
              name: `${hour}:00`,
              value: dataPoint ? dataPoint.count : 0
            };
          })
        }));
      },
      error: (err) => console.error('Error cargando heatmap:', err)
    });
  }

  getHeatmapCellColor(value: number): string {
    if (value === 0) return this.heatmapEmptyColor;
    if (this.heatmapColors.length === 0) return '#ccc';

    const ratio = value / this.heatmapMaxValue;
    if (ratio <= 0.2) return this.heatmapColors[0];
    if (ratio <= 0.4) return this.heatmapColors[1];
    if (ratio <= 0.6) return this.heatmapColors[2];
    if (ratio <= 0.8) return this.heatmapColors[3];
    return this.heatmapColors[4];
  }

  getHeatmapTextColor(value: number): string {
    if (value === 0) return 'transparent';
    // Parse the cell background to determine if text should be dark or light
    const bg = this.getHeatmapCellColor(value);
    return this.isLightColor(bg) ? '#1a1a1a' : '#ffffff';
  }

  private isLightColor(hex: string): boolean {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    // Luminance formula
    const lum = (0.299 * r + 0.587 * g + 0.114 * b);
    return lum > 140;
  }

  exportEntries(): void {
    this.reportService.exportEntries().subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `entradas_${new Date().toISOString()}.csv`;
        a.click();
      },
      error: (err) => console.error('Error exportando:', err)
    });
  }
  
  // Formateo personalizado para tooltips
  formatLabel(value: number): string {
    return value.toLocaleString();
  }
  
  formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
  }
}
