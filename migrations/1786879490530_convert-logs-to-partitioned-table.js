/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.renameTable('logs', 'logs_old');

  pgm.sql(`
    DROP INDEX IF EXISTS idx_logs_timestamp_covering;
    DROP INDEX IF EXISTS idx_logs_service_timestamp;
    DROP INDEX IF EXISTS idx_logs_level_timestamp;
    DROP INDEX IF EXISTS idx_logs_attributes_gin;
  `);

  pgm.sql(`
    CREATE TABLE logs (
      id UUID DEFAULT gen_random_uuid(),
      timestamp TIMESTAMPTZ NOT NULL,
      level TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      attributes JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (id, timestamp)
    ) PARTITION BY RANGE (timestamp);
  `);

  pgm.sql(`CREATE TABLE logs_default PARTITION OF logs DEFAULT;`);

  const DAYS_BACK = 45;
  const DAYS_FORWARD = 10;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let offset = -DAYS_BACK; offset <= DAYS_FORWARD; offset++) {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() + offset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const startStr = start.toISOString();
    const endStr = end.toISOString();
    const partitionName = `logs_p${startStr.slice(0, 10).replace(/-/g, '')}`;

    pgm.sql(`
      CREATE TABLE ${partitionName} PARTITION OF logs
      FOR VALUES FROM ('${startStr}') TO ('${endStr}');
    `);
  }

  pgm.createIndex('logs', ['timestamp'], {
    name: 'idx_logs_timestamp_covering',
    include: ['service', 'level'],
  });
  pgm.createIndex('logs', ['service', 'timestamp'], { name: 'idx_logs_service_timestamp' });
  pgm.createIndex('logs', ['level', 'timestamp'], { name: 'idx_logs_level_timestamp' });
  pgm.createIndex('logs', ['attributes'], {
    name: 'idx_logs_attributes_gin',
    method: 'gin',
    opclass: 'jsonb_path_ops',
  });

  pgm.sql(`
    INSERT INTO logs (id, timestamp, level, service, message, attributes, created_at)
    SELECT id, timestamp, level, service, message, attributes, created_at FROM logs_old
    ON CONFLICT DO NOTHING;
  `);

  pgm.dropTable('logs_old');
};

exports.down = async (pgm) => {
  pgm.dropTable('logs', { cascade: true });
  pgm.sql(`
    CREATE TABLE logs (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      level TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      attributes JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};