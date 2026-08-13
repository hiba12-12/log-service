import 'dotenv/config';
import Fastify from 'fastify';
import { checkDatabaseConnection } from './db';
import { logsIngestRoutes } from './logs/routes';
import { logsQueryRoutes } from './logs/query-routes';
import { logsAggregateRoutes } from './logs/aggregate-routes';
import { retentionAdminRoutes } from './retention/routes';
import { startRetentionScheduler } from './retention/scheduler';



const app = Fastify({
  logger: true,
});

// GET /health
app.get('/health', async (request, reply) => {
  const dbOk = await checkDatabaseConnection();

  if (!dbOk) {
    return reply.code(503).send({ status: 'not ready' });
  }

  return reply.code(200).send({ status: 'ok' });
});

// POST /logs 
app.register(logsIngestRoutes);
app.register(logsQueryRoutes);
app.register(logsAggregateRoutes);
app.register(retentionAdminRoutes);


const start = async () => {
  try {
    const port = 8080;
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
    startRetentionScheduler();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();