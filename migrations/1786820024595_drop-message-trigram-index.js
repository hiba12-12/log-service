exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropIndex('logs', ['message'], { name: 'idx_logs_message_trgm', ifExists: true });
};

exports.down = (pgm) => {
  pgm.createExtension('pg_trgm', { ifNotExists: true });
  pgm.createIndex('logs', [{ name: 'message', opclass: 'gin_trgm_ops' }], {
    name: 'idx_logs_message_trgm',
    method: 'gin',
  });
};