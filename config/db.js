import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { logger } from '../services/logger.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error('Error connecting to MongoDB:', { message: error.message, stack: error.stack });
    process.exit(1);
  }
};

export default connectDB;
