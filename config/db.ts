import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { logger } from '../services/logger.js';

dotenv.config();

const connectDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      logger.error('Error: MONGODB_URI no está definida en las variables de entorno.');
      process.exit(1);
    }

    // Las opciones useNewUrlParser y useUnifiedTopology están obsoletas en las versiones recientes de Mongoose.
    await mongoose.connect(mongoUri);
    
    logger.info('MongoDB connected successfully.');
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Error connecting to MongoDB:', { message: error.message, stack: error.stack });
    } else {
      logger.error('An unknown error occurred while connecting to MongoDB:', { error });
    }
    process.exit(1);
  }
};

export default connectDB;
