const fsSync = require('fs');
const { once } = require('events');

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function waitForFinish(stream) {
  await new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
}

/**
 * Escribe un JSON de backup en disco sin cargar toda la base en memoria.
 * Estructura de salida:
 * { metadata: {...}, data: { collectionA: [...], collectionB: [...] } }
 */
async function writeBackupJsonFile({ filePath, metadata, models }) {
  const stream = fsSync.createWriteStream(filePath, { encoding: 'utf8' });
  let totalDocuments = 0;

  try {
    await writeChunk(stream, '{\n  "metadata": ');
    await writeChunk(stream, JSON.stringify(metadata));
    await writeChunk(stream, ',\n  "data": {\n');

    const modelEntries = Object.entries(models);

    for (let i = 0; i < modelEntries.length; i++) {
      const [collectionName, Model] = modelEntries[i];

      if (!Model || typeof Model.find !== 'function') {
        throw new Error(`El modelo para ${collectionName} no está correctamente inicializado o es inválido.`);
      }

      await writeChunk(stream, `    ${JSON.stringify(collectionName)}: [`);

      let firstDoc = true;
      const cursor = Model.find().lean().cursor();

      for await (const doc of cursor) {
        if (!firstDoc) {
          await writeChunk(stream, ',');
        }
        await writeChunk(stream, JSON.stringify(doc));
        firstDoc = false;
        totalDocuments++;
      }

      await writeChunk(stream, ']');
      if (i < modelEntries.length - 1) {
        await writeChunk(stream, ',');
      }
      await writeChunk(stream, '\n');
    }

    await writeChunk(stream, '  }\n}\n');
    stream.end();
    await waitForFinish(stream);

    return totalDocuments;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

module.exports = {
  writeBackupJsonFile
};
