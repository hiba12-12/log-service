exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropIndex('logs', ['timestamp'], { name: 'idx_logs_timestamp' });
};

exports.down = (pgm) => {
  pgm.createIndex('logs', ['timestamp'], { name: 'idx_logs_timestamp' });
};