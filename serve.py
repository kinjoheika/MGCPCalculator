#!/usr/bin/env python3
"""Static server for the prototype that tells the browser never to cache.

python3 -m http.server leaves caching to the browser's guesswork, so after an edit
you can end up running a mix of old and new files — which looks like the app
"not loading". This serves the same folder with Cache-Control: no-store.

    python serve.py [port]        # default 8000
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '200' not in fmt % args:
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'MGC Pricing on http://localhost:{port}/ — files are served with no caching')
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
