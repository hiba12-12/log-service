import { FastifyInstance } from 'fastify';
import { runRetentionCleanup } from './service';
import { getRetentionDays } from './scheduler';

export async function retentionAdminRoutes(app: FastifyInstance) {
  app.post('/admin/retention/run', async (request, reply) => {
    const retentionDays = getRetentionDays();
    const deleted = await runRetentionCleanup(retentionDays);

    return reply.code(200).send({
      deleted,
      retention_days: retentionDays,
    });
  });
}