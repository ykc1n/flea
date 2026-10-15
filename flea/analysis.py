"""Validate engine events and derive production, factory and movement summaries."""
import json
import math
from collections import Counter

TYPES = {'meta', 'player', 'created', 'finished', 'destroyed', 'position', 'team_died', 'game_over'}


def analyze(path):
    events, players, meta = [], {}, {}
    production, first, movements = Counter(), {}, {}
    complete = False
    with open(path) as stream:
        for line in stream:
            event = json.loads(line)
            if event.get('type') not in TYPES:
                raise ValueError('Unknown event type')
            if event['type'] == 'meta':
                meta = event
                continue
            if event['type'] == 'player':
                players[str(event['team'])] = event
                continue
            sec = event.get('time')
            if not isinstance(sec, (int, float)) or not math.isfinite(sec) or sec < 0:
                raise ValueError('Invalid event time')
            if event['type'] == 'game_over':
                complete = True
            if event['type'] == 'finished':
                production[(str(event['team']), event['unit'])] += 1
                if event.get('factory'):
                    first.setdefault(str(event['team']), {'unit': event['unit'], 'time': sec})
            if event['type'] == 'position':
                movements.setdefault(str(event['unitId']), []).append(event)
            else:
                events.append(event)
    if not complete:
        raise ValueError('Incomplete engine export: game_over marker missing')
    if not meta or not meta.get('mapWidth') or not meta.get('mapHeight'):
        raise ValueError('Missing map dimensions')
    events.sort(key=lambda e: e['time'])
    return {'events': events, 'players': players, 'meta': meta, 'firstFactories': first,
            'production': [{'team': t, 'unit': u, 'count': n} for (t, u), n in production.items()],
            'unitCount': sum(production.values()), 'movements': movements,
            'duration': max((e['time'] for e in events), default=0)}
