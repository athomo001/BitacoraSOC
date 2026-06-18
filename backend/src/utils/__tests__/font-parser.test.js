/**
 * File Purpose: backend/src/utils/__tests__/font-parser.test.js
 * Responsibilities: Pruebas unitarias para el analizador de archivos de fuentes tipográficas (font-parser.js).
 * QA Notes: Simula buffers binarios SFNT (TTF/OTF) reales para verificar el correcto comportamiento de la extracción.
 */

const fs = require('fs').promises;
const { getFontName } = require('../font-parser');

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn()
  }
}));

describe('Pruebas Unitarias del Analizador de Fuentes (font-parser)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debe lanzar un error si el buffer del archivo de fuente es demasiado corto (menor a 12 bytes)', async () => {
    fs.readFile.mockResolvedValue(Buffer.from([0, 1, 2, 3]));
    await expect(getFontName('dummy.ttf')).rejects.toThrow('El archivo de fuente es demasiado corto o corrupto');
  });

  it('debe lanzar un error si no se encuentra la tabla "name" en el directorio de tablas', async () => {
    // Cabecera SFNT con 1 tabla, pero con un tag diferente a "name" (ej. "head")
    const header = Buffer.alloc(12);
    header.writeUInt16BE(1, 4); // numTables = 1

    const tableRecord = Buffer.alloc(16);
    tableRecord.write('head', 0, 'ascii'); // Tag no es "name"
    tableRecord.writeUInt32BE(1234, 4);    // checksum
    tableRecord.writeUInt32BE(28, 8);      // offset
    tableRecord.writeUInt32BE(50, 12);     // length

    const buffer = Buffer.concat([header, tableRecord]);
    fs.readFile.mockResolvedValue(buffer);

    await expect(getFontName('dummy.ttf')).rejects.toThrow('No se encontró la tabla de nombres (name table) en la fuente');
  });

  it('debe extraer exitosamente el nombre de familia de la fuente utilizando codificación UTF-16BE (Windows/Unicode)', async () => {
    // Cabecera SFNT
    const header = Buffer.alloc(12);
    header.writeUInt16BE(1, 4); // numTables = 1

    // Directorio de tablas - Registro de tabla "name"
    const tableRecord = Buffer.alloc(16);
    tableRecord.write('name', 0, 'ascii');
    tableRecord.writeUInt32BE(0, 4);       // checksum
    tableRecord.writeUInt32BE(28, 8);      // offset (empieza en byte 28)
    tableRecord.writeUInt32BE(34, 12);     // length de la tabla

    // Estructura de la tabla "name"
    const nameTableHeader = Buffer.alloc(6);
    nameTableHeader.writeUInt16BE(0, 0);   // format = 0
    nameTableHeader.writeUInt16BE(1, 2);   // count = 1 (1 registro de nombre)
    nameTableHeader.writeUInt16BE(18, 4);  // stringOffset (6 bytes de cabecera + 12 bytes por registro = 18)

    // Registro de nombre (NameRecord)
    const nameRecord = Buffer.alloc(12);
    nameRecord.writeUInt16BE(3, 0);        // platformID = 3 (Windows)
    nameRecord.writeUInt16BE(1, 2);        // encodingID = 1
    nameRecord.writeUInt16BE(1033, 4);     // languageID = 1033 (English - US)
    nameRecord.writeUInt16BE(1, 6);        // nameID = 1 (Font Family Name)
    nameRecord.writeUInt16BE(16, 8);       // length = 16 bytes (8 caracteres en UTF-16BE)
    nameRecord.writeUInt16BE(0, 10);       // string offset = 0

    // Contenido del string: "MockFont" en UTF-16BE
    const fontNameString = Buffer.from('\0M\0o\0c\0k\0F\0o\0n\0t', 'ascii'); // 16 bytes

    const buffer = Buffer.concat([
      header,
      tableRecord,
      nameTableHeader,
      nameRecord,
      fontNameString
    ]);

    fs.readFile.mockResolvedValue(buffer);

    const detectedName = await getFontName('dummy.ttf');
    expect(detectedName).toBe('MockFont');
  });

  it('debe extraer exitosamente el nombre utilizando codificación ASCII (Macintosh)', async () => {
    // Cabecera SFNT
    const header = Buffer.alloc(12);
    header.writeUInt16BE(1, 4); // numTables = 1

    // Directorio de tablas - Registro de tabla "name"
    const tableRecord = Buffer.alloc(16);
    tableRecord.write('name', 0, 'ascii');
    tableRecord.writeUInt32BE(0, 4);       // checksum
    tableRecord.writeUInt32BE(28, 8);      // offset
    tableRecord.writeUInt32BE(25, 12);     // length de la tabla

    // Estructura de la tabla "name"
    const nameTableHeader = Buffer.alloc(6);
    nameTableHeader.writeUInt16BE(0, 0);   // format = 0
    nameTableHeader.writeUInt16BE(1, 2);   // count = 1
    nameTableHeader.writeUInt16BE(18, 4);  // stringOffset = 18

    // Registro de nombre (NameRecord)
    const nameRecord = Buffer.alloc(12);
    nameRecord.writeUInt16BE(1, 0);        // platformID = 1 (Macintosh)
    nameRecord.writeUInt16BE(0, 2);        // encodingID = 0
    nameRecord.writeUInt16BE(0, 4);        // languageID = 0
    nameRecord.writeUInt16BE(1, 6);        // nameID = 1 (Font Family Name)
    nameRecord.writeUInt16BE(7, 8);        // length = 7 bytes
    nameRecord.writeUInt16BE(0, 10);       // string offset = 0

    // Contenido del string: "MacFont" en ASCII
    const fontNameString = Buffer.from('MacFont', 'ascii');

    const buffer = Buffer.concat([
      header,
      tableRecord,
      nameTableHeader,
      nameRecord,
      fontNameString
    ]);

    fs.readFile.mockResolvedValue(buffer);

    const detectedName = await getFontName('dummy.otf');
    expect(detectedName).toBe('MacFont');
  });

  it('debe lanzar un error si no se encuentra ningún NameRecord con nameID === 1 o 4 válido', async () => {
    // Cabecera SFNT
    const header = Buffer.alloc(12);
    header.writeUInt16BE(1, 4); // numTables = 1

    // Directorio de tablas
    const tableRecord = Buffer.alloc(16);
    tableRecord.write('name', 0, 'ascii');
    tableRecord.writeUInt32BE(0, 4);
    tableRecord.writeUInt32BE(28, 8);
    tableRecord.writeUInt32BE(26, 12);

    // Estructura de la tabla "name"
    const nameTableHeader = Buffer.alloc(6);
    nameTableHeader.writeUInt16BE(0, 0);
    nameTableHeader.writeUInt16BE(1, 2);
    nameTableHeader.writeUInt16BE(18, 4);

    // Registro de nombre (NameRecord) con nameID = 5 (Versión de fuente, no Familia)
    const nameRecord = Buffer.alloc(12);
    nameRecord.writeUInt16BE(3, 0);
    nameRecord.writeUInt16BE(1, 2);
    nameRecord.writeUInt16BE(1033, 4);
    nameRecord.writeUInt16BE(5, 6);        // nameID = 5 (Version)
    nameRecord.writeUInt16BE(8, 8);
    // Contenido del string: \0v\01\0.\00 en bytes
    const fontNameString = Buffer.from([0, 118, 0, 49, 0, 46, 0, 48]);

    const buffer = Buffer.concat([
      header,
      tableRecord,
      nameTableHeader,
      nameRecord,
      fontNameString
    ]);

    fs.readFile.mockResolvedValue(buffer);

    await expect(getFontName('dummy.ttf')).rejects.toThrow('No se pudo extraer la familia tipográfica interna de la fuente');
  });
});
