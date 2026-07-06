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


@app.get('/metrics')
def metrics():
    """Evaluation scores as JSON (RMSE, MAE, Precision@K, Recall@K, F1)."""
    return jsonify(rec.evaluate(_k()))


@app.get('/metrics/view')
def metrics_view():
    """A simple developer dashboard rendering the evaluation scores."""
    return _render_metrics_html(rec.evaluate(_k()), rec.stats() if rec.trained else {})


_METRIC_CARDS = [
    ('RMSE',          'rmse',         'Root-mean-square error of predicted vs actual ratings. Lower is better.'),
    ('MAE',           'mae',          'Mean absolute error of predicted vs actual ratings. Lower is better.'),
    ('Precision@K',   'precisionAtK', 'Of the top-K recommended items, the fraction that are relevant. Higher is better.'),
    ('Recall@K',      'recallAtK',    'Of all relevant items, the fraction captured in the top-K. Higher is better.'),
    ('F1 Score',      'f1',           'Harmonic mean of precision and recall. Higher is better.'),
]


def _render_metrics_html(m, s):
    if not m.get('available'):
        body = (f'<div class="warn"><strong>Not enough data to evaluate yet.</strong>'
                f'<p>{m.get("reason", "unknown")}</p>'
                f'<p class="hint">Seed some reviews (≥2 customers, ≥10 ratings) and reload, then refresh this page.</p></div>')
    else:
        cards = ''.join(
            f'<div class="card"><div class="label">{name}</div>'
            f'<div class="value">{m.get(key, 0):.4f}</div><div class="desc">{desc}</div></div>'
            for name, key, desc in _METRIC_CARDS
        )
        meta = (f'Evaluated on <b>{m["nRatings"]}</b> ratings from <b>{m["nUsers"]}</b> customers over '
                f'<b>{m["nItems"]}</b> products &middot; K={m["k"]}, relevance threshold ≥{m["threshold"]}, '
                f'test split {int(m["testSize"] * 100)}%')
        body = f'<div class="grid">{cards}</div><p class="meta">{meta}</p>'

    cf = 'yes' if s.get('cfAvailable') else 'no (content-based only until more ratings)'
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShoeAR Recommender — Metrics</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f7f7fb; color: #1f2430; }}
  .wrap {{ max-width: 1100px; margin: 0 auto; padding: 32px 24px; }}
  h1 {{ font-size: 22px; margin: 0 0 4px; }}
  .sub {{ color: #6b7280; margin: 0 0 24px; font-size: 14px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }}
  .card {{ background: #fff; border: 1px solid #eceef3; border-radius: 12px; padding: 18px 20px; }}
  .label {{ font-size: 13px; color: #6b7280; margin-bottom: 6px; }}
  .value {{ font-size: 34px; font-weight: 700; letter-spacing: -0.5px; }}
  .desc {{ font-size: 12px; color: #9096a2; margin-top: 8px; line-height: 1.4; }}
  .meta {{ color: #6b7280; font-size: 13px; margin-top: 20px; }}
  .warn {{ background: #fff8e6; border: 1px solid #f5e2ad; border-radius: 12px; padding: 20px; }}
  .hint {{ color: #6b7280; font-size: 13px; }}
  .foot {{ color: #9096a2; font-size: 12px; margin-top: 28px; border-top: 1px solid #eceef3; padding-top: 14px; }}
  code {{ background: #eef0f5; padding: 1px 5px; border-radius: 4px; }}
</style></head><body><div class="wrap">
  <h1>👟 ShoeAR Recommender — Evaluation</h1>
  <p class="sub">Hold-out metrics computed live from the platform's own review data.</p>
  {body}
  <div class="foot">Collaborative filtering active: <b>{cf}</b> &middot;
    Raw JSON at <code>/metrics</code> &middot; change K via <code>/metrics/view?k=5</code></div>
</div></body></html>"""


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
