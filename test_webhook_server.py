#!/usr/bin/env python3
"""
Simple webhook receiver for testing Campux webhook functionality.
Usage: python3 test_webhook_server.py [port]
"""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            print(f"\n{'='*60}")
            print(f"[{timestamp}] Webhook received!")
            print(f"{'='*60}")
            print(f"Event Type: {data.get('event', 'unknown')}")
            print(f"Post ID: {data.get('post', {}).get('id', 'N/A')}")
            print(f"Post Status: {data.get('post', {}).get('status', 'N/A')}")
            print(f"Post Text: {data.get('post', {}).get('text', 'N/A')[:50]}...")
            print(f"Anonymous: {data.get('post', {}).get('anon', 'N/A')}")
            print(f"Timestamp: {data.get('timestamp', 'N/A')}")
            print(f"\nFull payload:")
            print(json.dumps(data, indent=2, ensure_ascii=False))
            print(f"{'='*60}\n")
            
        except json.JSONDecodeError:
            print(f"[{datetime.now()}] Invalid JSON received")
            print(f"Raw data: {post_data.decode('utf-8', errors='ignore')}")
        
        # Send response
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "received"}).encode())
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    
    print(f"Starting Webhook Test Server on port {port}")
    print(f"Add this URL to Campux webhooks: http://localhost:{port}/webhook")
    print(f"Press Ctrl+C to stop\n")
    
    server = HTTPServer(('', port), WebhookHandler)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down webhook server...")
        server.shutdown()
