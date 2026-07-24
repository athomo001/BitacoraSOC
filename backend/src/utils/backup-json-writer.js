const fsSync = require('fs');

/**
 * Escribe un fragmento de datos (chunk) en el stream de manera asíncrona.
 * Controla el evento 'drain' para evitar saturar la memoria y captura errores del stream.
 * 
 * @param {WritableStream} stream - Stream de escritura destino.
 * @param {string} chunk - Fragmento de datos a escribir.
 * @returns {Promise<void>}
 */
async function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    // Si el stream ya ha sido destruido por un error previo, rechazamos de inmediato
    if (stream.destroyed) {
      return reject(new Error('El stream de escritura de backup fue destruido.'));
    }

    // Si write() devuelve true, el búfer no está lleno y podemos continuar
    if (stream.write(chunk)) {
      return resolve();
    }

    // Si write() devuelve false, esperamos al evento 'drain' o a que ocurra un error
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };

    const onError = (err) => {
      stream.off('drain', onDrain);
      reject(err);
    };

    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

/**
 * Espera a que el stream emita el evento 'finish', indicando que todos los datos
 * pendientes se han escrito físicamente en el disco.
 * 
 * @param {WritableStream} stream - Stream de escritura a monitorear.
 * @returns {Promise<void>}
 */
async function waitForFinish(stream) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      return reject(new Error('El stream de escritura de backup fue destruido antes de finalizar.'));
    }

    const onFinish = () => {
      stream.off('error', onError);
      resolve();
    };

    const onError = (err) => {
      stream.off('finish', onFinish);
      reject(err);
    };

    stream.once('finish', onFinish);
    stream.once('error', onError);
  });
}

/**
 * Genera y escribe un archivo JSON de respaldo de la base de datos de forma secuencial.
 * Utiliza cursores para evitar sobrecargar la memoria RAM con grandes volúmenes de datos.
 * 
 * @param {Object} options - Parámetros de configuración.
 * @param {string} options.filePath - Ruta absoluta del archivo JSON de destino.
 * @param {Object} options.metadata - Metadatos informativos del respaldo.
 * @param {Object} options.models - Diccionario con los modelos de Mongoose a respaldar.
 * @returns {Promise<number>} Cantidad total de documentos respaldados.
 */
async function writeBackupJsonFile({ filePath, metadata, models }) {
  const stream = fsSync.createWriteStream(filePath, { encoding: 'utf8' });
  
  // Registramos un listener de error inmediatamente tras la creación del stream.
  // Esto previene que fallos de apertura de archivos (como EACCES por permisos denegados)
  // se lancen como Uncaught Exceptions y provoquen la caída del proceso de Node.js.
  let streamError = null;
  const onStreamError = (err) => {
    streamError = err;
  };
  stream.on('error', onStreamError);

  let totalDocuments = 0;

  try {
    // Función auxiliar para verificar si se registró algún fallo asíncrono en el stream
    const checkStreamError = () => {
      if (streamError) {
        throw streamError;
      }
    };

    checkStreamError();
    await writeChunk(stream, '{\n  "metadata": ');
    checkStreamError();
    await writeChunk(stream, JSON.stringify(metadata));
    checkStreamError();
    await writeChunk(stream, ',\n  "data": {\n');

    const modelEntries = Object.entries(models);

    for (let i = 0; i < modelEntries.length; i++) {
      const [collectionName, Model] = modelEntries[i];

      if (!Model || typeof Model.find !== 'function') {
        throw new Error(`El modelo para ${collectionName} no está correctamente inicializado o es inválido.`);
      }

      checkStreamError();
      await writeChunk(stream, `    ${JSON.stringify(collectionName)}: [`);

      let firstDoc = true;
      const cursor = Model.find().lean().cursor();

      for await (const doc of cursor) {
        checkStreamError();
        if (!firstDoc) {
          await writeChunk(stream, ',');
        }
        await writeChunk(stream, JSON.stringify(doc));
        firstDoc = false;
        totalDocuments++;
      }

      checkStreamError();
      await writeChunk(stream, ']');
      if (i < modelEntries.length - 1) {
        await writeChunk(stream, ',');
      }
      await writeChunk(stream, '\n');
    }

    checkStreamError();
    await writeChunk(stream, '  }\n}\n');
    
    // Finalizamos la escritura del stream y esperamos que se confirme la persistencia en disco
    stream.end();
    await waitForFinish(stream);

    return totalDocuments;
  } catch (error) {
    // Si ocurre un error, nos aseguramos de destruir el stream para liberar los descriptores de archivo
    stream.destroy();
    throw error;
  } finally {
    // Removemos el event listener global para evitar fugas de memoria
    stream.off('error', onStreamError);
  }
}

module.exports = {
  writeBackupJsonFile
};
