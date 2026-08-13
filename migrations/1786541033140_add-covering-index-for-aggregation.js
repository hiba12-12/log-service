/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createIndex('logs', ['timestamp'], {
    name: 'idx_logs_timestamp_covering',
    include: ['service', 'level'],
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('logs', ['timestamp'], { name: 'idx_logs_timestamp_covering' });
};