const AppConfig = require('../models/AppConfig');

const normalizeAppTitle = (value) => String(value || '').trim();

const formatBrandedSubject = (appTitle, subject) => {
  const normalizedTitle = normalizeAppTitle(appTitle);
  const normalizedSubject = String(subject || '').trim();

  if (normalizedTitle && normalizedSubject) {
    return `[${normalizedTitle}] ${normalizedSubject}`;
  }

  return normalizedSubject || normalizedTitle;
};

const getAppTitleForText = (appTitle, fallback = 'el sistema') => {
  const normalizedTitle = normalizeAppTitle(appTitle);
  return normalizedTitle || fallback;
};

const getBrandingSnapshot = async () => {
  const config = await AppConfig.findOne().select('appTitle faviconUrl').lean();
  return {
    appTitle: normalizeAppTitle(config?.appTitle),
    faviconUrl: String(config?.faviconUrl || '').trim()
  };
};

module.exports = {
  normalizeAppTitle,
  formatBrandedSubject,
  getAppTitleForText,
  getBrandingSnapshot
};