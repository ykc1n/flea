import argparse
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from .store import connect, unpack

WEB = Path(__file__).resolve().parent.parent / 'web'


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' https://zero-k.info https://raw.githubusercontent.com; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        super().end_headers()

    def json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith('/api/'):
            return super().do_GET()
        db = connect()
        try:
            if url.path == '/api/status':
                states = dict(db.execute('SELECT key,value FROM state').fetchall())
                counts = dict(db.execute('SELECT status, count(*) FROM replays GROUP BY status').fetchall())
                return self.json({'states': states, 'counts': counts, 'processorConfigured': bool(os.environ.get('FLEA_PROCESSOR'))})
            if url.path == '/api/replays':
                q = parse_qs(url.query)
                search = q.get('q', [''])[0].lower()
                mode = q.get('mode', [''])[0]
                status = q.get('status', [''])[0]
                rows = db.execute('SELECT * FROM replays ORDER BY id DESC').fetchall()
                results = [unpack(r) for r in rows]
                results = [r for r in results if (not search or search in json.dumps(r).lower()) and (not mode or r['mode'] == mode) and (not status or r['status'] == status)]
                try:
                    offset = max(0, int(q.get('offset', ['0'])[0]))
                except ValueError:
                    return self.json({'error': 'Invalid offset'}, 400)
                return self.json({'total': len(results), 'items': results[offset:offset + 24]})
            if url.path.startswith('/api/replays/'):
                try:
                    bid = int(url.path.rsplit('/', 1)[-1])
                except ValueError:
                    return self.json({'error': 'Invalid replay ID'}, 400)
                row = db.execute('SELECT * FROM replays WHERE id=?', (bid,)).fetchone()
                return self.json(unpack(row, True)) if row else self.json({'error': 'Replay not found'}, 404)
            return self.json({'error': 'Not found'}, 404)
        finally:
            db.close()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8080)
    args = p.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(WEB)))
    print(f'Flea listening on http://{args.host}:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
