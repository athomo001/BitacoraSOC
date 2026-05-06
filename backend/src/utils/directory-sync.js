/**
 * File Purpose: backend/src/utils/directory-sync.js
 * Responsibilities: Keep centralized directory synchronized from escalation data.
 * QA Notes: Prefer idempotent upsert rules to avoid duplicates.
 */

const DirectoryContact = require('../models/DirectoryContact');

const isEmptyLike = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (/^[-–—]+$/.test(normalized)) {
    return true;
  }
  return ['n/a', 'na', 'null', 'undefined', 'sin dato', 'sin datos'].includes(normalized);
};

const sanitize = (value, max = 180) => {
  const normalized = String(value ?? '').trim().slice(0, max);
  return isEmptyLike(normalized) ? '' : normalized;
};

const resolveDirectoryType = (payload = {}) => {
  if (payload.type && ['Internal', 'External', 'List'].includes(payload.type)) {
    return payload.type;
  }

  if (payload.isMailingList === true) {
    return 'List';
  }

  return 'External';
};

const resolveDirectoryScope = (payload = {}, resolvedType = 'External') => {
  if (payload.scope && ['Internal', 'External'].includes(payload.scope)) {
    return payload.scope;
  }
  if (resolvedType === 'Internal') {
    return 'Internal';
  }
  return 'External';
};

const resolveDirectorySource = (payload = {}) => {
  if (payload.source && ['User', 'Manual', 'Sync'].includes(payload.source)) {
    return payload.source;
  }
  return 'Sync';
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
    scope: resolveDirectoryScope(payload, resolveDirectoryType(payload)),
    source: resolveDirectorySource(payload),
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

const typePriority = {
  Internal: 3,
  External: 2,
  List: 1
};

const scopePriority = {
  Internal: 2,
  External: 1
};

const sourcePriority = {
  User: 3,
  Manual: 2,
  Sync: 1
};

const pickBestValue = (...values) => {
  for (const value of values) {
    const normalized = sanitize(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
};

const normalizeName = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const buildDuplicateKeys = (contact = {}) => {
  const keys = [];
  const email = sanitize(contact.email, 180).toLowerCase();
  const name = normalizeName(contact.name || '');
  const phone = sanitize(contact.phone, 80);
  const company = sanitize(contact.company, 160).toLowerCase();

  if (name) {
    keys.push(`name:${name}`);
  }
  if (email) {
    keys.push(`email:${email}`);
  }
  if (name && phone) {
    keys.push(`name_phone:${name}|${phone}`);
  }
  if (name && company) {
    keys.push(`name_company:${name}|${company}`);
  }
  return keys;
};

const mergeDirectoryDuplicates = async () => {
  const all = await DirectoryContact.find({}).sort({ createdAt: 1, _id: 1 });
  if (!Array.isArray(all) || all.length < 2) {
    return { mergedGroups: 0, removed: 0 };
  }

  const parent = new Map();
  const idToContact = new Map();
  const keyToIds = new Map();

  const find = (id) => {
    const current = parent.get(id) || id;
    if (current !== id) {
      const root = find(current);
      parent.set(id, root);
      return root;
    }
    return current;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  all.forEach((contact) => {
    const id = String(contact._id);
    parent.set(id, id);
    idToContact.set(id, contact);
    buildDuplicateKeys(contact).forEach((key) => {
      if (!keyToIds.has(key)) {
        keyToIds.set(key, []);
      }
      keyToIds.get(key).push(id);
    });
  });

  keyToIds.forEach((ids) => {
    if (!ids || ids.length < 2) return;
    const first = ids[0];
    for (let i = 1; i < ids.length; i += 1) {
      union(first, ids[i]);
    }
  });

  const groups = new Map();
  Array.from(idToContact.keys()).forEach((id) => {
    const root = find(id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(idToContact.get(id));
  });

  let mergedGroups = 0;
  let removed = 0;

  for (const [, contacts] of groups.entries()) {
    if (!contacts || contacts.length < 2) {
      continue;
    }

    const sorted = [...contacts].sort((a, b) => {
      const aScore = Number(!!a.email) + Number(!!a.phone) + Number(!!a.company) + Number(!!a.position);
      const bScore = Number(!!b.email) + Number(!!b.phone) + Number(!!b.company) + Number(!!b.position);
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      const aSource = sourcePriority[a.source] || 0;
      const bSource = sourcePriority[b.source] || 0;
      if (aSource !== bSource) {
        return bSource - aSource;
      }
      const aType = typePriority[a.type] || 0;
      const bType = typePriority[b.type] || 0;
      if (aType !== bType) {
        return bType - aType;
      }
      return 0;
    });

    const primary = sorted[0];
    const duplicates = sorted.slice(1);

    const mergedType = sorted.reduce((current, item) =>
      (typePriority[item.type] || 0) > (typePriority[current] || 0) ? item.type : current
    , primary.type || 'External');
    const mergedScope = sorted.reduce((current, item) =>
      (scopePriority[item.scope] || 0) > (scopePriority[current] || 0) ? item.scope : current
    , primary.scope || (mergedType === 'Internal' ? 'Internal' : 'External'));
    const mergedSource = sorted.reduce((current, item) =>
      (sourcePriority[item.source] || 0) > (sourcePriority[current] || 0) ? item.source : current
    , primary.source || 'Manual');

    const mergedPayload = {
      name: pickBestValue(primary.name, ...sorted.map((item) => item.name)),
      email: pickBestValue(primary.email, ...sorted.map((item) => item.email)).toLowerCase(),
      phone: pickBestValue(primary.phone, ...sorted.map((item) => item.phone)),
      company: pickBestValue(primary.company, ...sorted.map((item) => item.company)),
      position: pickBestValue(primary.position, ...sorted.map((item) => item.position)),
      type: mergedType,
      scope: mergedScope,
      source: mergedSource,
      isFavorite: sorted.some((item) => !!item.isFavorite)
    };

    primary.set(mergedPayload);
    await primary.save();

    if (duplicates.length > 0) {
      const duplicateIds = duplicates.map((item) => item._id);
      await DirectoryContact.deleteMany({ _id: { $in: duplicateIds } });
      removed += duplicates.length;
    }

    mergedGroups += 1;
  }

  return { mergedGroups, removed };
};

module.exports = {
  syncDirectoryContact,
  syncManyDirectoryContacts,
  mergeDirectoryDuplicates
};
