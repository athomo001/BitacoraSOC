/**
 * File Purpose: backend/src/utils/directory-sync.js
 * Responsibilities: Keep centralized directory synchronized from escalation data.
 * QA Notes: Prefer idempotent upsert rules to avoid duplicates.
 */

const DirectoryContact = require('../models/DirectoryContact');

const sanitize = (value, max = 180) => String(value ?? '').trim().slice(0, max);

const resolveDirectoryType = (payload = {}) => {
  if (payload.type && ['Internal', 'External', 'List'].includes(payload.type)) {
    return payload.type;
  }

  if (payload.isMailingList === true) {
    return 'List';
  }

  return 'External';
};

const buildUpsertFilter = (normalized) => {
  if (normalized.email) {
    return { email: normalized.email };
  }

  if (normalized.phone && normalized.name) {
    return { phone: normalized.phone, name: normalized.name };
  }

  return {
    name: normalized.name,
    company: normalized.company || ''
  };
};

const syncDirectoryContact = async (payload = {}) => {
  const name = sanitize(payload.name, 120);
  if (!name) return null;

  const normalized = {
    name,
    email: sanitize(payload.email, 180).toLowerCase(),
    phone: sanitize(payload.phone, 80),
    company: sanitize(payload.company || payload.organization, 160),
    position: sanitize(payload.position || payload.role, 120),
    type: resolveDirectoryType(payload),
    isFavorite: Boolean(payload.isFavorite ?? payload.favorite ?? false)
  };

  const filter = buildUpsertFilter(normalized);
  return DirectoryContact.findOneAndUpdate(
    filter,
    { $set: normalized },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const syncManyDirectoryContacts = async (contacts = []) => {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return;
  }
  await Promise.allSettled(contacts.map((contact) => syncDirectoryContact(contact)));
};

module.exports = {
  syncDirectoryContact,
  syncManyDirectoryContacts
};
