/**
 * Rutas de Reportes y Análisis SOC
 * 
 * Endpoints:
 *   GET /api/reports/overview        - KPIs y métricas SOC (admin)
 *   GET /api/reports/export-entries  - Exportar entradas a CSV (admin)
 * 
 * Funcionalidad:
 *   - Dashboard overview: aggregations MongoDB para calcular estadísticas
 *   - KPIs: entradas por tipo, incidentes por analista, tags más usados, servicios con rojos
 *   - Tendencias: series temporales de entradas (últimos N días)
 *   - Exports: CSV de entradas filtradas por rango de fechas
 * 
 * Reglas SOC:
 *   - Solo admin puede acceder (datos sensibles de toda la operación)
 *   - Timezone: America/Santiago (forzado en aggregations)
 *   - Performance: usar aggregation pipelines (evitar cargar todo en memoria)
 */
const express = require('express');
const router = express.Router();
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');

// GET /api/reports/overview - Vista general de KPIs
router.get('/overview', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);

    // 1. Total de entradas por tipo
    const entriesByType = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$entryType', count: { $sum: 1 } } }
    ]);

    // 2. Top usuarios por total de entradas (operativa + incidente)
    const incidentsByUser = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$createdByUsername', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // 3. Top tags
    const topTags = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);

    // 4. Checks con rojos por servicio
    const redsByService = await ShiftCheck.aggregate([
      { $match: { createdAt: { $gte: startDate }, hasRedServices: true } },
      { $unwind: '$services' },
      { $match: { 'services.status': 'rojo' } },
      { $group: { _id: '$services.serviceTitle', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // 5. Tendencia de entradas (últimos 30 días)
    const entriesTrend = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Santiago' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 6. Total usuarios activos
    const totalUsers = await User.countDocuments({ isActive: true });

    // 7. Total checks de turno
    const totalChecks = await ShiftCheck.countDocuments({ createdAt: { $gte: startDate } });

    await audit(req, {
      event: 'user.reports.overview.view',
      level: 'info',
      result: { success: true },
      metadata: { days: parsedDays }
    });

    res.json({
      period: `${days} días`,
      entriesByType: entriesByType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      incidentsByUser,
      topTags,
      redsByService,
      entriesTrend,
      totalUsers,
      totalChecks
    });
  } catch (error) {
    console.error('Error al generar reporte:', error);
    res.status(500).json({ message: 'Error al generar reporte' });
  }
});

// GET /api/reports/export-entries - Exportar entradas a CSV
// Solo admin puede exportar archivos
router.get('/export-entries', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const entries = await Entry.find(filter)
      .populate('createdBy', 'username fullName')
      .sort({ createdAt: -1 })
      .lean();

    // Generar CSV
    const csvHeader = 'ID,Fecha,Hora,Tipo,Contenido,Tags,Usuario,Es Invitado,Creado\n';
    const csvRows = entries.map(e => {
      const content = `"${(e.content || '').replace(/"/g, '""')}"`;
      const tags = e.tags.join('; ');
      return `${e._id},${e.entryDate.toISOString().split('T')[0]},${e.entryTime},${e.entryType},${content},${tags},${e.createdByUsername},${e.isGuestEntry},${e.createdAt.toISOString()}`;
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="entradas_${Date.now()}.csv"`);
    res.send('\ufeff' + csv); // BOM para UTF-8

    await audit(req, {
      event: 'user.reports.export.entries',
      level: 'info',
      result: { success: true },
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        exportedCount: entries.length
      }
    });
  } catch (error) {
    console.error('Error al exportar:', error);
    res.status(500).json({ message: 'Error al exportar datos' });
  }
});

// GET /api/reports/tags-trend - Tendencia de tags específicos
router.get('/tags-trend', authenticate, async (req, res) => {
  try {
    const { days = 30, tags } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    
    const tagsList = tags ? tags.split(',') : [];
    
    if (tagsList.length === 0) {
      return res.json([]);
    }
    
    // Tendencia para cada tag
    const trendsPromises = tagsList.map(async (tag) => {
      const trend = await Entry.aggregate([
        { 
          $match: { 
            createdAt: { $gte: startDate },
            tags: tag.trim()
          } 
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Santiago' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      
      return {
        tag: tag.trim(),
        trend
      };
    });
    
    const results = await Promise.all(trendsPromises);

    await audit(req, {
      event: 'user.reports.tags_trend.view',
      level: 'info',
      result: { success: true },
      metadata: {
        days: parsedDays,
        tagsCount: tagsList.length
      }
    });

    res.json(results);
  } catch (error) {
    console.error('Error al obtener tendencias de tags:', error);
    res.status(500).json({ message: 'Error al obtener tendencias de tags' });
  }
});

// GET /api/reports/heatmap - Mapa de calor día/hora
router.get('/heatmap', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    
    const heatmapData = await Entry.aggregate([
      {
        $match: {
          entryDate: { $gte: startDate },
          entryTime: { $regex: /^\d{2}:\d{2}/ }
        }
      },
      {
        $addFields: {
          entryDateTime: {
            $dateFromParts: {
              year: { $year: '$entryDate' },
              month: { $month: '$entryDate' },
              day: { $dayOfMonth: '$entryDate' },
              hour: { $toInt: { $substr: ['$entryTime', 0, 2] } },
              minute: { $toInt: { $substr: ['$entryTime', 3, 2] } },
              timezone: 'America/Santiago'
            }
          }
        }
      },
      {
        $group: {
          _id: {
            dayOfWeek: { $dayOfWeek: { date: '$entryDateTime', timezone: 'America/Santiago' } },
            hour: { $hour: { date: '$entryDateTime', timezone: 'America/Santiago' } }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          dayOfWeek: { $subtract: ['$_id.dayOfWeek', 1] },
          hour: '$_id.hour',
          count: '$count'
        }
      },
      { $sort: { dayOfWeek: 1, hour: 1 } }
    ]);

    await audit(req, {
      event: 'user.reports.heatmap.view',
      level: 'info',
      result: { success: true },
      metadata: {
        days: parsedDays,
        buckets: heatmapData.length
      }
    });
    
    res.json(heatmapData);
  } catch (error) {
    console.error('Error al generar heatmap:', error);
    res.status(500).json({ message: 'Error al generar heatmap' });
  }
});

// GET /api/reports/entries-by-logsource - Entradas por Log Source (Cliente)
router.get('/entries-by-logsource', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const parsedDays = parseInt(days, 10) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parsedDays);
    
    const entriesBySource = await Entry.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$clientName',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);
    
    // Transformar para NGX-Charts (name, value)
    const data = entriesBySource.map(item => ({
      name: item._id || 'Sin asignar',
      value: item.count
    }));

    await audit(req, {
      event: 'user.reports.entries_by_logsource.view',
      level: 'info',
      result: { success: true },
      metadata: {
        days: parsedDays,
        items: data.length
      }
    });
    
    res.json(data);
  } catch (error) {
    console.error('Error al obtener entradas por log source:', error);
    res.status(500).json({ message: 'Error al obtener entradas por log source' });
  }
});

module.exports = router;
