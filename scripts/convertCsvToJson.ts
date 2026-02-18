import fs from 'fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync'; // Usaremos 'csv-parse/sync' para un parseo síncrono

async function convertCsvToJson() {
  const csvFilePath = process.argv[2]; // Obtener la ruta del CSV como el primer argumento
  if (!csvFilePath) {
    console.error('Uso: node --loader ts-node/esm scripts/convertCsvToJson.ts <ruta_al_csv>');
    process.exit(1);
  }

  const outputJsonDir = path.resolve(process.cwd(), 'tariff_data'); // Resolver a ruta absoluta dentro de api
  const outputJsonFileName = "tarifario-costurera.json";

  try {
    const csvContent = await fs.readFile(csvFilePath, 'utf8');

    // Parsear el CSV
    const records = parse(csvContent, {
      columns: false, // No hay encabezados de columna explícitos
      skip_empty_lines: true,
      trim: true // Limpiar espacios en blanco de cada campo
    });

    // La primera línea es el título, la segunda la descripción
    const titulo = records[0][0];
    const descripcion = records[1][0];
    const itemsCsv = records.slice(2); // Los items empiezan desde la tercera línea

    const servicios = itemsCsv.map((row: string[]) => {
      const item = row[0] || 'Sin descripción';
      const precio = row[1] ? parseInt(row[1].replace(/[^0-9]/g, ''), 10) : 0; // Limpiar y convertir a número

      return { item, precio };
    }).filter(servicio => servicio.item !== 'Sin descripción' && servicio.precio > 0); // Filtrar items inválidos

    // Usar la fecha actual para el período, o una más genérica si no se especifica.
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('es-ES', { month: 'long' });

    const tariffData = {
      tarifario: {
        metadata: {
          titulo: titulo,
          organizacion: "Modista App",
          periodo: {
            inicio: `${currentMonth} ${currentYear}`,
            fin: `${currentMonth} ${currentYear + 1}`
          },
          descripcion: descripcion,
          nota_precios: "Precios de referencia para los servicios de costurera.",
          nota_adicional: "Los precios pueden variar según la complejidad del trabajo y el tipo de tela. Consultar presupuesto.",
          moneda: "ARS",
          contacto: {
            email: "contacto@modistaapp.com",
            nota: "Consultas por email o WhatsApp."
          },
          ultimaActualizacion: new Date().toISOString().split('T')[0],
          version: '1.0',
          notas: [
            descripcion,
            "Los precios de referencia son solo una guía, el presupuesto final se ajusta a cada trabajo.",
            "No incluye insumos (hilos, cierres, botones, etc.)."
          ].filter(Boolean)
        },
        content: {
          servicios: servicios
        }
      }
    };

    const outputJsonPath = path.join(outputJsonDir, outputJsonFileName);
    await fs.writeFile(outputJsonPath, JSON.stringify(tariffData, null, 2), 'utf8');
    console.log(`JSON de tarifario de costurera creado exitosamente en ${outputJsonPath}`);

  } catch (error) {
    console.error("Error al convertir CSV a JSON:", error);
    process.exit(1);
  }
}

convertCsvToJson();