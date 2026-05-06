/**
 * File Purpose: backend/src/controllers/directoryContactController.js
 * Responsibilities: CRUD and quick search handlers for centralized contacts.
 * QA Notes: Keep responses consistent for frontend autocomplete flows.
 */

const DirectoryContact = require('../models/DirectoryContact');
const Contact = require('../models/Contact');
const ExternalPerson = require('../models/ExternalPerson');
const RaciEntry = require('../models/RaciEntry');
const CatalogLogSource = require('../models/CatalogLogSource');
const User = require('../models/User');
const { syncManyDirectoryContacts, mergeDirectoryDuplicates } = require('../utils/directory-sync');
const { logger } = require('../utils/logger');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sanitizeText = (value, max = 180) => String(value ?? '').trim().slice(0, max);

const resolveScope = (body = {}, existing = {}, type = 'External') => {
  if (['Internal', 'External'].includes(body.scope)) {
    return body.scope;
  }
  if (['Internal', 'External'].includes(existing.scope)) {
    return existing.scope;
  }
  if (type === 'Internal') {
    return 'Internal';
  }
  return 'External';
};

const normalizePayload = (body = {}, existing = {}) => ({
  ...(existing.source ? { source: existing.source } : {}),
  name: sanitizeText(body.name ?? existing.name, 120),
  email: sanitizeText(body.email ?? existing.email, 180).toLowerCase(),
  phone: sanitizeText(body.phone ?? existing.phone, 80),
  company: sanitizeText(body.company ?? existing.company, 160),
  position: sanitizeText(body.position ?? existing.position, 120),
  type: ['Internal', 'External', 'List'].includes(body.type) ? body.type : (existing.type || 'External'),
  scope: resolveScope(body, existing, ['Internal', 'External', 'List'].includes(body.type) ? body.type : (existing.type || 'External')),
  isFavorite: body.isFavorite !== undefined ? Boolean(body.isFavorite) : Boolean(existing.isFavorite)
});

exports.listDirectoryContacts = async (req, res) => {
  try {
    await mergeDirectoryDuplicates();
    const { type, favorite } = req.query;
    const filter = {};
    if (type && ['Internal', 'External', 'List'].includes(type)) {
      filter.type = type;
    }
    if (favorite !== undefined) {
      filter.isFavorite = favorite === 'true';
    }

    const contacts = await DirectoryContact.find(filter)
      .sort({ isFavorite: -1, name: 1 })
      .limit(500);

    return res.json(contacts);
  } catch (error) {
    logger.error('Error in listDirectoryContacts:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.getDirectoryContactById = async (req, res) => {
  try {
    const contact = await DirectoryContact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }
    return res.json(contact);
  } catch (error) {
    logger.error('Error in getDirectoryContactById:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.createDirectoryContact = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ error: 'name es obligatorio' });
    }

    const created = await DirectoryContact.create(payload);
    return res.status(201).json(created);
  } catch (error) {
    logger.error('Error in createDirectoryContact:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.updateDirectoryContact = async (req, res) => {
  try {
    const existing = await DirectoryContact.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }
    if (existing.source === 'User') {
      return res.status(403).json({ error: 'Los contactos internos se administran desde Usuarios' });
    }

    const payload = normalizePayload(req.body, existing.toObject());
    if (!payload.name) {
      return res.status(400).json({ error: 'name es obligatorio' });
    }

    const oldSnapshot = {
      name: String(existing.name || '').trim(),
      email: String(existing.email || '').trim().toLowerCase(),
      phone: String(existing.phone || '').trim(),
      company: String(existing.company || '').trim()
    };

    Object.assign(existing, payload);
    await existing.save();

    const identityFilters = [];
    if (oldSnapshot.email) {
      identityFilters.push({ email: oldSnapshot.email });
    }
    if (oldSnapshot.name && oldSnapshot.phone) {
      identityFilters.push({ name: oldSnapshot.name, phone: oldSnapshot.phone });
    }
    if (oldSnapshot.name && oldSnapshot.company) {
      identityFilters.push({ name: oldSnapshot.name, organization: oldSnapshot.company });
    }
    if (oldSnapshot.name) {
      identityFilters.push({ name: oldSnapshot.name });
    }

    if (identityFilters.length > 0) {
      const contactSet = {
        name: payload.name,
        email: payload.email || '',
        phone: payload.phone || ''
      };
      if (payload.company !== undefined) {
        contactSet.organization = payload.company || '';
      }
      await Contact.updateMany({ $or: identityFilters }, { $set: contactSet });

      const externalSet = {
        name: payload.name,
        email: payload.email || '',
        phone: payload.phone || '',
        position: payload.position || ''
      };
      await ExternalPerson.updateMany({ $or: identityFilters }, { $set: externalSet });
    }

    const sameIdentity = (person = {}) => {
      const pName = String(person.name || '').trim().toLowerCase();
      const pEmail = String(person.email || '').trim().toLowerCase();
      const pPhone = String(person.phone || '').trim();
      const sameEmail = oldSnapshot.email && pEmail && pEmail === oldSnapshot.email;
      const sameNamePhone = oldSnapshot.name && oldSnapshot.phone
        && pName === oldSnapshot.name.toLowerCase()
        && pPhone === oldSnapshot.phone;
      const sameName = oldSnapshot.name && pName === oldSnapshot.name.toLowerCase();
      return sameEmail || sameNamePhone || sameName;
    };

    const raciEntries = await RaciEntry.find({
      $or: [
        { 'responsible.name': oldSnapshot.name },
        { 'accountable.name': oldSnapshot.name },
        { 'consulted.name': oldSnapshot.name },
        { 'informed.name': oldSnapshot.name },
        ...(oldSnapshot.email ? [
          { 'responsible.email': oldSnapshot.email },
          { 'accountable.email': oldSnapshot.email },
          { 'consulted.email': oldSnapshot.email },
          { 'informed.email': oldSnapshot.email }
        ] : [])
      ]
    });

    for (const entry of raciEntries) {
      let changed = false;
      ['responsible', 'accountable', 'consulted', 'informed'].forEach((role) => {
        const person = entry[role] || {};
        if (!sameIdentity(person)) {
          return;
        }
        entry[role] = {
          ...person,
          name: payload.name,
          email: payload.email || '',
          phone: payload.phone || ''
        };
        changed = true;
      });
      if (changed) {
        await entry.save();
      }
    }

    const clients = await CatalogLogSource.find({
      $or: [
        { 'escalationFlow.contactName': oldSnapshot.name },
        { 'escalationFlow.contacts.name': oldSnapshot.name }
      ]
    });

    for (const client of clients) {
      let changed = false;
      const flow = Array.isArray(client.escalationFlow) ? client.escalationFlow : [];
      flow.forEach((step) => {
        if (step?.type === 'pool') {
          (step.contacts || []).forEach((contact) => {
            const sameName = String(contact?.name || '').trim().toLowerCase() === oldSnapshot.name.toLowerCase();
            const samePhone = oldSnapshot.phone && String(contact?.tel || '').trim() === oldSnapshot.phone;
            if (sameName || samePhone) {
              contact.name = payload.name;
              contact.tel = payload.phone || '';
              changed = true;
            }
          });
          return;
        }
        const sameName = String(step?.contactName || '').trim().toLowerCase() === oldSnapshot.name.toLowerCase();
        const samePhone = oldSnapshot.phone && String(step?.contactTel || '').trim() === oldSnapshot.phone;
        if (sameName || samePhone) {
          step.contactName = payload.name;
          step.contactTel = payload.phone || '';
          changed = true;
        }
      });

      if (changed) {
        client.markModified('escalationFlow');
        await client.save();
      }
    }

    return res.json(existing);
  } catch (error) {
    logger.error('Error in updateDirectoryContact:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.deleteDirectoryContact = async (req, res) => {
  try {
    const deleted = await DirectoryContact.findById(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }
    if (deleted.source === 'User') {
      return res.status(403).json({ error: 'Los contactos internos no se eliminan desde el directorio' });
    }

    const email = String(deleted.email || '').trim().toLowerCase();
    const phone = String(deleted.phone || '').trim();
    const name = String(deleted.name || '').trim();
    const company = String(deleted.company || '').trim();

    const contactDeleteOr = [];
    if (email) {
      contactDeleteOr.push({ email });
    }
    if (name && phone) {
      contactDeleteOr.push({ name, phone });
    }
    if (name && company) {
      contactDeleteOr.push({ name, organization: company });
    }
    if (name) {
      contactDeleteOr.push({ name });
    }

    let removedFromContacts = 0;
    if (contactDeleteOr.length > 0) {
      const contactDeleteResult = await Contact.deleteMany({ $or: contactDeleteOr });
      removedFromContacts = Number(contactDeleteResult?.deletedCount || 0);
    }

    await DirectoryContact.findByIdAndDelete(req.params.id);

    return res.json({
      message: 'Contacto eliminado correctamente',
      removedFromContacts
    });
  } catch (error) {
    logger.error('Error in deleteDirectoryContact:', error);
    return res.status(400).json({ error: error.message });
  }
};

exports.searchDirectoryContacts = async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();
    if (query.length < 1) {
      return res.json([]);
    }
    if (query.length > 64) {
      return res.status(400).json({ error: 'query no puede superar 64 caracteres' });
    }

    const regex = new RegExp(escapeRegex(query), 'i');
    const contacts = await DirectoryContact.find({
      $or: [
        { name: regex },
        { email: regex },
        { company: regex }
      ]
    })
      .sort({ isFavorite: -1, name: 1 })
      .limit(20);

    return res.json(contacts);
  } catch (error) {
    logger.error('Error in searchDirectoryContacts:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.rebuildDirectoryFromEscalation = async (_req, res) => {
  try {
    const [contacts, externalPeople, raciEntries, clients, users] = await Promise.all([
      Contact.find({}).select('name email phone organization role favorite isMailingList').lean(),
      ExternalPerson.find({}).select('name email phone position').lean(),
      RaciEntry.find({}).select('responsible accountable consulted informed').lean(),
      CatalogLogSource.find({}).select('escalationFlow').lean(),
      User.find({ isActive: true, role: { $in: ['admin', 'user', 'auditor'] } })
        .select('fullName email phone cargoLabel role')
        .lean()
    ]);

    const payload = [];

    contacts.forEach((item) => {
      payload.push({
        name: item.name,
        email: item.email,
        phone: item.phone,
        organization: item.organization,
        role: item.role,
        favorite: item.favorite,
        isMailingList: item.isMailingList
      });
    });

    externalPeople.forEach((item) => {
      payload.push({
        name: item.name,
        email: item.email,
        phone: item.phone,
        position: item.position,
        type: 'External'
      });
    });

    raciEntries.forEach((entry) => {
      ['responsible', 'accountable', 'consulted', 'informed'].forEach((role) => {
        const person = entry?.[role] || {};
        payload.push({
          name: person.name,
          email: person.email,
          phone: person.phone,
          type: 'External'
        });
      });
    });

    clients.forEach((client) => {
      (client?.escalationFlow || []).forEach((step) => {
        if (step?.type === 'pool') {
          (step.contacts || []).forEach((contact) => {
            payload.push({
              name: contact?.name,
              phone: contact?.tel,
              type: 'External'
            });
          });
          return;
        }
        payload.push({
          name: step?.contactName,
          phone: step?.contactTel,
          type: 'External'
        });
      });
    });

    users.forEach((user) => {
      payload.push({
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        position: user.cargoLabel || user.role,
        type: 'Internal',
        scope: 'Internal',
        source: 'User'
      });
    });

    await syncManyDirectoryContacts(payload);

    const total = await DirectoryContact.countDocuments();
    return res.json({
      message: 'Directorio central sincronizado desde escalaciones',
      totalDirectoryContacts: total
    });
  } catch (error) {
    logger.error('Error in rebuildDirectoryFromEscalation:', error);
    return res.status(500).json({ error: error.message });
  }
};

exports.mergeDirectoryDuplicatesNow = async (_req, res) => {
  try {
    const result = await mergeDirectoryDuplicates();
    const total = await DirectoryContact.countDocuments();
    return res.json({
      message: 'Consolidación de duplicados completada',
      mergedGroups: Number(result?.mergedGroups || 0),
      removedDuplicates: Number(result?.removed || 0),
      totalDirectoryContacts: total
    });
  } catch (error) {
    logger.error('Error in mergeDirectoryDuplicatesNow:', error);
    return res.status(500).json({ error: error.message });
  }
};
