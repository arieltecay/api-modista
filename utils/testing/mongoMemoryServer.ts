import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/** Starts an in-memory MongoDB and connects mongoose to it; returns the teardown function. */
export const startTestDb = async (): Promise<() => Promise<void>> => {
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());

  return async () => {
    await mongoose.disconnect();
    await server.stop();
  };
};

/** Index key specs of a collection, e.g. `{ visitId: 1 }`, ignoring the default `_id` index. */
export const listIndexKeys = async <T>(model: mongoose.Model<T>): Promise<Array<Record<string, number>>> => {
  await model.init();
  const indexes = await model.collection.indexes();
  return indexes.filter((index) => index.name !== '_id_').map((index) => index.key as Record<string, number>);
};
