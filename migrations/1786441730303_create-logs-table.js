exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    timestamp: {
      type: 'timestamptz',
      notNull: true,
    },
    level: {
      type: 'text',
      notNull: true,
    },
    service: {
      type: 'text',
      notNull: true,
    },
    message: {
      type: 'text',
      notNull: true,
    },
    attributes: {
      type: 'jsonb',
      notNull: false,
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createIndex('logs', ['timestamp'], {
    name: 'idx_logs_timestamp',
    method: 'btree',
  });
  pgm.createIndex('logs', ['service', 'timestamp'], {
    name: 'idx_logs_service_timestamp',
  });
  pgm.createIndex('logs', ['level', 'timestamp'], {
    name: 'idx_logs_level_timestamp',
  });
  pgm.createIndex('logs', ['attributes'], {
    name: 'idx_logs_attributes_gin',
    method: 'gin',
    opclass: 'jsonb_path_ops',
  });
  pgm.createExtension('pg_trgm', { ifNotExists: true });
  pgm.createIndex('logs', [{ name: 'message', opclass: 'gin_trgm_ops' }], {
  name: 'idx_logs_message_trgm',
  method: 'gin',
});
};

exports.down = (pgm) => {
  pgm.dropTable('logs');
};