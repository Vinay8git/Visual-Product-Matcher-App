"""
Visual Product Matcher - CLIP Engine
- Parse args: --image, --top_k, --min_score, --rebuild, --classify
- Load CLIP model + preprocess
- Load product metadata from data/products.json
- If no embeddings.json or rebuild requested → build index
- Encode query image
- Compute cosine similarity with product embeddings
- Return top_k results above min_score as JSON
- If --classify → detect category of image
"""

import argparse
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

import clip  # type: ignore
import torch  # type: ignore
from PIL import Image

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / 'data'
CACHE_DIR = DATA_DIR / 'images_cache'
PRODUCTS_JSON = DATA_DIR / 'products.json'
EMBEDDINGS_JSON = DATA_DIR / 'embeddings.json'
MODEL_NAME = 'ViT-B/32'


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode('utf-8')).hexdigest()


def is_url(s: str) -> bool:
    return s.startswith('http://') or s.startswith('https://')


def url_to_cache_path(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{sha1(url)}.jpg"


def download_to_cache(url: str) -> Path:
    p = url_to_cache_path(url)
    if p.exists() and p.stat().st_size > 0:
        return p
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    with open(p, 'wb') as f:
        f.write(data)
    return p


def load_image(path_or_url: str) -> Image.Image:
    """Load an image from URL or local path"""
    path = download_to_cache(path_or_url) if is_url(path_or_url) else Path(path_or_url)
    return Image.open(path).convert("RGB")


def load_products() -> list:
    """Load product list from products.json"""
    with open(PRODUCTS_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_embeddings(items: list) -> None:
    payload = {
        'model': MODEL_NAME,
        'created_at': int(time.time()),
        'count': len(items),
        'items': items,
    }
    with open(EMBEDDINGS_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f)


def load_embeddings() -> dict:
    if not EMBEDDINGS_JSON.exists():
        return {}
    with open(EMBEDDINGS_JSON, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_index(model, preprocess, products: list) -> dict:
    eprint('Building Embeddings Index...')
    items = []
    device = next(model.parameters()).device

    batch_imgs, batch_ids = [], []
    B = 16

    def flush_batch():
        nonlocal items, batch_imgs, batch_ids
        if not batch_imgs:
            return
        with torch.no_grad():
            imgs = torch.stack(batch_imgs).to(device)
            feats = model.encode_image(imgs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            feats = feats.cpu().numpy()
        for pid, vec in zip(batch_ids, feats):
            items.append({'id': pid, 'embedding': vec.tolist()})
        batch_imgs, batch_ids = [], []

    for p in products:
        try:
            img = load_image(p['image_url'])
            t = preprocess(img)
            batch_imgs.append(t)
            batch_ids.append(p['id'])
            if len(batch_imgs) >= B:
                flush_batch()
        except Exception as ex:
            eprint('Failed product', p.get('id'), ex)
    flush_batch()

    save_embeddings(items)
    eprint('Index built with', len(items), 'items')
    return {'model': MODEL_NAME, 'items': items}


def ensure_index(model, preprocess, rebuild: bool) -> dict:
    products = load_products()
    idx = load_embeddings()
    if rebuild or not idx or idx.get('model') != MODEL_NAME or idx.get('count', 0) < len(products):
        idx = build_index(model, preprocess, products)
    return idx


def cosine_similarity(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    return a @ b.T


def search(model, preprocess, query_path: str, top_k: int, min_score: float) -> dict:
    products = load_products()
    index = ensure_index(model, preprocess, rebuild=False)
    pmap = {p['id']: p for p in products}

    import numpy as np
    emb_list = [it['embedding'] for it in index['items'] if it['id'] in pmap]
    ids = [it['id'] for it in index['items'] if it['id'] in pmap]
    if not emb_list:
        raise RuntimeError('Empty Embeddings Index')

    emb = torch.tensor(np.array(emb_list), dtype=torch.float32)

    img = load_image(query_path)
    with torch.no_grad():
        q = preprocess(img).unsqueeze(0).to(next(model.parameters()).device)
        qf = model.encode_image(q)
        qf = qf / qf.norm(dim=-1, keepdim=True)
        qf = qf.cpu()

    sims = cosine_similarity(qf, emb).squeeze(0)
    vals, idxs = torch.topk(sims, k=min(top_k, sims.shape[0]))

    results = []
    for score, i in zip(vals.tolist(), idxs.tolist()):
        if score < min_score:
            continue
        pid = ids[i]
        p = pmap[pid]
        results.append({
            'id': p['id'], 'name': p['name'], 'category': p['category'],
            'image_url': p['image_url'], 'score': float(score)
        })

    return {'count': len(results), 'results': results}


def classify(model, preprocess, image_path: str) -> dict:
    """Optional: classify an image into known categories"""
    categories = ["Shirts", "Shoes", "Laptops", "Smartphones", "Headphones", "Watches"]
    texts = [f"a photo of {c}" for c in categories]
    device = next(model.parameters()).device
    with torch.no_grad():
        text_tokens = clip.tokenize(texts).to(device)
        text_features = model.encode_text(text_tokens)
        text_features /= text_features.norm(dim=-1, keepdim=True)

        img = load_image(image_path)
        q = preprocess(img).unsqueeze(0).to(device)
        qf = model.encode_image(q)
        qf /= qf.norm(dim=-1, keepdim=True)

        sims = (qf @ text_features.T).squeeze(0)
        best_idx = int(sims.argmax())
        best_category = categories[best_idx]
    return {
        "category": best_category,
        "name": f"Uploaded {best_category}"
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--top_k', type=int, default=12)
    parser.add_argument('--min_score', type=float, default=0.0)
    parser.add_argument('--rebuild', action='store_true')
    parser.add_argument('--classify', action='store_true')  # optional
    args = parser.parse_args()

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model, preprocess = clip.load(MODEL_NAME, device=device)

    # Classification mode
    if args.classify:
        try:
            out = classify(model, preprocess, args.image)
            print(json.dumps(out))
            return
        except Exception as ex:
            eprint('Classification error:', ex)
            print(json.dumps({'error': str(ex)}))
            sys.exit(1)

    if args.rebuild:
        ensure_index(model, preprocess, rebuild=True)

    try:
        out = search(model, preprocess, args.image, args.top_k, args.min_score)
        print(json.dumps(out))
    except Exception as ex:
        eprint('Error:', ex)
        print(json.dumps({'error': str(ex)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
