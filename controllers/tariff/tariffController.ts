import { Request, Response } from 'express';
import { logError } from '../../services/logger.js';
import { DynamicItem, SearchResultItem } from '../../types/shared-tariff-types.js'; // Importar DynamicItem y SearchResultItem desde tipos compartidos
import Tariff, { ITariff } from '../../models/Tariff.js';

export const getTariffs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, periodIdentifier } = req.query;

    let query: any = { status: { $ne: 'inactive' } };
    if (type) {
      query.type = type;
    }
    if (periodIdentifier) {
      query.periodIdentifier = periodIdentifier;
    }

    let tariff: ITariff | null;

    if (Object.keys(query).length === 1) { // Solo status: 'active'
      tariff = await Tariff.findOne(query).sort({ startDate: -1 });
    } else if (type && !periodIdentifier) {
      tariff = await Tariff.findOne(query).sort({ startDate: -1 });
    } else {
      tariff = await Tariff.findOne(query);
    }

    if (!tariff) {
      res.status(404).json({ message: "Tarifario no encontrado." });
      return;
    }

    res.status(200).json(tariff);
  } catch (error) {
    logError("getTariffs", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener el tarifario." });
  }
};

export const getAvailableTariffMetadata = async (req: Request, res: Response): Promise<void> => {
  try {
    const projection = {
      type: 1,
      periodIdentifier: 1,
      startDate: 1,
      status: 1,
      'metadata.titulo': 1,
      'metadata.periodo.inicio': 1,
      'metadata.periodo.fin': 1,
    };

    // Public: only active (or documents without status field which we treat as active)
    const tariffsMeta = await Tariff.find({ status: { $ne: 'inactive' } })
      .select(projection)
      .sort({ startDate: -1 });

    const result = tariffsMeta.map(t => ({
      _id: t._id,
      type: t.type,
      title: t.metadata.titulo,
      status: t.status || 'active',
      periodDescription: `${t.metadata.periodo.inicio} a ${t.metadata.periodo.fin}`,
      periodIdentifier: t.periodIdentifier,
      startDate: t.startDate,
    }));

    res.status(200).json(result);
  } catch (error) {
    logError("getAvailableTariffMetadata", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los metadatos del tarifario." });
  }
};

export const getAdminTariffMetadata = async (req: Request, res: Response): Promise<void> => {
  try {
    const projection = {
      type: 1,
      periodIdentifier: 1,
      startDate: 1,
      status: 1,
      'metadata.titulo': 1,
      'metadata.periodo.inicio': 1,
      'metadata.periodo.fin': 1,
    };

    // Admin: all records
    const tariffsMeta = await Tariff.find({})
      .select(projection)
      .sort({ startDate: -1 });

    const result = tariffsMeta.map(t => ({
      _id: t._id,
      type: t.type,
      title: t.metadata.titulo,
      status: t.status || 'active',
      periodDescription: `${t.metadata.periodo.inicio} a ${t.metadata.periodo.fin}`,
      periodIdentifier: t.periodIdentifier,
      startDate: t.startDate,
    }));

    res.status(200).json(result);
  } catch (error) {
    logError("getAdminTariffMetadata", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los metadatos administrativos." });
  }
};

export const getTariffById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tariff = await Tariff.findById(id);

    if (!tariff) {
      res.status(404).json({ message: "Tarifario no encontrado." });
      return;
    }

    res.status(200).json(tariff);
  } catch (error) {
    logError("getTariffById", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener el tarifario." });
  }
};

export const createTariff = async (req: Request, res: Response): Promise<void> => {
  try {
    const tariffData: ITariff = req.body;
    const newTariff = new Tariff(tariffData);
    await newTariff.save();

    res.status(201).json(newTariff);
  } catch (error) {
    logError("createTariff", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al crear el tarifario." });
  }
};

export const updateTariff = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedTariff = await Tariff.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    if (!updatedTariff) {
      res.status(404).json({ message: "Tarifario no encontrado." });
      return;
    }

    res.status(200).json(updatedTariff);
  } catch (error) {
    logError("updateTariff", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al actualizar el tarifario." });
  }
};

export const deleteTariff = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deletedTariff = await Tariff.findByIdAndDelete(id);

    if (!deletedTariff) {
      res.status(404).json({ message: "Tarifario no encontrado." });
      return;
    }

    res.status(200).json({ message: "Tarifario eliminado correctamente." });
  } catch (error) {
    logError("deleteTariff", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al eliminar el tarifario." });
  }
};

export const duplicateTariff = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const original = await Tariff.findById(id);

    if (!original) {
      res.status(404).json({ message: "Tarifario original no encontrado." });
      return;
    }

    const duplicateData = original.toObject() as any;
    delete duplicateData._id;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    delete duplicateData.__v;

    duplicateData.periodIdentifier = `${duplicateData.periodIdentifier} (Copia)`;
    duplicateData.status = 'inactive';
    duplicateData.startDate = new Date();

    const newTariff = new Tariff(duplicateData);
    await newTariff.save();

    res.status(201).json(newTariff);
  } catch (error) {
    logError("duplicateTariff", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al duplicar el tarifario." });
  }
};

export const searchTariffItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, periodIdentifier, searchText } = req.query;

    if (!type || !periodIdentifier || !searchText) {
      res.status(400).json({ message: "Se requieren 'type', 'periodIdentifier' y 'searchText' para la búsqueda." });
      return;
    }

    const tariff = await Tariff.findOne({ type, periodIdentifier });

    if (!tariff) {
      res.status(404).json({ message: "Tarifario no encontrado con los criterios especificados." });
      return;
    }

    const lowerCaseSearchText = (searchText as string).toLowerCase();
    const foundItems: (DynamicItem & { sectionTitle: string })[] = [];

    for (const sectionKey in tariff.content) {
      if (Object.prototype.hasOwnProperty.call(tariff.content, sectionKey)) {
        const sectionContent = tariff.content[sectionKey];
        if (Array.isArray(sectionContent)) {
          const sectionItems = sectionContent as DynamicItem[];
          sectionItems.forEach(item => {
            const itemDescription = (item.item || item.descripcion || '').toLowerCase();
            if (itemDescription.includes(lowerCaseSearchText)) {
              let sectionTitle = sectionKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              if (tariff.type === 'modista' && sectionKey === 'serviciosModista') {
                sectionTitle = tariff.metadata.titulo;
              } else if (tariff.type === 'costurera' && sectionKey === 'servicios') {
                sectionTitle = "Servicios Generales";
              } else if (tariff.type === 'arreglos' && sectionKey === 'serviciosArreglos') {
                sectionTitle = "Servicios de Arreglos";
              }

              foundItems.push({
                ...item,
                sectionTitle: sectionTitle,
              });
            }
          });
        }
        else if (typeof sectionContent === 'object' && sectionContent !== null && Array.isArray(sectionContent.items)) {
          const sectionItems = sectionContent.items as DynamicItem[];
          sectionItems.forEach(item => {
            const itemDescription = (item.item || item.descripcion || '').toLowerCase();
            if (itemDescription.includes(lowerCaseSearchText)) {
              foundItems.push({ ...item, sectionTitle: sectionContent.nombre });
            }
          });
        }
      }
    }

    res.status(200).json(foundItems);
  } catch (error) {
    logError("searchTariffItems", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al buscar ítems del tarifario." });
  }
};
