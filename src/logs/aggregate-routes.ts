import { FastifyInstance, FastifyRequest } from 'fastify';
import { parseAggregateQueryParams, queryAggregate, AggregateQueryParams } from './aggregate';

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

export async function logsAggregateRoutes(app: FastifyInstance) {
  app.get('/logs/aggregate', async (request: FastifyRequest, reply) => {
    const query = request.query as Record<string, unknown>;

    const rawParams: AggregateQueryParams = {
      service: typeof query.service === 'string' ? query.service : undefined,
      level: typeof query.level === 'string' ? query.level : undefined,
      q: typeof query.q === 'string' ? query.q : undefined,
      since: typeof query.since === 'string' ? query.since : undefined,
      until: typeof query.until === 'string' ? query.until : undefined,
      bucket: typeof query.bucket === 'string' ? query.bucket : undefined,
      group_by: typeof query.group_by === 'string' ? query.group_by : undefined,
      attrFilters: extractAttrFilters(query),
    };

    const parseResult = parseAggregateQueryParams(rawParams);

    if (!parseResult.valid) {
      return reply.code(400).send({ error: parseResult.error });
    }

    const result = await queryAggregate(parseResult.params);

    return reply.code(200).send(result);
  });
}