/**
 * File Purpose: frontend/src/app/pages/main/reports/reports.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

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
import { ConfigService } from '../../../services/config.service';
import { UserService } from '../../../services/user.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { environment } from '@env/environment';
import { MailAnalytics, ReportOverview, PeriodSummaryReport } from '../../../models/report.model';
import { Color, ScaleType } from '@swimlane/ngx-charts';
import { NgIf, NgFor, DatePipe, SlicePipe, UpperCasePipe } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
    selector: 'app-reports',
    templateUrl: './reports.component.html',
    styleUrls: ['./reports.component.scss'],
    imports: [
      NgIf,
      NgFor,
      DatePipe,
      SlicePipe,
      UpperCasePipe,
      MatButton, 
      MatIconButton,
      MatIcon,
      MatButtonToggleModule,
      MatFormFieldModule,
      MatSelectModule,
      FormsModule,
      NgxChartsModule,
      MatProgressSpinnerModule,
      MatCheckboxModule
    ]
})
export class ReportsComponent implements OnInit {
  overview: ReportOverview | null = null;
  mailAnalytics: MailAnalytics | null = null;
  selectedDays = 30;

  // Nuevas variables para el informe de analistas
  selectedReportType: 'operative' | 'user-stats' = 'operative';
  selectedUserId = 'all';
  usersList: any[] = [];
  userStatsData: any = null;
  isUserStatsLoading = false;
  qualityNarrative = '';
  sanitizedQualityNarrative: SafeHtml | null = null;
  showAllCargos = false;
  userStatsAccessDenied = false;
  userStatsErrorMessage = '';
  
  // Datos para gráficos
  entriesTrendData: any[] = [];
  entriesByTypeData: any[] = [];
  incidentsByUserData: any[] = [];
  topTagsData: any[] = [];
  redsByServiceData: any[] = [];
  entriesByLogSourceData: any[] = [];
  newsletterRecipientsData: any[] = [];
  incidentRecipientsData: any[] = [];
  newsletterDomainsData: any[] = [];
  incidentClientsData: any[] = [];
  criticalityCombinedData: any[] = [];
  criticalityComparisonData: any[] = [];
  generationTrendData: any[] = [];
  deliveryTrendData: any[] = [];
  hourlyActivityData: any[] = [];
  deliveryStatusSummaryData: any[] = [];
  statusByTypeSeriesData: any[] = [];
  recipientsByTypeData: any[] = [];
  
  // Configuración de gráficos
  view: [number, number] = [700, 300];
  trendView: [number, number] = [1200, 320];
  logSourceBarView: [number, number] = [520, 320];
  logSourcePieView: [number, number] = [420, 320];
  mailChartView: [number, number] = [520, 320];
  mailPieView: [number, number] = [420, 320];
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
  
  logoUrl = '';
  private backendBaseUrl = environment.backendBaseUrl;

  constructor(
    private reportService: ReportService,
    private configService: ConfigService,
    private userService: UserService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.updateTrendView();
    this.applyThemeColorSchemes();
    this.loadOverview();
    this.initPeriodDates();
    this.generatePeriodReport();
    this.loadLogo();
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
    this.mailChartView = [cardWidth, 320];
    this.mailPieView = [Math.max(320, cardWidth - 40), 320];
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

    this.reportService.getMailAnalytics(this.selectedDays).subscribe({
      next: (data) => {
        this.mailAnalytics = data;
        this.prepareMailAnalyticsData();
      },
      error: (err) => console.error('Error cargando analítica de correo:', err)
    });
  }
  
  onPeriodChange(days: number): void {
    this.selectedDays = days;
    this.loadOverview();
    if (this.selectedReportType === 'user-stats') {
      this.loadUserStats();
    }
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

  prepareMailAnalyticsData(): void {
    if (!this.mailAnalytics) return;

    this.newsletterRecipientsData = this.mailAnalytics.recipientBreakdown.newsletter;
    this.incidentRecipientsData = this.mailAnalytics.recipientBreakdown.incident;
    this.newsletterDomainsData = this.mailAnalytics.domainBreakdown.newsletter;
    this.incidentClientsData = this.mailAnalytics.clientBreakdown.incident;
    this.criticalityCombinedData = this.mailAnalytics.criticalityBreakdown.combined;
    this.criticalityComparisonData = this.mailAnalytics.criticalityComparison;
    this.generationTrendData = this.mailAnalytics.generationTrend;
    this.deliveryTrendData = this.mailAnalytics.deliveryStatusTrend;
    this.hourlyActivityData = this.mailAnalytics.hourlyActivity;
    this.deliveryStatusSummaryData = this.mailAnalytics.deliveryStatusSummary;
    this.statusByTypeSeriesData = this.mailAnalytics.statusByTypeSeries;
    this.recipientsByTypeData = [
      { name: 'Boletines', value: this.mailAnalytics.recipientCounts.newsletter },
      { name: 'Incidentes', value: this.mailAnalytics.recipientCounts.incident }
    ];
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

  // --- Informe de Período Consolidados ---
  presetSelected = 'semana';
  reportStartDate = '';
  reportEndDate = '';
  showPeriodReportPreview = false;
  isGeneratingPeriodReport = false;
  periodReportData: PeriodSummaryReport | null = null;
  todayDate = new Date();

  /**
   * Inicializa las fechas del informe en base al preset semanal (últimos 7 días)
   */
  initPeriodDates(): void {
    const today = new Date();
    this.reportEndDate = today.toISOString().split('T')[0];
    
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 7);
    this.reportStartDate = pastDate.toISOString().split('T')[0];
  }

  /**
   * Cambia el rango de fechas al seleccionar un preset predefinido
   */
  onPresetChange(): void {
    const today = new Date();
    this.reportEndDate = today.toISOString().split('T')[0];

    let daysToSubtract = 7;
    if (this.presetSelected === 'quincena') {
      daysToSubtract = 15;
    } else if (this.presetSelected === 'mes') {
      daysToSubtract = 30;
    } else if (this.presetSelected === 'personalizado') {
      return;
    }

    const pastDate = new Date();
    pastDate.setDate(today.getDate() - daysToSubtract);
    this.reportStartDate = pastDate.toISOString().split('T')[0];
    
    // Generación automática tras cambio de preset
    this.generatePeriodReport();
  }

  /**
   * Consulta al backend las métricas y la narrativa generada para el período seleccionado
   */
  generatePeriodReport(): void {
    if (!this.reportStartDate || !this.reportEndDate) return;
    this.isGeneratingPeriodReport = true;
    this.showPeriodReportPreview = false;
    
    this.reportService.getPeriodSummary(this.reportStartDate, this.reportEndDate).subscribe({
      next: (data: any) => {
        this.periodReportData = data;
        this.showPeriodReportPreview = true;
        this.isGeneratingPeriodReport = false;
      },
      error: (err: any) => {
        console.error('Error generando reporte de período:', err);
        this.isGeneratingPeriodReport = false;
      }
    });
  }

  /**
   * Ejecuta el diálogo de impresión nativo del navegador
   */
  printReport(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }



  /**
   * Carga el logo personalizado de branding
   */
  loadLogo(): void {
    this.configService.getLogo().subscribe({
      next: (response) => {
        this.logoUrl = response.logoUrl || '';
      },
      error: () => {
        this.logoUrl = '';
      }
    });
  }

  /**
   * Construye la URL de activos
   */
  getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.backendBaseUrl}${url}`;
  }

  /**
   * Calcula los días analizados
   */
  calculateReportDays(start: string | Date, end: string | Date): number {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    // Reiniciar horas para el cálculo de días completos
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    const diffTime = Math.abs(e.getTime() - s.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Incluir ambos días
    return diffDays;
  }

  /**
   * Cambia el tipo de reporte a visualizar (Operativo vs Analistas)
   */
  onReportTypeChange(type: 'operative' | 'user-stats'): void {
    this.selectedReportType = type;
    if (type === 'user-stats') {
      this.loadUserStats();
    }
  }

  /**
   * Cambia el usuario seleccionado para filtrar las métricas de analistas
   */
  onUserChange(userId: string): void {
    this.selectedUserId = userId;
    this.loadUserStats();
  }

  /**
   * Consulta al servicio las estadísticas y calidad de registro del analista
   */
  loadUserStats(): void {
    this.isUserStatsLoading = true;
    this.userStatsData = null;
    this.userStatsAccessDenied = false;
    this.userStatsErrorMessage = '';
    this.reportService.getUserStats(this.selectedDays, this.selectedUserId, this.showAllCargos).subscribe({
      next: (data: any) => {
        this.userStatsData = data;
        this.isUserStatsLoading = false;
        this.usersList = data.usersList || [];
        this.generateQualityNarrative();
      },
      error: (err: any) => {
        console.error('Error cargando estadísticas de analista:', err);
        this.isUserStatsLoading = false;
        if (err.status === 403 || err.status === 401) {
          this.userStatsAccessDenied = true;
          this.userStatsErrorMessage = err.error?.message || 'Acceso denegado: permisos insuficientes para consultar estadísticas de analistas.';
        }
      }
    });
  }

  /**
   * Genera el texto dinámico explicativo (Narrativa en Lenguaje Humano)
   * del desempeño, calidad e identificadores de vicios operativos de los analistas.
   */
  generateQualityNarrative(): void {
    if (!this.userStatsData) {
      this.qualityNarrative = '';
      this.sanitizedQualityNarrative = null;
      return;
    }

    const d = this.userStatsData;
    let text = '';

    const tagsList = d.topTags && d.topTags.length > 0 
      ? d.topTags.slice(0, 5).map((t: any) => t.name).join(', ') 
      : 'Sin etiquetas asignadas';

    const clientsList = d.topClients && d.topClients.length > 0 
      ? d.topClients.slice(0, 5).map((c: any) => c.name).join(', ') 
      : 'Sin clientes específicos';

    if (d.reportMode === 'individual') {
      const uName = d.user.fullName;
      text += `El analista **${uName}** registró un volumen de **${d.totalEntries} entradas** en el período seleccionado.\n\n`;
      
      if (d.absence) {
        text += `### **⚠️ Ausencia en Turno Detectada**\n\n`;
        text += `* **Motivo de la Ausencia:** Se identificó que el analista registra **${d.absence.absenceLabel}** en este período.\n`;
        text += `* **Tiempo de ausencia:** Estuvo fuera de funciones durante **${d.absence.absenceDays} días** dentro del rango evaluado.\n`;
        if (d.absence.onAbsenceNow) {
          text += `* **Estado actual:** Se encuentra actualmente en **${d.absence.absenceLabel} activa** (${d.absence.absencePeriodText}).\n`;
        }
        text += `\n`;
      }

      text += `### **Métricas de Jornada y Tiempos de Registro**\n\n`;
      text += `* **Frecuencia de Registro:** Presentó actividad en **${d.activeDays} de ${d.periodDays} días** evaluados.\n`;
      text += `* **Promedio General:** **${d.averageEntriesPerDay} entradas/día** (diluido en el período).\n`;
      text += `* **Promedio Operativo de Turno:** En los días con registros reales, ingresó un promedio de **${d.averageEntriesPerActiveDay} entradas por día activo**, lo que representa su ritmo real por jornada laboral.\n`;
      text += `* **Horario de Mayor Actividad:** Su mayor concentración de registros ocurre a las **${d.peakHour}**.\n\n`;

      text += `### **Resumen de Temáticas y Foco Técnico (Basado en Tags y Clientes)**\n\n`;
      text += `El analista concentró su actividad en dar soporte al cliente o clientes **${clientsList}**, categorizando sus registros principalmente con las etiquetas de **${tagsList}**. Esto refleja una labor concentrada en estos temas operacionales.\n\n`;
      text += `### **Score de Calidad de Registro: ${d.qualityScore}% (${d.qualityStatus})**\n\n`;
      
      const v = d.vicios;
      const tieneVicios = v.copyPaste || v.burstLogging || v.batching || v.extremesConcentration || v.shortEntries || v.routineOnly;
      
      if (tieneVicios && d.totalEntries > 0) {
        text += `**⚠️ Comportamientos y Desvíos Operativos Detectados:**\n\n`;
        if (v.copyPaste) {
          text += `* **Duplicidad de Registros (Copy-Paste) - ${v.copyPercent}% de las entradas:** Se identificaron bloques de texto repetitivos o idénticos. Esto distorsiona la métrica de eventos únicos y sugiere un relleno automatizado de información sin agregar valor técnico nuevo.\n`;
        }
        if (v.burstLogging) {
          text += `* **Registros en Ráfaga - ${v.burstPercent}% de las entradas:** Se registraron múltiples entradas operativas de forma continua en intervalos menores a 2 minutos. Este patrón ocurre habitualmente al intentar regularizar la bitácora de forma apresurada al final del turno, rompiendo el flujo histórico del estado de la infraestructura.\n`;
        }
        if (v.batching) {
          text += `* **Acumulación de Tickets en Lote - ${v.batchPercent}% de las entradas:** Se detectó la consolidación de múltiples tickets o incidentes en un solo bloque genérico de tipo operativo. Esto inhabilita el seguimiento individualizado de incidentes u ofensas en las métricas del SOC, impidiendo que el dashboard mapee correctamente la severidad de cada evento.\n`;
        }
        if (v.extremesConcentration) {
          text += `* **Concentración en Extremos de Turno - ${v.extremesPercent}% de las jornadas:** Toda la actividad de bitácora ocurre exclusivamente en los primeros y últimos 45 minutos de la jornada laboral, dejando vacíos de registros intermedios en tiempo real. Esto compromete la trazabilidad de eventos durante las horas centrales del turno.\n`;
        }
        if (v.shortEntries) {
          text += `* **Registros Simplificados - ${v.shortPercent}% de las entradas:** Entradas con un largo inferior a 40 caracteres (textos genéricos o repetitivos), aportando poco o nulo detalle técnico relevante para una auditoría posterior.\n`;
        }
        if (v.routineOnly) {
          text += `* **Rutina Exclusiva de Apertura/Cierre - ${v.routinePercent}% de los días activos:** Se identificó que las únicas entradas de la jornada laboral corresponden estrictamente a la rutina diaria de inicio y cierre de turno. No se registraron incidentes, análisis ni actividades técnicas durante las horas intermedias del turno, dejando vacía la trazabilidad técnica en tiempo real.\n`;
        }
      } else {
        text += `**🟢 Desempeño y Cumplimiento Óptimo:**\n\n`;
        text += `* El analista cumple con las buenas prácticas del SOC. Sus registros están bien detallados (largo promedio de **${d.averageContentLength} caracteres**), se distribuyen de forma regular durante su jornada de trabajo, y no se detectan patrones de copy-paste, acumulación de tickets o vacíos de registro temporal.\n`;
      }
    } else {
      // Modo consolidado grupal
      text += `Durante los últimos **${d.periodDays} días**, el equipo de analistas del SOC registró un volumen consolidado de **${d.totalEntries} entradas** en la bitácora.\n\n`;
      
      text += `### **Análisis de Tiempos y Actividad del Equipo**\n\n`;
      text += `* **Días de Operación Activa:** El SOC registró actividad en **${d.activeDays} de ${d.periodDays} días** evaluados.\n`;
      text += `* **Promedio General Diario:** El equipo mantiene un promedio de **${d.averageEntriesPerActiveDay} entradas por día de operación**.\n`;
      text += `* **Horario Pico General:** El horario de mayor registro de bitácoras por parte de los analistas consolidado fue a las **${d.peakHour}**.\n\n`;

      if (d.topAnalyst && d.topAnalyst.username !== 'N/A') {
        text += `* **Analista Más Activo:** **${d.topAnalyst.username}** lideró la bitácora con un volumen de **${d.topAnalyst.count} entradas**.\n`;
      }
      if (d.topIncidentReporter && d.topIncidentReporter.username !== 'N/A') {
        text += `* **Líder en Reporte de Incidentes:** **${d.topIncidentReporter.username}** fue el que documentó más incidentes y ofensas con **${d.topIncidentReporter.count} casos**.\n\n`;
      }

      text += `### **Temáticas y Foco Técnico del Equipo (Basado en Tags y Clientes)**\n\n`;
      text += `Las temáticas operativas del equipo SOC se enfocaron principalmente en los clientes **${clientsList}**, registrando eventos categorizados bajo las etiquetas de **${tagsList}**.\n\n`;

      text += `### **Diagnóstico de Calidad de Registro del Equipo:**\n\n`;
      const leaderboard = d.analystLeaderboard || [];
      const sosUsers = leaderboard.filter((u: any) => u.totalEntries > 0 && u.qualityScore < 50);
      const routineUsers = leaderboard.filter((u: any) => u.totalEntries > 0 && u.vicios.routineOnly);
      const stableUsers = leaderboard.filter((u: any) => u.totalEntries > 0 && u.qualityScore >= 75 && !u.vicios.routineOnly);
      const absentUsers = leaderboard.filter((u: any) => u.totalEntries === 0 && u.absence);

      text += `* **Estabilidad del Equipo:** Un total de **${stableUsers.length} de ${leaderboard.length} analistas** mantienen un estándar de calidad estable o excelente en sus registros.\n`;
      
      if (sosUsers.length > 0) {
        const sosNames = sosUsers.map((u: any) => u.fullName).join(', ');
        text += `* **Sospecha de Relleno o Ráfagas:** Se identificaron **${sosUsers.length} analista(s)** con un Score de Calidad bajo (**${sosNames}**), lo que sugiere que están completando la bitácora de forma apresurada en ráfagas o acumulando tickets.\n`;
      }
      
      if (routineUsers.length > 0) {
        const routineNames = routineUsers.map((u: any) => u.fullName).join(', ');
        text += `* **Rutina de Inicio/Cierre Exclusiva:** Se identificaron **${routineUsers.length} analista(s)** que limitan sus bitácoras casi exclusivamente al inicio y cierre de turno, omitiendo registros durante las horas intermedias de su jornada laboral (**${routineNames}**). Se recomienda revisar de forma interna ya que esto daña la visibilidad de los incidentes reales del turno.\n`;
      }

      if (absentUsers.length > 0) {
        const absentNames = absentUsers.map((u: any) => `${u.fullName} (${u.absence.absenceLabel})`).join(', ');
        text += `* **Ausencias Justificadas (Licencias/Vacaciones):** Se identificaron **${absentUsers.length} analista(s)** sin registros debido a licencias médicas o vacaciones en el período consultado (**${absentNames}**). Sus evaluaciones de calidad fueron neutralizadas.\n`;
      }
      
      if (sosUsers.length === 0 && routineUsers.length === 0) {
        text += `* **Fidelidad General:** No se registran desvíos críticos de calidad ni sospechas de rutina exclusiva de inicio/cierre en el equipo de analistas activos durante este período.\n`;
      }

      // Detalle Empírico de Hallazgos por Analista (Argumentos Fiables)
      const usersWithObservations = leaderboard.filter((u: any) => u.totalEntries > 0 && (u.qualityScore < 75 || u.vicios.routineOnly));
      if (usersWithObservations.length > 0) {
        text += `\n### **Evidencias y Justificación de Calidad por Analista:**\n\n`;
        usersWithObservations.forEach((u: any) => {
          const v = u.vicios;
          text += `#### **${u.fullName} (${u.username})** — Score: **${u.qualityScore}%** (${u.qualityStatus})\n`;
          text += `Evaluación empírica en base a sus **${u.totalEntries} entradas** ingresadas durante **${u.activeDays} días activos**:\n`;
          
          let desvios = [];
          if (v.copyPaste) {
            const entriesCount = Math.round((v.copyPercent / 100) * u.totalEntries);
            desvios.push(`* **Plagio / Copia de Contenido (Copy-Paste) - ${v.copyPercent}% de sus entradas:** Se identificaron **${entriesCount} registros** con redacción o bloques de texto idénticos a otros ingresos previos, lo que diluye el valor de la documentación técnica individual.`);
          }
          if (v.burstLogging) {
            const entriesCount = Math.round((v.burstPercent / 100) * u.totalEntries);
            desvios.push(`* **Registros en Ráfaga - ${v.burstPercent}% de sus entradas:** Se identificaron **${entriesCount} ingresos** realizados de manera apresurada con una diferencia menor a 2 minutos entre sí, denotando regularizaciones tardías consolidadas.`);
          }
          if (v.batching) {
            const entriesCount = Math.round((v.batchPercent / 100) * u.totalEntries);
            desvios.push(`* **Acumulación de Tickets en Lote (Batching) - ${v.batchPercent}% de sus entradas:** Se detectaron **${entriesCount} registros** que agrupan y consolidan múltiples números de tickets o incidentes en una única entrada genérica, impidiendo la trazabilidad individualizada.`);
          }
          if (v.extremesConcentration) {
            const daysCount = Math.round((v.extremesPercent / 100) * u.activeDays);
            desvios.push(`* **Concentración en Extremos de Turno - ${v.extremesPercent}% de sus jornadas:** En **${daysCount} días**, toda su actividad de registro se concentró exclusivamente en los primeros y últimos 45 minutos de su turno, dejando vacías las horas centrales del mismo.`);
          }
          if (v.shortEntries) {
            const entriesCount = Math.round((v.shortPercent / 100) * u.totalEntries);
            desvios.push(`* **Entradas Cortas o Genéricas - ${v.shortPercent}% de sus entradas:** Se encontraron **${entriesCount} registros** con un largo inferior a 40 caracteres (checklist u operativas sin explicaciones), aportando poco detalle útil.`);
          }
          if (v.routineOnly) {
            const daysCount = Math.round((v.routinePercent / 100) * u.activeDays);
            desvios.push(`* **Rutina Exclusiva de Apertura/Cierre - ${v.routinePercent}% de sus jornadas:** En **${daysCount} días**, el analista únicamente subió las entradas de inicio y cierre de turno. No documentó ninguna tarea operativa ni incidentes intermedios.`);
          }

          if (desvios.length > 0) {
            text += desvios.join('\n') + '\n\n';
          } else {
            text += `* No se registran desvíos críticos. Su score se ve levemente afectado por ligeras concentraciones o descripciones breves.\n\n`;
          }
        });
      }
    }

    // Disclaimer de análisis automatizado
    text += `\n\n*⚠️ **Nota de Descargo:** Este es un análisis automatizado basado en algoritmos de detección de patrones de registro. Los resultados y scoring representan tendencias indicativas de cumplimiento. Se recomienda revisar detalladamente cada caso internamente antes de emitir opiniones o juicios definitivos.*`;

    this.qualityNarrative = text;
    const rawHtml = this.parseMarkdownToHtml(text);
    this.sanitizedQualityNarrative = this.sanitizer.bypassSecurityTrustHtml(rawHtml);
  }

  /**
   * Helper simple para convertir sintaxis básica de markdown a HTML para su renderizado
   */
  parseMarkdownToHtml(md: string): string {
    return md
      .replace(/#### (.*?)\n/g, '<h4>$1</h4>')
      .replace(/### (.*?)\n/g, '<h3>$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\* (.*?)\n/g, '<li>$1</li>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }
}
