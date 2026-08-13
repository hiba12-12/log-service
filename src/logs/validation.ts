import { LOG_LEVELS, LogLevel, RawLogEntry, ValidLogEntry, Attributes } from './types';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

type ValidationResult =
  | { valid: true; entry: ValidLogEntry }
  | { valid: false; reason: string };

export function validateLogEntry(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, reason: 'log entry must be an object' };
  }

  const entry = raw as RawLogEntry;

  if (entry.timestamp === undefined || entry.timestamp === null) {
    return { valid: false, reason: 'timestamp is required' };
  }
  if (typeof entry.timestamp !== 'string') {
    return { valid: false, reason: 'timestamp must be a string' };
  }
  const parsedDate = new Date(entry.timestamp);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, reason: `invalid timestamp: '${entry.timestamp}'` };
  }
  if (parsedDate.getTime() > Date.now() + FIVE_MINUTES_MS) {
    return { valid: false, reason: 'timestamp is more than five minutes in the future' };
  }

  if (entry.level === undefined || entry.level === null) {
    return { valid: false, reason: 'level is required' };
  }
  if (typeof entry.level !== 'string' || !LOG_LEVELS.includes(entry.level as LogLevel)) {
    return { valid: false, reason: `invalid level: '${entry.level}'` };
  }

  if (
    entry.service === undefined ||
    entry.service === null ||
    typeof entry.service !== 'string' ||
    entry.service.trim() === ''
  ) {
    return { valid: false, reason: 'service is required and must be a non-empty string' };
  }

  if (
    entry.message === undefined ||
    entry.message === null ||
    typeof entry.message !== 'string' ||
    entry.message.trim() === ''
  ) {
    return { valid: false, reason: 'message is required and must be a non-empty string' };
  }

  let attributes: Attributes = {};
  if (entry.attributes !== undefined && entry.attributes !== null) {
    if (
      typeof entry.attributes !== 'object' ||
      Array.isArray(entry.attributes)
    ) {
      return { valid: false, reason: 'attributes must be a flat object' };
    }

    const rawAttrs = entry.attributes as Record<string, unknown>;
    for (const key of Object.keys(rawAttrs)) {
      const value = rawAttrs[key];
      const valueType = typeof value;
      if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
        return {
          valid: false,
          reason: `attribute '${key}' must be a string, number, or boolean`,
        };
      }
      attributes[key] = value as string | number | boolean;
    }
  }

  return {
    valid: true,
    entry: {
      timestamp: entry.timestamp,
      level: entry.level as LogLevel,
      service: entry.service,
      message: entry.message,
      attributes,
    },
  };
}