import fs from 'fs/promises';
import path from 'path';
import { parse } from 'csv-parse/sync';

async function convertCsvToModistaJson() {
  const csvFilePath = "/Users/ariel/Downloads/Tarifarios - Modista.csv"; // Ruta fija según la solicitud
  const outputJsonDir = path.resolve(process.cwd(), 'tariff_data');
  const outputJsonFileName = "tarifario-modista.json";

  try {
    const csvContent = await fs.readFile(csvFilePath, 'utf8');

    const records = parse(csvContent, {
      columns: false,
      skip_empty_lines: true,
      trim: true
    });

    const tituloPrincipal = records[0][0];
    const seccionPrincipalTitle = records[1][0]; // "Moldería corte y confección"
    const itemsCsv = records.slice(2);

    const serviciosModista = itemsCsv.map((row: string[]) => {
      const item = row[0] || 'Sin descripción';
      const precio = row[1] ? parseInt(row[1].replace(/[^0-9]/g, ''), 10) : 0;
      return { item, precio };
    }).filter(servicio => servicio.item !== 'Sin descripción' && servicio.precio > 0);

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString('es-ES', { month: 'long' });

    const tariffData = {
      tarifario: {
        metadata: {
          titulo: tituloPrincipal,
          organizacion: "Modista App",
          periodo: {
            inicio: `${currentMonth} ${currentYear}`,
            fin: `${currentMonth} ${currentYear + 1}`
          },
          descripcion: `Precios para ${seccionPrincipalTitle.toLowerCase()}.`,
          nota_precios: "Precios de referencia para los servicios de modista.",
          nota_adicional: "Los precios pueden variar según la complejidad del trabajo y el tipo de tela. Consultar presupuesto.",
          moneda: "ARS",
          contacto: {
            email: "contacto@modistaapp.com",
            nota: "Consultas por email o WhatsApp."
          },
          ultimaActualizacion: new Date().toISOString().split('T')[0],
          version: '1.0',
          notas: [
            "Los precios de referencia son solo una guía, el presupuesto final se ajusta a cada trabajo.",
            "No incluye insumos (hilos, cierres, botones, etc.)."
          ].filter(Boolean)
        },
        content: {
          serviciosModista: serviciosModista
        }
      }
    };

    const outputJsonPath = path.join(outputJsonDir, outputJsonFileName);
    await fs.writeFile(outputJsonPath, JSON.stringify(tariffData, null, 2), 'utf8');
    console.log(`JSON de tarifario de modista creado exitosamente en ${outputJsonPath}`);

  } catch (error) {
    console.error("Error al convertir CSV de Modista a JSON:", error);
    process.exit(1);
  }
}

convertCsvToModistaJson();
