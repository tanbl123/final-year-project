"""ShoeAR recommender — Flask API.

Endpoints (all return {"items": [{"productId", "score"}]}):
  GET  /health                              service + model status
  GET  /recommend/similar?productId=&k=     content-based item-item
  GET  /recommend/for-you?customerId=&k=     personalized weighted hybrid
  GET  /recommend/trending?k=                best-sellers
  POST /reload                               retrain from the latest DB data

The PHP backend proxies to these and enriches the returned productIds into full
product cards, so this service stays a thin ML layer.
"""
from flask import Flask, request, jsonify

import config
from recommender import HybridRecommender

app = Flask(__name__)
rec = HybridRecommender()


def _k(default=10):
    try:
        return max(1, min(50, int(request.args.get('k', default))))
    except (TypeError, ValueError):
        return default


@app.get('/health')
def health():
    return jsonify({'status': 'ok', 'trained': rec.trained, **(rec.stats() if rec.trained else {})})


@app.get('/recommend/similar')
def similar():
    product_id = (request.args.get('productId') or '').strip()
    if not product_id:
        return jsonify({'error': 'productId is required'}), 400
    return jsonify({'items': rec.similar(product_id, _k())})


@app.get('/recommend/for-you')
def for_you():
    customer_id = (request.args.get('customerId') or '').strip()
    if not customer_id:
        return jsonify({'error': 'customerId is required'}), 400
    return jsonify({'items': rec.for_you(customer_id, _k())})


@app.get('/recommend/trending')
def trending():
    return jsonify({'items': rec.trending(_k())})


@app.post('/reload')
def reload_model():
    return jsonify({'status': 'reloaded', **rec.train()})


# Train once at startup so the first request is fast. Best-effort: if the DB
# isn't reachable yet, the service still boots and /reload can retrain later.
try:
    rec.train()
    print('[recommender] trained:', rec.stats())
except Exception as e:  # pragma: no cover
    print('[recommender] initial train failed (will retry on /reload):', e)


if __name__ == '__main__':
    # Serve behind a real WSGI server (waitress) so there's no "development
    # server" warning and it behaves like a production deployment. Falls back to
    # Flask's built-in server if waitress isn't installed.
    try:
        from waitress import serve
        print(f'[recommender] serving on http://127.0.0.1:{config.PORT} (waitress)')
        serve(app, host='127.0.0.1', port=config.PORT)
    except ImportError:
        app.run(host='127.0.0.1', port=config.PORT, debug=False)
