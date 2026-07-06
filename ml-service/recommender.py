"""Weighted-hybrid recommender for ShoeAR.

Ports the validated WeightedHybridv1 prototype to run on the platform's own
MySQL data:
  * Content-based (CBF): TF-IDF over product text (name + brand + category +
    description) plus a MinMax-scaled price feature, item-item cosine similarity.
  * Collaborative (CF): scikit-surprise SVD matrix factorization over the
    (customer, product, rating) matrix from the review table.
  * Weighted hybrid: final = ALPHA * CF + (1 - ALPHA) * CBF  (ALPHA = 0.5).

Everything degrades gracefully on sparse/empty data (a freshly-seeded DB): with
too few ratings the CF side is skipped and recommendations fall back to the
content-based / trending signals, exactly as the proposal describes for the
cold-start case.
"""
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
from sklearn.preprocessing import MinMaxScaler
from scipy.sparse import hstack, csr_matrix

import config
import db

# scikit-surprise is the CF engine; guard the import so the service still runs
# (content-based only) if it isn't installed yet.
try:
    from surprise import SVD, Reader, Dataset
    SURPRISE_AVAILABLE = True
except Exception:  # pragma: no cover - import-time environment guard
    SURPRISE_AVAILABLE = False


def _precision_recall_at_k(predictions, k, threshold):
    """Average Precision@K and Recall@K over users (standard Surprise recipe).
    An item is 'relevant' if its true rating ≥ threshold, and 'recommended' if
    its predicted rating ≥ threshold (looking only at each user's top-K)."""
    from collections import defaultdict
    by_user = defaultdict(list)
    for uid, _iid, true_r, est, _ in predictions:
        by_user[uid].append((est, true_r))
    precisions, recalls = [], []
    for uid, ratings in by_user.items():
        ratings.sort(key=lambda x: x[0], reverse=True)
        n_rel        = sum(true_r >= threshold for (_, true_r) in ratings)
        top_k        = ratings[:k]
        n_rec_k      = sum(est >= threshold for (est, _) in top_k)
        n_rel_rec_k  = sum((est >= threshold and true_r >= threshold) for (est, true_r) in top_k)
        precisions.append(n_rel_rec_k / n_rec_k if n_rec_k else 0.0)
        recalls.append(n_rel_rec_k / n_rel if n_rel else 0.0)
    prec = sum(precisions) / len(precisions) if precisions else 0.0
    rec  = sum(recalls) / len(recalls) if recalls else 0.0
    return prec, rec


class HybridRecommender:
    def __init__(self):
        self.trained = False
        self.products = []          # list of product dicts, index-aligned
        self.pid_to_idx = {}        # productId -> row index in cosine_sim
        self.cosine_sim = None      # item-item similarity matrix (CBF)
        self.reviews_df = pd.DataFrame(columns=['customerId', 'productId', 'rating'])
        self.svd = None
        self.cf_available = False
        self.global_mean = 3.0
        self.popularity = {}        # productId -> units sold

    # ── training ────────────────────────────────────────────────────────────
    def train(self):
        self.products = list(db.load_products())
        self.pid_to_idx = {p['productId']: i for i, p in enumerate(self.products)}

        self._build_content_model()
        self._build_cf_model()

        pop = db.load_popularity()
        self.popularity = {r['productId']: float(r['sold'] or 0) for r in pop}

        self.trained = True
        return self.stats()

    def stats(self):
        return {
            'products': len(self.products),
            'reviews': int(len(self.reviews_df)),
            'cfAvailable': self.cf_available,
            'surpriseInstalled': SURPRISE_AVAILABLE,
            'alpha': config.ALPHA,
            'globalMean': round(float(self.global_mean), 3),
        }

    # ── evaluation (accuracy + ranking quality) ──────────────────────────────
    def evaluate(self, k=10, threshold=3.5, test_size=0.25):
        """Hold-out evaluation of the CF model on the live review data:
          * RMSE / MAE  — rating-prediction error (lower is better)
          * Precision@K / Recall@K / F1  — top-N ranking quality (higher is better)
        Trains SVD on a train split and scores the held-out test split. Degrades
        gracefully (returns available=False + a reason) on too-little data."""
        if not SURPRISE_AVAILABLE:
            return {'available': False, 'reason': 'scikit-surprise is not installed'}
        df = self.reviews_df
        if df is None or df.empty:
            return {'available': False, 'reason': 'no reviews to evaluate yet'}
        n = len(df)
        n_users = int(df['customerId'].nunique())
        if n < 10 or n_users < 2:
            return {'available': False,
                    'reason': f'not enough data (need ≥10 ratings & ≥2 users; have {n} ratings, {n_users} users)',
                    'nRatings': n, 'nUsers': n_users}
        try:
            from surprise import SVD, Reader, Dataset, accuracy
            from surprise.model_selection import train_test_split as surprise_split
            reader   = Reader(rating_scale=(1, 5))
            data     = Dataset.load_from_df(df[['customerId', 'productId', 'rating']], reader)
            trainset, testset = surprise_split(data, test_size=test_size, random_state=config.RANDOM_SEED)
            algo = SVD(n_factors=config.SVD_FACTORS, n_epochs=config.SVD_EPOCHS,
                       lr_all=config.SVD_LR, reg_all=config.SVD_REG, random_state=config.RANDOM_SEED)
            algo.fit(trainset)
            preds = algo.test(testset)
            if not preds:
                return {'available': False, 'reason': 'test split was empty — add more reviews'}
            rmse = accuracy.rmse(preds, verbose=False)
            mae  = accuracy.mae(preds, verbose=False)
            prec, rec = _precision_recall_at_k(preds, k, threshold)
            f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
            return {
                'available': True,
                'rmse': round(float(rmse), 4), 'mae': round(float(mae), 4),
                'precisionAtK': round(float(prec), 4), 'recallAtK': round(float(rec), 4),
                'f1': round(float(f1), 4),
                'k': k, 'threshold': threshold, 'testSize': test_size,
                'nRatings': n, 'nUsers': n_users, 'nItems': int(df['productId'].nunique()),
            }
        except Exception as e:  # pragma: no cover
            return {'available': False, 'reason': str(e)}

    def _blob(self, p):
        parts = [p.get('name'), p.get('brand'), p.get('category'), p.get('description')]
        text = ' '.join(str(x) for x in parts if x and str(x).lower() != 'none')
        return text.lower()

    def _build_content_model(self):
        n = len(self.products)
        if n == 0:
            self.cosine_sim = None
            return
        blobs = [self._blob(p) for p in self.products]
        tfidf = TfidfVectorizer(stop_words='english', max_features=config.TFIDF_MAX_FEATURES)
        matrix = tfidf.fit_transform(blobs)
        # price as an extra normalized feature (mirrors the prototype)
        prices = np.array([[float(p.get('price') or 0)] for p in self.products])
        price_feat = MinMaxScaler().fit_transform(prices) if n > 1 else np.zeros((n, 1))
        combined = hstack([matrix, csr_matrix(price_feat)])
        self.cosine_sim = linear_kernel(combined)

    def _build_cf_model(self):
        rows = db.load_reviews()
        self.reviews_df = (pd.DataFrame(rows) if rows
                           else pd.DataFrame(columns=['customerId', 'productId', 'rating']))
        if not self.reviews_df.empty:
            self.reviews_df['rating'] = self.reviews_df['rating'].astype(float)
            self.global_mean = float(self.reviews_df['rating'].mean())

        enough = (SURPRISE_AVAILABLE
                  and len(self.reviews_df) >= config.MIN_RATINGS_FOR_CF
                  and self.reviews_df['customerId'].nunique() >= 2
                  and self.reviews_df['productId'].nunique() >= 2)
        if not enough:
            self.svd = None
            self.cf_available = False
            return

        reader = Reader(rating_scale=(1, 5))
        data = Dataset.load_from_df(self.reviews_df[['customerId', 'productId', 'rating']], reader)
        trainset = data.build_full_trainset()
        self.svd = SVD(n_factors=config.SVD_FACTORS, n_epochs=config.SVD_EPOCHS,
                       lr_all=config.SVD_LR, reg_all=config.SVD_REG,
                       random_state=config.RANDOM_SEED)
        self.svd.fit(trainset)
        self.global_mean = float(trainset.global_mean)
        self.cf_available = True

    # ── recommendation queries ───────────────────────────────────────────────
    def similar(self, product_id, k=10):
        """Content-based item-item: products most similar to `product_id`."""
        if self.cosine_sim is None or product_id not in self.pid_to_idx:
            return []
        idx = self.pid_to_idx[product_id]
        sims = [(i, s) for i, s in enumerate(self.cosine_sim[idx]) if i != idx]
        sims.sort(key=lambda x: x[1], reverse=True)
        return [{'productId': self.products[i]['productId'], 'score': round(float(s), 4)}
                for i, s in sims[:k] if s > 0]

    def _cbf_user_score(self, customer_id, product_id):
        """Similarity-weighted average of the user's own ratings (from the prototype)."""
        if self.cosine_sim is None or product_id not in self.pid_to_idx:
            return self.global_mean
        sims = self.cosine_sim[self.pid_to_idx[product_id]]
        user = self.reviews_df[self.reviews_df['customerId'] == customer_id]
        num = den = 0.0
        for _, r in user.iterrows():
            if r['productId'] in self.pid_to_idx:
                sim = sims[self.pid_to_idx[r['productId']]] ** 2  # square → focus on close matches
                num += sim * r['rating']
                den += sim
        if den > 0:
            return num / den
        return float(user['rating'].mean()) if not user.empty else self.global_mean

    def for_you(self, customer_id, k=10):
        """Personalized weighted hybrid. Falls back to trending for new users."""
        if not self.trained:
            return []
        user = self.reviews_df[self.reviews_df['customerId'] == customer_id]
        if user.empty:
            return self.trending(k)  # cold-start: no history yet

        rated = set(user['productId'])
        all_pids = [p['productId'] for p in self.products]
        # Prefer to surface products the user hasn't rated yet (a real store
        # wouldn't re-recommend what you've already reviewed/bought). But in a
        # small catalogue where the user has rated everything, fall back to
        # ranking the WHOLE catalogue by the hybrid score, so "Recommended for
        # you" is still personalised rather than degrading to generic trending.
        candidates = [pid for pid in all_pids if pid not in rated] or all_pids

        scored = []
        for pid in candidates:
            cf = self.svd.predict(customer_id, pid).est if self.cf_available else self.global_mean
            cbf = self._cbf_user_score(customer_id, pid)
            score = config.ALPHA * cf + (1 - config.ALPHA) * cbf
            scored.append({'productId': pid, 'score': round(float(score), 4)})
        scored.sort(key=lambda x: x['score'], reverse=True)
        if not scored:
            return self.trending(k)
        return scored[:k]

    def trending(self, k=10):
        """Best-sellers by units sold; falls back to catalogue order if no sales."""
        if self.popularity:
            items = sorted(self.popularity.items(), key=lambda x: x[1], reverse=True)
            return [{'productId': pid, 'score': float(c)} for pid, c in items[:k]]
        return [{'productId': p['productId'], 'score': 0.0} for p in self.products[:k]]
