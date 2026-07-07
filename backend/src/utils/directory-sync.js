/**
 * File Purpose: backend/src/utils/directory-sync.js
 * Responsibilities: Keep centralized directory synchronized from escalation data.
 * QA Notes: Prefer idempotent upsert rules to avoid duplicates.
 */

const DirectoryContact = require('../models/DirectoryContact');
const { sha256 } = require('./encryption');

const USER_SOURCE = 'User';

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

const normalizeEmail = (value = '') => sanitize(value, 180).toLowerCase();

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
  const filters = [];

  if (normalized.emailHash) {
    filters.push({ emailHash: normalized.emailHash });
  }

  if (normalized.phoneHash && normalized.name) {
    filters.push({ phoneHash: normalized.phoneHash, name: normalized.name });
  }

  if (normalized.name && normalized.company) {
    filters.push({ name: normalized.name, company: normalized.company });
  }

  if (normalized.name) {
    filters.push({ name: normalized.name });
  }

  if (filters.length === 0) return { name: '' };
  if (filters.length === 1) return filters[0];
  return { $or: filters };
};

const syncDirectoryContact = async (payload = {}) => {
  const name = sanitize(payload.name, 120);
  if (!name) return null;

  const normalized = {
    name,
    email: normalizeEmail(payload.email),
    emailHash: payload.email ? sha256(payload.email) : '',
    phone: sanitize(payload.phone, 80),
    phoneHash: payload.phone ? sha256(payload.phone) : '',
    company: sanitize(payload.company || payload.organization, 160),
    position: sanitize(payload.position || payload.role, 120),
    type: resolveDirectoryType(payload),
    scope: resolveDirectoryScope(payload, resolveDirectoryType(payload)),
    source: resolveDirectorySource(payload),
    isFavorite: Boolean(payload.isFavorite ?? payload.favorite ?? false)
  };

  const filter = buildUpsertFilter(normalized);
  const result = await DirectoryContact.findOneAndUpdate(
    filter,
    { $set: normalized },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Merge duplicates: if OR filter matched multiple contacts, consolidate to primary
  if (result && filter.$or && filter.$or.length > 1) {
    const otherMatches = await DirectoryContact.find({
      _id: { $ne: result._id },
      $or: filter.$or
    });
    if (otherMatches.length > 0) {
      const idsToRemove = otherMatches.map((m) => m._id);
      await DirectoryContact.deleteMany({ _id: { $in: idsToRemove } });
    }
  }

  return result;
};

const removeDirectoryContactsForUser = async (userLike = {}) => {
  const email = normalizeEmail(userLike.email);
  if (!email) {
    return 0;
  }

  const result = await DirectoryContact.deleteMany({
    source: USER_SOURCE,
    emailHash: sha256(email)
  });

  return Number(result?.deletedCount || 0);
};

const purgeStaleUserDirectoryContacts = async (activeUsers = []) => {
  const activeEmailHashes = activeUsers
    .map((user) => normalizeEmail(user?.email))
    .filter((email) => Boolean(email))
    .map((email) => sha256(email));

  const staleFilter = activeEmailHashes.length > 0
    ? {
      source: USER_SOURCE,
      $or: [
        { emailHash: { $exists: false } },
        { emailHash: '' },
        { emailHash: { $nin: activeEmailHashes } }
      ]
    }
    : { source: USER_SOURCE };

  const result = await DirectoryContact.deleteMany(staleFilter);
  return Number(result?.deletedCount || 0);
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

const levenshteinDistance = (a = '', b = '') => {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
};

const splitNameTokens = (value = '') =>
  normalizeName(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const companiesCompatible = (a = '', b = '') => {
  const left = sanitize(a, 160).toLowerCase();
  const right = sanitize(b, 160).toLowerCase();
  if (!left || !right) return true;
  return left === right;
};

const hasConflictingIdentity = (a = {}, b = {}) => {
  const aEmail = sanitize(a.email, 180).toLowerCase();
  const bEmail = sanitize(b.email, 180).toLowerCase();
  if (aEmail && bEmail && aEmail !== bEmail) return true;

  const aPhone = sanitize(a.phone, 80);
  const bPhone = sanitize(b.phone, 80);
  if (aPhone && bPhone && aPhone !== bPhone) return true;

  return false;
};

const areLikelySamePerson = (a = {}, b = {}) => {
  if (hasConflictingIdentity(a, b)) return false;

  const aName = normalizeName(a.name || '');
  const bName = normalizeName(b.name || '');
  if (!aName || !bName) return false;
  if (aName === bName) return true;

  if (!companiesCompatible(a.company, b.company)) return false;

  const aTokens = splitNameTokens(a.name || '');
  const bTokens = splitNameTokens(b.name || '');
  if (aTokens.length === 0 || bTokens.length === 0) return false;

  const firstA = aTokens[0];
  const firstB = bTokens[0];
  if (firstA !== firstB) return false;

  const lastA = aTokens[aTokens.length - 1] || '';
  const lastB = bTokens[bTokens.length - 1] || '';
  if (!lastA || !lastB) return false;

  const distance = levenshteinDistance(lastA, lastB);
  return distance <= 1 || lastA.includes(lastB) || lastB.includes(lastA);
};

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

  // Conservative fuzzy pass: merge same-first-name records with tiny last-name variations
  // when there is no email/phone conflict (e.g., "Simpson" vs "Simson").
  for (let i = 0; i < all.length; i += 1) {
    const left = all[i];
    for (let j = i + 1; j < all.length; j += 1) {
      const right = all[j];
      if (areLikelySamePerson(left, right)) {
        union(String(left._id), String(right._id));
      }
    }
  }

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
  mergeDirectoryDuplicates,
  removeDirectoryContactsForUser,
  purgeStaleUserDirectoryContacts
};
