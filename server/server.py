"""
ClawCore Model Server
Serves embedding, reranking, and document parsing via sentence-transformers + Docling.
Reads model config from config.json (written by installer).

Endpoints:
  POST /v1/embeddings  — OpenAI-compatible embedding endpoint
  POST /rerank         — Cross-encoder reranking
  POST /parse          — Document parsing via Docling (PDF, DOCX, PPTX, XLSX, HTML)
  GET  /health         — Health check
"""

import os
import json
import logging
import traceback
from pathlib import Path
from flask import Flask, request, jsonify
from sentence_transformers import CrossEncoder, SentenceTransformer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Load config from config.json or environment variables
config_path = Path(__file__).parent / "config.json"
if config_path.exists():
    with open(config_path) as f:
        config = json.load(f)
    EMBED_MODEL_ID = config.get("embed_model", "BAAI/bge-large-en-v1.5")
    RERANK_MODEL_ID = config.get("rerank_model", "BAAI/bge-reranker-large")
    TRUST_REMOTE = bool(config.get("trust_remote_code", False))
    DOCLING_DEVICE = config.get("docling_device", "cpu")  # "cpu", "gpu", or "off"
else:
    EMBED_MODEL_ID = os.environ.get("EMBED_MODEL", "BAAI/bge-large-en-v1.5")
    RERANK_MODEL_ID = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-large")
    TRUST_REMOTE = os.environ.get("TRUST_REMOTE_CODE", "0") == "1"
    DOCLING_DEVICE = os.environ.get("DOCLING_DEVICE", "cpu")

PORT = int(os.environ.get("MODEL_SERVER_PORT", "8012"))

app = Flask(__name__)
embed_model = None
rerank_model = None


def load_models():
    global embed_model, rerank_model

    kwargs = {"trust_remote_code": True} if TRUST_REMOTE else {}

    logger.info(f"Loading embedding model: {EMBED_MODEL_ID} ...")
    embed_model = SentenceTransformer(EMBED_MODEL_ID, **kwargs)
    logger.info(f"Embedding model loaded. Dimension: {embed_model.get_sentence_embedding_dimension()}")

    logger.info(f"Loading rerank model: {RERANK_MODEL_ID} ...")
    rerank_model = CrossEncoder(RERANK_MODEL_ID, **kwargs)
    logger.info("Rerank model loaded and ready.")

    # Enable float16 inference on CUDA for ~30% speedup, 50% less VRAM
    try:
        import torch
        if torch.cuda.is_available():
            rerank_model.model.half()
            logger.info("Rerank model using float16 (CUDA)")
    except Exception as e:
        logger.warning(f"Could not enable float16 for reranker: {e}")

    # Warmup: run a dummy inference to trigger CUDA kernel compilation / JIT.
    # First real request would otherwise be 2-5x slower.
    logger.info("Warming up models...")
    try:
        embed_model.encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)
        rerank_model.predict([("warmup query", "warmup document")])
        logger.info("Model warmup complete.")
    except Exception as e:
        logger.warning(f"Warmup failed (non-fatal): {e}")

    # Docling is loaded on-demand per parse request to save VRAM
    # It loads its models when needed and we release them after
    try:
        import docling
        logger.info("Docling available (will load on-demand per parse request).")
    except ImportError:
        logger.warning("Docling not installed. /parse endpoint will be unavailable.")


@app.route("/v1/embeddings", methods=["POST"])
def embeddings():
    data = request.json
    input_text = data.get("input", [])
    if isinstance(input_text, str):
        input_text = [input_text]

    if not input_text:
        return jsonify({"error": "input required"}), 400

    # batch_size=64 for optimal GPU throughput; show_progress_bar=False to avoid stdout noise
    vectors = embed_model.encode(
        input_text,
        normalize_embeddings=True,
        batch_size=64,
        show_progress_bar=False,
    )

    response_data = []
    for i, vec in enumerate(vectors):
        response_data.append({
            "object": "embedding",
            "embedding": vec.tolist(),
            "index": i,
        })

    return jsonify({
        "object": "list",
        "data": response_data,
        "model": EMBED_MODEL_ID,
        "usage": {
            "prompt_tokens": sum(len(t.split()) for t in input_text),
            "total_tokens": sum(len(t.split()) for t in input_text),
        },
    })


@app.route("/rerank", methods=["POST"])
def rerank():
    data = request.json
    query = data.get("query", "")
    documents = data.get("documents", [])
    top_k = data.get("top_k", len(documents))

    if not query or not documents:
        return jsonify({"error": "query and documents required"}), 400

    # Truncate inputs for efficiency — cross-encoders plateau after ~512 tokens
    q_truncated = ' '.join(query.split()[:200])
    pairs = [(q_truncated, ' '.join(doc.split()[:512])) for doc in documents]
    scores = rerank_model.predict(pairs, batch_size=64, show_progress_bar=False).tolist()

    results = sorted(
        [{"index": i, "score": s, "text": documents[i]} for i, s in enumerate(scores)],
        key=lambda x: x["score"],
        reverse=True,
    )[:top_k]

    return jsonify({"results": results})


@app.route("/parse", methods=["POST"])
def parse_document():
    """
    Parse a document using Docling.
    Layout-aware parsing for PDF, DOCX, PPTX, XLSX, HTML, images.
    Loads Docling on-demand and releases GPU memory after parsing.

    Body: { "path": "/path/to/document.pdf" }
    Response: { "markdown": "...", "metadata": { "title": "...", ... } }
    """
    if DOCLING_DEVICE == "off":
        return jsonify({"error": "Docling is disabled (set docling_device to 'cpu' or 'gpu' in config)"}), 503

    try:
        from docling.document_converter import DocumentConverter
    except ImportError:
        return jsonify({"error": "Docling not installed. Run: pip install docling"}), 503

    data = request.json
    file_path = data.get("path", "")

    if not file_path:
        return jsonify({"error": "path required"}), 400

    if not os.path.isfile(file_path):
        return jsonify({"error": f"File not found: {file_path}"}), 404

    try:
        device = DOCLING_DEVICE if DOCLING_DEVICE in ("cpu", "gpu") else "cpu"
        logger.info(f"Parsing document ({device}): {file_path}")

        from docling.datamodel.pipeline_options import PipelineOptions
        pipeline_opts = PipelineOptions()

        if device == "cpu":
            pipeline_opts.accelerator_options.device = "cpu"
        # GPU mode: let Docling use CUDA (requires extra ~8GB VRAM during parse)

        converter = DocumentConverter(pipeline_options=pipeline_opts)
        result = converter.convert(file_path)
        doc = result.document

        # Export to markdown
        markdown = doc.export_to_markdown()

        # Extract metadata
        metadata = {
            "title": None,
            "author": None,
            "date": None,
            "language": None,
            "page_count": None,
        }

        # Try to get title from document
        if hasattr(doc, 'name') and doc.name:
            metadata["title"] = doc.name

        # Try to get metadata from origin if available
        if hasattr(doc, 'origin') and doc.origin:
            origin = doc.origin
            if hasattr(origin, 'filename'):
                if not metadata["title"]:
                    metadata["title"] = origin.filename

        # Page count for PDFs
        if hasattr(result, 'pages') and result.pages:
            metadata["page_count"] = len(result.pages)

        # Detect language from content (simple heuristic)
        if markdown:
            metadata["language"] = detect_language(markdown[:2000])

        logger.info(f"Parsed: {file_path} -> {len(markdown)} chars")

        # Release Docling's GPU memory after parsing
        del converter, result, doc
        _cleanup_gpu()

        return jsonify({
            "markdown": markdown,
            "metadata": metadata,
        })

    except Exception as e:
        logger.error(f"Parse failed: {file_path}: {e}")
        logger.error(traceback.format_exc())
        _cleanup_gpu()
        return jsonify({"error": f"Parse failed: {str(e)}"}), 500


def _cleanup_gpu():
    """Release cached GPU memory after Docling parsing."""
    try:
        import torch
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def detect_language(text):
    """Simple language detection based on character ranges."""
    if not text:
        return "unknown"

    # Single pass — count characters in different unicode ranges
    latin = cjk = arabic = cyrillic = hangul = devanagari = 0
    for c in text:
        o = ord(c)
        if o <= 0x007F:
            latin += 1
        elif 0x4E00 <= o <= 0x9FFF:
            cjk += 1
        elif 0x0600 <= o <= 0x06FF:
            arabic += 1
        elif 0x0400 <= o <= 0x04FF:
            cyrillic += 1
        elif 0xAC00 <= o <= 0xD7AF:
            hangul += 1
        elif 0x0900 <= o <= 0x097F:
            devanagari += 1

    total = max(len(text), 1)
    scores = {
        "en": latin / total,
        "zh": cjk / total,
        "ar": arabic / total,
        "ru": cyrillic / total,
        "ko": hangul / total,
        "hi": devanagari / total,
    }

    best = max(scores, key=scores.get)
    if scores[best] < 0.1:
        return "unknown"
    return best


def _is_docling_available():
    try:
        import docling
        return True
    except ImportError:
        return False


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "models": {
            "embed": {"id": EMBED_MODEL_ID, "ready": embed_model is not None},
            "rerank": {"id": RERANK_MODEL_ID, "ready": rerank_model is not None},
            "docling": {"ready": _is_docling_available() and DOCLING_DEVICE != "off", "device": DOCLING_DEVICE},
        },
    })


if __name__ == "__main__":
    load_models()
    logger.info(f"ClawCore Model Server starting on port {PORT}")
    # threaded=True allows concurrent requests (embed + rerank in parallel)
    # Flask's built-in threaded mode uses Python threading — safe for model.encode()
    # since sentence-transformers releases the GIL during CUDA/torch operations.
    host = os.environ.get("MODEL_SERVER_HOST", "127.0.0.1")
    app.run(host=host, port=PORT, threaded=True)
