# scripts/chunk_documents.py
#
# Civic Pulse Engine — Structure-aware paragraph-level chunker
#
# Pure Python, no external chunking library (deliberately avoids the
# langchain/text_splitter dependency weight for a 10-type prototype, per
# docs/RAG_CHUNKING_PLAN.md).
#
# Strategy (plan §1) — two pass:
#   Pass A (structure-aware): split on detected section boundaries first
#     (Section n., ARTICLE n, Chapter n, numbered/lettered clauses, standalone
#     header lines), then merge blank-line-delimited paragraphs up to the chunk
#     size limit.
#   Pass B (fixed window fallback): any section/paragraph still larger than the
#     max chunk size is split by a fixed token window with overlap, preferring
#     full-sentence boundaries and falling back to a hard token cut when a
#     single sentence exceeds the limit.
#
# The embedding model (meedan/paraphrase-filipino-mpnet-base-v2, XLMRoberta)
# has a hard max sequence length of 512 tokens. Chunk size = 384 tokens with 64
# tokens of overlap (≈17%), leaving margin under the 512 hard limit.
#
# Usage (library):
#   from chunk_documents import chunk_document
#   chunks = chunk_document(content, document_type, section_limit=384, overlap=64)
#   # -> list of dicts: {chunk_index, chunk_text, section_label, token_count}
#
# This module performs NO I/O — embedding + persistence live in backfill_chunks.py.

import re

# ── Tunables (plan §2) ─────────────────────────────────────────────────────
DEFAULT_CHUNK_SIZE = 384
DEFAULT_OVERLAP = 64
HARD_LIMIT = 512  # model max_position_embeddings = 512

# ── Structure-aware section heuristics (plan §1 Pass A) ────────────────────

# Heading / section markers commonly found in LGU documents.
SECTION_RE = re.compile(
    r'^\s*('
    r'Section\s+\d+[.:]?|'      # "Section 1." / "Section 2:"
    r'ARTICLE\s+\w+[.:]?|'      # "ARTICLE I" / "ARTICLE 1"
    r'Chapter\s+\w+[.:]?|'      # "Chapter 5" / "Chapter II"
    r'Sec\.\s*\d+[.:]?|'        # "Sec. 3."
    r'Rule\s+\d+[.:]?|'         # "Rule 3"
    r'Part\s+\w+[.:]?'          # "Part II" / "Part 2"
    r')\b',
    re.IGNORECASE,
)

# Numbered / lettered clause markers: "1.", "(a)", "A." at line start.
CLAUSE_RE = re.compile(r'^\s*(\(\w\)|\d{1,3}[.)]|[A-Z]\.)\s+')

# Standalone header line heuristic: short line, no terminal period, and either
# all-caps or title-cased. Used for Press Release / Advisory headings.
def _looks_like_header(line: str) -> bool:
    text = line.strip()
    if not text:
        return False
    if len(text) > 72:          # headers are short
        return False
    if text.endswith('.'):      # a real sentence, not a heading
        return False
    if text.isupper():
        return True
    # Title case: word count >= 2 and most words start with uppercase.
    words = text.split()
    if len(words) >= 2:
        upper = sum(1 for w in words if w and w[0].isupper())
        return upper >= 2
    return False


def _token_estimate(text: str) -> int:
    """Rough token estimate for splitting.

    XLMRoberta tokenizes near word-level for Latin scripts with some subword
    splitting. A whitespace-based estimate over-approximates slightly, which is
    safe given the hard 512 limit and 384 chunk budget. This is a prototype
    heuristic; the /embed endpoint truncates defensively at 512 regardless.
    """
    if not text:
        return 0
    return len(re.findall(r'\S+', text))


def _split_sentences(text: str) -> list:
    """Split on sentence boundaries, keeping the delimiter attached.

    Handles '.', '!', '?' followed by whitespace/end. Filipino/Taglish text
    uses the same sentence delimiters with spaces after them.
    """
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p for p in parts if p]


# ── Pass B: fixed token window with overlap, sentence-preferred ────────────
def _window_split(text: str, size: int, overlap: int) -> list:
    """Split text into fixed token windows of `size` with `overlap` tokens."""
    if _token_estimate(text) <= size:
        return [text]

    sentences = _split_sentences(text)
    # Build a running list of windows of whole sentences.
    windows = []
    current = ''
    for sentence in sentences:
        if _token_estimate(current) + _token_estimate(sentence) <= size:
            current = (current + ' ' + sentence).strip()
        else:
            if current:
                windows.append(current)
            # Sentence alone exceeds the size limit → hard token cut.
            if _token_estimate(sentence) > size:
                words = sentence.split()
                hard = []
                used = 0
                for word in words:
                    if used + 1 > size:
                        windows.append(' '.join(hard))
                        start = max(0, len(hard) - overlap)
                        hard = hard[start:]
                        used = len(hard)
                    hard.append(word)
                    used += 1
                if hard:
                    windows.append(' '.join(hard))
                current = ''
            else:
                current = sentence
    if current:
        windows.append(current)

    return windows


# ── Pass A: structure-aware section split ─────────────────────────────────
def _split_by_structure(content: str) -> list:
    """Return list of (section_label_or_None, body_text)."""
    raw_lines = content.splitlines()
    sections = []
    current_label = None
    current_lines = []

    def flush():
        nonlocal current_label, current_lines
        body = '\n'.join(current_lines).strip()
        if body:
            sections.append((current_label, body))
        current_label = None
        current_lines = []

    for line in raw_lines:
        if SECTION_RE.match(line):
            flush()
            current_label = line.strip()
            continue
        if CLAUSE_RE.match(line) and _token_estimate(line) <= 12:
            flush()
            current_label = line.strip()
            continue
        stripped = line.strip()
        if stripped and _looks_like_header(line):
            flush()
            current_label = stripped
            continue
        current_lines.append(line)

    flush()
    return sections or [(None, content)]


def chunk_document(content: str, document_type: str | None = None,
                   chunk_size: int = DEFAULT_CHUNK_SIZE,
                   overlap: int = DEFAULT_OVERLAP) -> list:
    """Chunk a single document's content into a list of chunk dicts.

    Args:
        content: the document text.
        document_type: optional document_type, used only to bias structure
            handling (kept for future per-type rules; currently structure
            heuristics apply uniformly, which is appropriate at prototype scale).
        chunk_size: target max tokens per chunk (default 384).
        overlap: token overlap between fixed-window fallback chunks (default 64).

    Returns:
        list of dicts: {chunk_index, chunk_text, section_label, token_count}
    """
    if chunk_size > HARD_LIMIT:
        chunk_size = HARD_LIMIT

    sections = _split_by_structure(content)

    chunks = []
    for label, body in sections:
        if _token_estimate(body) <= chunk_size:
            # Natural section chunk — do not pad (plan §2).
            chunks.append({
                'section_label': label,
                'chunk_text': body,
                'token_count': _token_estimate(body),
            })
            continue
        # Oversized section → Pass B fixed-window fallback.
        for piece in _window_split(body, chunk_size, overlap):
            chunks.append({
                'section_label': label,
                'chunk_text': piece,
                'token_count': _token_estimate(piece),
            })

    # Assign chunk_index (0-based) and drop any empty remnants.
    out = []
    for i, c in enumerate(chunks):
        if not c['chunk_text'].strip():
            continue
        out.append({
            'chunk_index': len(out),
            'chunk_text': c['chunk_text'],
            'section_label': c['section_label'],
            'token_count': c['token_count'],
        })
    return out


if __name__ == '__main__':
    # Basic self-test when run directly.
    sample = '''Section 1. Short title.
This is the first provision of the ordinance.

Section 2. Declaration of policy.
The municipality hereby declares its policy on waste management. This provision
contains a longer block of text that may exceed a small chunk size in a real
document, but here it is short enough to remain a single natural section.

Section 3. Implementing rules.
The implementing rules and regulations shall be issued within thirty days from
the effectivity of this ordinance.'''
    for c in chunk_document(sample, 'Ordinance'):
        print(c['chunk_index'], c['section_label'], c['token_count'], 'tokens ::', c['chunk_text'][:60])
