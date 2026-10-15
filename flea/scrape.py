"""Polite, bounded Zero-K scraper. Only download from the official host."""
import html
import re
import time
from urllib.parse import urljoin, urlparse, quote
from urllib.request import Request, urlopen

BASE = 'https://zero-k.info'


def fetch(url, limit=4_000_000):
    if urlparse(url).hostname != 'zero-k.info':
        raise ValueError('Only zero-k.info URLs are allowed')
    url = quote(url, safe=':/?=&%')
    with urlopen(Request(url, headers={'User-Agent': 'Flea/0.1 (Zero-K replay archive)'}), timeout=40) as r:
        if urlparse(r.url).hostname != 'zero-k.info':
            raise ValueError('Unexpected redirect')
        data = r.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Response exceeds size limit')
        return data


def clean(value):
    return ' '.join(html.unescape(re.sub('<[^>]+>', ' ', value)).split())


def listing_ids(source):
    return list(dict.fromkeys(int(x) for x in re.findall(r'/Battles/Detail/(\d+)', source)))


def parse_detail(source, battle_id):
    fields = {}
    for a, b in re.findall(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>', source, re.S | re.I):
        fields[clean(a).rstrip(':')] = clean(b)
    map_match = re.search(r'title=["\']\$map\$(.*?)["\']', source)
    image = re.search(r'<img[^>]+src=["\']([^"\']+\.minimap\.jpg)', source)
    replay = re.search(r'href=["\'](/replays/[^"\']+\.sdfz)', source)
    players = []
    teams = re.split(r'<div[^>]+class=["\'][^"\']*battle_spec[^"\']*["\'][^>]*>', source)[1:]
    for index, block in enumerate(teams):
        if re.search(r'>\s*Spectators\s*<', block):
            continue
        team = re.search(r'Team\s+(\d+)', block)
        for match in re.finditer(r"<img[^>]+src=['\"](/img/ranks/([^'\"]+)\.png)['\"][^>]*>\s*<a[^>]+href=['\"]/Users/Detail/(\d+)['\"][^>]*>(.*?)</a>", block, re.S):
            players.append({'id': int(match[3]), 'name': clean(match[4]), 'rank': match[2],
                            'rankIcon': BASE + match[1], 'team': int(team[1]) if team else index + 1})
    duration = fields.get('Duration', '')
    seconds = sum(int(n) * {'hour': 3600, 'minute': 60, 'second': 1}[u] for n, u in re.findall(r'(\d+)\s+(hour|minute|second)', duration))
    mode = 'Co-op' if fields.get('Bots') == 'True' else ('1v1' if len(players) == 2 and len({p['team'] for p in players}) == 2 else 'Teams')
    if len({p['team'] for p in players}) > 2:
        mode = 'FFA'
    return {'id': battle_id, 'title': fields.get('Title', f'Battle {battle_id}'),
            'map': clean(map_match[1]) if map_match else 'Unknown map',
            'mapImage': urljoin(BASE, html.unescape(image[1])) if image else None,
            'players': players, 'mode': mode, 'duration': seconds,
            'engine': fields.get('Engine version'), 'game': fields.get('Game version'),
            'started': fields.get('Started'), 'rating': fields.get('Rating', 'Unrated'),
            'source': f'{BASE}/Battles/Detail/{battle_id}',
            'download': urljoin(BASE, html.unescape(replay[1])) if replay else None}


def scrape(db, pages=3):
    from .store import upsert
    count = 0
    seen = set()
    for page in range(pages):
        ids = listing_ids(fetch(f'{BASE}/Battles' + (f'?offset={page * 40}' if page else '')).decode())
        if not ids:
            raise ValueError('Replay listing returned no battle IDs; source markup may have changed')
        if not set(ids) - seen:
            break
        seen.update(ids)
        for bid in ids:
            if db.execute('SELECT 1 FROM replays WHERE id=?', (bid,)).fetchone():
                continue
            time.sleep(1)
            replay = parse_detail(fetch(f'{BASE}/Battles/Detail/{bid}').decode(), bid)
            if not replay['download']:
                continue
            upsert(db, replay)
            count += 1
        time.sleep(1)
    db.execute("INSERT OR REPLACE INTO state VALUES('last_scrape',datetime('now'))")
    db.commit()
    return count
