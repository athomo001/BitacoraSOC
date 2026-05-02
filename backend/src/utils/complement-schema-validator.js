/**
 * File Purpose: backend/src/utils/complement-schema-validator.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const ajv = new Ajv({
  allErrors: true,
  strict: false
});

const schemaDirs = [
  path.resolve(__dirname, '../schemas'),
  path.resolve(__dirname, '../../../shared/schemas')
];
const schemaCache = new Map();

const loadSchema = (fileName) => {
  if (schemaCache.has(fileName)) {
    return schemaCache.get(fileName);
  }

  const schemaPath = schemaDirs
    .map((dir) => path.join(dir, fileName))
    .find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) {
    throw new Error(`Schema no encontrado: ${fileName}`);
  }

  const parsed = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(parsed);
  schemaCache.set(fileName, validate);
  return validate;
};

const validateSchema = (fileName, payload) => {
  const validate = loadSchema(fileName);
  const valid = validate(payload);
  return {
    valid,
    errors: validate.errors || []
  };
};

module.exports = {
  validateSchema
};