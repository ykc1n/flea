export interface Player {
  id?: number;
  name: string;
  rank?: string;
  rankIcon?: string;
  team: number;
  lobbyId?: number;
}

export interface Replay {
  id: number;
  title: string;
  map: string;
  mapImage: string | null;
  players: Player[];
  mode: string;
  duration: number;
  engine: string | null;
  game: string | null;
  started: string | null;
  rating: string;
  source: string;
  download: string | null;
  demo?: boolean;
}

export interface EngineEvent {
  type: string;
  time?: number;
  team?: number;
  unit?: string;
  unitId?: number;
  factory?: boolean;
  mapWidth?: number;
  mapHeight?: number;
  fullView?: boolean;
  [key: string]: unknown;
}

export interface Analysis {
  events: EngineEvent[];
  players: Record<string, EngineEvent>;
  meta: EngineEvent;
  firstFactories: Record<string, { unit: string; time: number }>;
  production: Array<{ team: string; unit: string; count: number }>;
  unitCount: number;
  movements: Record<string, EngineEvent[]>;
  duration: number;
}

export interface ReplayView extends Replay {
  status: string;
  error: string | null;
  firstFactories: Analysis['firstFactories'];
  unitCount: number | null;
  analysis?: Analysis | null;
}
