import { FastifyInstance } from 'fastify';
import { validateLogEntry } from './validation';
//import { insertLogs } from './repository';
import { enqueueLogs, BackpressureError } from './write-buffer';
import { ValidLogEntry, RejectedEntry } from './types';

interface IngestRequestBody {
  logs?: unknown;
}

export async function logsIngestRoutes(app: FastifyInstance) {
  app.post('/logs', async (request, reply) => {
    const body = request.body as IngestRequestBody | undefined;

    if (!body || typeof body !== 'object' || !Array.isArray(body.logs)) {
      return reply.code(400).send({
        error: 'request body must be an object with a "logs" array',
      });
    }

    const rawEntries = body.logs;

    if (rawEntries.length === 0) {
      return reply.code(400).send({
        error: 'logs array must not be empty',
      });
    }

    const validEntries: ValidLogEntry[] = [];
    const rejected: RejectedEntry[] = [];

    rawEntries.forEach((raw, index) => {
      const result = validateLogEntry(raw);
      if (result.valid) {
        validEntries.push(result.entry);
      } else {
        rejected.push({ index, reason: result.reason });
      }
    });

    if (validEntries.length === 0) {
      return reply.code(400).send({
        accepted: 0,
        rejected,
      });
    }

    try {
      await enqueueLogs(validEntries);
    } catch (err) {
      if (err instanceof BackpressureError) {
       
        return reply
          .code(503)
          .header('Retry-After', '1')
          .send({ error: 'server is under heavy load, please retry shortly' });
      }
      throw err;
    }

    return reply.code(200).send({
      accepted: validEntries.length,
      rejected,
    });
  });
}