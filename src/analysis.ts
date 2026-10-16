import { createReadStream } from 'node:fs';
import type { Analysis, EngineEvent } from './types.js';

const TYPES = new Set(['meta', 'player', 'created', 'finished', 'destroyed', 'position', 'team_died', 'game_over']);

export class InvalidExport extends Error {}

async function* records(path: string): AsyncGenerator<string> {
  let pending = '', bytes = 0, count = 0;
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 16_384 })) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 64_000_000) throw new InvalidExport('Export exceeds 64 MB limit');
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.length > 65_536 || ++count > 500_000) throw new InvalidExport('Export record limit exceeded');
      yield line;
    }
    if (pending.length > 65_536) throw new InvalidExport('Export line limit exceeded');
  }
  if (pending.trim()) {
    if (++count > 500_000) throw new InvalidExport('Export record limit exceeded');
    yield pending;
  }
}

const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const identity = (value: unknown): boolean => nonnegative(value) && Number.isSafeInteger(value);

export async function analyze(path: string): Promise<Analysis> {
  const events: EngineEvent[] = [];
  const players: Record<string, EngineEvent> = {};
  let meta: EngineEvent = { type: 'meta' };
  const production = new Map<string, { team: string; unit: string; count: number }>();
  const firstFactories: Analysis['firstFactories'] = {};
  const movements: Record<string, EngineEvent[]> = {};
  let complete = false;
  let duration = 0;

  for await (const line of records(path)) {
    if (!line.trim()) continue;
    let event: EngineEvent;
    try { event = JSON.parse(line) as EngineEvent; } catch { throw new InvalidExport('Invalid JSON export'); }
    if (!event || typeof event !== 'object' || !TYPES.has(event.type)) throw new InvalidExport('Unknown event type');
    if (complete) throw new InvalidExport('Record after game_over');
    if (event.type === 'meta') {
      if (meta.mapWidth) throw new InvalidExport('Duplicate metadata');
      if (!nonnegative(event.mapWidth) || !event.mapWidth || !nonnegative(event.mapHeight) || !event.mapHeight) throw new InvalidExport('Invalid map dimensions');
      if (event.positionSampleSeconds !== undefined && (!Number.isSafeInteger(event.positionSampleSeconds) || event.positionSampleSeconds <= 0 || event.positionSampleSeconds > 3600)) throw new InvalidExport('Invalid position sampling interval');
      meta = event;
      continue;
    }
    if (event.type === 'player') {
      if (!identity(event.team) || typeof event.name !== 'string' || !event.name.trim()) throw new InvalidExport('Invalid player identity');
      players[String(event.team)] = event;
      continue;
    }
    const seconds = event.time;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      throw new InvalidExport('Invalid event time');
    }
    duration = Math.max(duration, seconds);
    if (event.type !== 'game_over' && !identity(event.team)) throw new InvalidExport('Invalid team identity');
    if (['created', 'finished', 'destroyed', 'position'].includes(event.type) && !identity(event.unitId)) throw new InvalidExport('Invalid unit identity');
    if (['created', 'finished', 'destroyed'].includes(event.type) && (typeof event.unit !== 'string' || !event.unit)) throw new InvalidExport('Missing unit name');
    if (event.type === 'position' && (!nonnegative(event.x) || !nonnegative(event.z))) throw new InvalidExport('Invalid position');
    if (event.type === 'game_over') complete = true;
    if (event.type === 'finished') {
      const team = String(event.team);
      const unit = String(event.unit);
      const key = `${team}\0${unit}`;
      const current = production.get(key);
      production.set(key, { team, unit, count: (current?.count ?? 0) + 1 });
      if (event.factory === true && (!firstFactories[team] || seconds < firstFactories[team]!.time)) firstFactories[team] = { unit, time: seconds };
    }
    if (event.type === 'position') {
      const id = String(event.unitId);
      (movements[id] ??= []).push(event);
    } else {
      events.push(event);
    }
  }

  if (!complete) throw new InvalidExport('Incomplete engine export: game_over marker missing');
  if (meta.fullView !== true) throw new InvalidExport('Replay exporter did not obtain full spectator view');
  if (!meta.mapWidth || !meta.mapHeight) throw new InvalidExport('Missing map dimensions');
  events.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  return {
    events,
    players,
    meta,
    firstFactories,
    production: [...production.values()],
    unitCount: [...production.values()].reduce((sum, item) => sum + item.count, 0),
    movements,
    duration,
  };
}
