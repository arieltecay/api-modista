import express from 'express';
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export interface TestResponse {
  status: number;
  body: unknown;
}

export interface TestServer {
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<TestResponse>;
  close: () => Promise<void>;
}

/** Starts an ephemeral Express app on a free port; `mount` receives the app after JSON parsing is set up. */
export const startTestServer = async (mount: (app: Express) => void): Promise<TestServer> => {
  const app = express();
  app.use(express.json());
  mount(app);

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    post: async (path, body, headers = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const isJson = response.headers.get('content-type')?.includes('application/json');
      return { status: response.status, body: isJson ? JSON.parse(text) : text || undefined };
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
