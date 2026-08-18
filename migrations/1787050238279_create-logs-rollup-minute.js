exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('logs_rollup_minute', {
    bucket_start: { type: 'timestamptz', notNull: true },
    service: { type: 'text', notNull: true },
    level: { type: 'text', notNull: true },
    count: { type: 'bigint', notNull: true, default: 0 },
  });

  pgm.addConstraint('logs_rollup_minute', 'logs_rollup_minute_pkey', {
    primaryKey: ['bucket_start', 'service', 'level'],
  });

  pgm.createIndex('logs_rollup_minute', ['bucket_start']);
};

exports.down = (pgm) => {
  pgm.dropTable('logs_rollup_minute');
};