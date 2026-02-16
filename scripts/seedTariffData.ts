import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import Tariff from '../models/Tariff.js';
import connectDB from '../config/db.js';
import { logger } from '../services/logger.js';

dotenv.config();

const seedTariffData = async () => {
  await connectDB();

  try {
    const tariffDataDir = path.resolve(process.cwd(), 'tariff_data');
    const files = await fs.readdir(tariffDataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    if (jsonFiles.length === 0) {
      logger.warn('No se encontraron archivos JSON en tariff_data/. Saliendo del seed.');
      await mongoose.disconnect();
      process.exit(0);
      return;
    }

    await Tariff.deleteMany({});
    logger.info('Datos de tarifas existentes eliminados.');

    for (const fileName of jsonFiles) {
      const filePath = path.join(tariffDataDir, fileName);
      const rawData = await fs.readFile(filePath, 'utf-8');
      const fullJson = JSON.parse(rawData);

      if (!fullJson.tarifario) {
        logger.error(`Error en el archivo '${fileName}': No se encontró la clave "tarifario" de nivel superior.`);
        continue;
      }
      const tariffJson = fullJson.tarifario;

      const typeMatch = fileName.match(/^tarifario-(.+)\.json$/);
      if (!typeMatch || !typeMatch[1]) {
        logger.warn(`Saltando archivo '${fileName}': Nombre no coincide con el patrón esperado 'tarifario-TYPE.json'.`);
        continue;
      }
      const type = typeMatch[1];

      if (!tariffJson.periodo || !tariffJson.periodo.inicio || !tariffJson.periodo.fin || !tariffJson.titulo || !tariffJson.organizacion || !tariffJson.descripcion || !tariffJson.moneda || !tariffJson.nota_precios || !tariffJson.nota_adicional || !tariffJson.contacto || !tariffJson.contacto.email || !tariffJson.contacto.nota) {
        logger.error(`Error en el archivo '${fileName}': Falta información esencial en la estructura "tarifario".`);
        logger.error(`Contenido problemático: ${JSON.stringify(tariffJson, null, 2)}`);
        continue;
      }

      const periodIdentifier = `${tariffJson.periodo.inicio} a ${tariffJson.periodo.fin}`;

      let startDate: Date;
      try {
        const [monthName, year] = tariffJson.periodo.inicio.split(' ');
        startDate = new Date(`${monthName} 1, ${year}`);
        if (isNaN(startDate.getTime())) {
            throw new Error('Invalid date');
        }
      } catch (dateError) {
          logger.error(`Error en el archivo '${fileName}': No se pudo parsear la fecha de inicio '${tariffJson.periodo.inicio}'.`);
          continue;
      }


      const {
        titulo, organizacion, periodo, descripcion, nota_precios, nota_adicional, moneda, contacto,
        nota_actualizacion, nota_final,
        ...content
      } = tariffJson;

      const notesArray = [descripcion, nota_precios, nota_adicional, nota_actualizacion, nota_final].filter(Boolean); // Consolidar todas las notas


      const newTariff = new Tariff({
        type: type,
        periodIdentifier: periodIdentifier,
        startDate: startDate,
        metadata: {
          titulo: titulo,
          organizacion: organizacion,
          periodo: {
            inicio: periodo.inicio,
            fin: periodo.fin,
          },
          descripcion: descripcion,
          nota_precios: nota_precios,
          nota_adicional: nota_adicional,
          moneda: moneda,
          contacto: contacto,
          ultimaActualizacion: new Date().toISOString().split('T')[0],
          version: '1.0',
          notas: notesArray,
        },
        content: content,
      });

      await newTariff.save();
      logger.info(`Tarifario '${type}' para el período '${periodIdentifier}' cargado exitosamente.`);
    }

    logger.info('Todos los datos de tarifas cargados exitosamente en la base de datos.');
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Error al cargar los datos de tarifas:', { message: error.message, stack: error.stack });
    } else {
      logger.error('Error desconocido al cargar los datos de tarifas:', { error });
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('Conexión a MongoDB cerrada.');
    process.exit(0);
  }
};

seedTariffData();
