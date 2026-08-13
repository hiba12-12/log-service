import { FastifyInstance, FastifyRequest } from 'fastify';
import { parseLogQueryParams, queryLogs, LogQueryParams } from './query';

function extractAttrFilters(query: Record<string, unknown>): Record<string, string> {
  const attrFilters: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('attr.') && typeof value === 'string') {
      const attrKey = key.slice('attr.'.length);
      if (attrKey) {
        attrFilters[attrKey] = value;
      }
    }
  }
  return attrFilters;
}

export async function logsQueryRoutes(app: FastifyInstance) {
  app.get('/logs', async (request: FastifyRequest, reply) => {
    const query = request.query as Record<string, unknown>;

    const rawParams: LogQueryParams = {
      service: typeof query.service === 'string' ? query.service : undefined,
      level: typeof query.level === 'string' ? query.level : undefined,
      since: typeof query.since === 'string' ? query.since : undefined,
      until: typeof query.until === 'string' ? query.until : undefined,
      q: typeof query.q === 'string' ? query.q : undefined,
      limit: typeof query.limit === 'string' ? query.limit : undefined,
      cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
      attrFilters: extractAttrFilters(query),
    };

    const parseResult = parseLogQueryParams(rawParams);

    if (!parseResult.valid) {
      return reply.code(400).send({ error: parseResult.error });
    }

    const result = await queryLogs(parseResult.params);

    return reply.code(200).send(result);
  });
}