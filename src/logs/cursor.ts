interface CursorData {
  timestamp: string; // ISO string
  id: string;
}

export function encodeCursor(timestamp: string, id: string): string {
  const data: CursorData = { timestamp, id };
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const data = JSON.parse(json);

    if (
      typeof data !== 'object' ||
      data === null ||
      typeof data.timestamp !== 'string' ||
      typeof data.id !== 'string'
    ) {
      return null;
    }

    if (isNaN(new Date(data.timestamp).getTime())) {
      return null;
    }

    return { timestamp: data.timestamp, id: data.id };
  } catch {
    return null;
  }
}