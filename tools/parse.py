#!/usr/bin/env python3
"""Parse the Planet eBook plain-text extraction of Jane Eyre into structured JSON.
Usage: python3 -I parse.py <input.txt> <output.json>
Nothing is summarised or rewritten: page furniture is removed, wrapped lines are
rejoined, paragraph breaks are inferred from line geometry, and soft hyphens at
line ends are resolved (see report)."""
import re, sys, json, collections

src, out = sys.argv[1], sys.argv[2]
raw = open(src, encoding='utf-8').read().split('\n')
FURN = re.compile(r'^\s*(Free eBooks at Planet eBook\.com\s*\d*|\d*\s*Jane Eyre)\s*$')
HEAD = re.compile(r'^\s*(?:Chapter|CHAPTER)\s+([IVXL]+)\s*[—-]?\s*$')

# locate start of body: the "Preface" heading after the running head
lines = []
stats = collections.Counter()
for l in raw:
    # \x18 marks page breaks and \x02 soft hyphens in this extraction
    l = l.replace('\x18', ' ')
    l2 = re.sub(r'Free eBooks at Planet eBook\.com\s*\d*', '', l)
    if l2 != l:
        stats['furniture_inline'] += 1
        l = l2
    if not l.strip():
        continue
    if FURN.match(l):
        stats['furniture'] += 1
        continue
    l = l.strip()
    if l.endswith('\x02'):
        l = l[:-1] + '\x02'  # keep as end-of-line soft-hyphen marker
    mid = l[:-1].replace('\x02', '') + l[-1:] if l.endswith('\x02') else l.replace('\x02', '')
    lines.append(mid)
# drop cover matter before 'Preface'
start = lines.index('Preface')
lines = lines[start:]

# split into sections
sections = []  # (kind, label, lines)
cur = {'kind': 'front', 'id': 'preface', 'numeral': None, 'title': 'Preface', 'lines': []}
i = 1
sections.append(cur)
while i < len(lines):
    l = lines[i]
    m = HEAD.match(l)
    if l == 'NOTE TO THE THIRD EDITION':
        cur = {'kind': 'front', 'id': 'note', 'numeral': None, 'title': 'Note to the Third Edition', 'lines': []}
        sections.append(cur)
    elif m:
        num = m.group(1)
        cur = {'kind': 'chapter', 'id': 'ch-' + num.lower(), 'numeral': num, 'title': None, 'lines': []}
        sections.append(cur)
        if num == 'XXXVIII' and lines[i + 1].strip() == 'CONCLUSION':
            cur['title'] = 'Conclusion'
            i += 1
    else:
        cur['lines'].append(l)
    i += 1

# vocabulary of mid-line tokens, to resolve end-of-line hyphenation
vocab = collections.Counter()
for sec in sections:
    for l in sec['lines']:
        for w in re.findall(r"[A-Za-z’'-]+", l[:-1] if l else l):
            vocab[w.lower()] += 1

TERM = re.compile(r"[.!?]['’”\"]*$|[.!?]—$|—['’”]+$")

def firstword(s):
    w = s.split(' ', 1)[0]
    return w

def join_lines(ls):
    """Return list of paragraphs (strings)."""
    paras = []
    buf = ls[0]
    for nxt in ls[1:]:
        prev = buf.split('\n')[-1] if False else None
    # iterate with explicit previous *physical* line
    paras = []
    cur = [ls[0]]
    for a, b in zip(ls, ls[1:]):
        fill = len(a) + 1 + len(firstword(b))
        brk = False
        if TERM.search(a):
            if re.search(r"\b(Mrs|Mr|St|Dr|Messrs|Mme|Miss|Jun|Sen|vs|No)\.$", a):
                brk = False  # abbreviation, not a sentence end
            elif fill < 57:
                brk = True
            elif fill <= 60 and b[0].isupper():
                brk = True
            if not brk and b[0] in '‘“' and re.search(r"[.!?]['’”]$", a):
                brk = True  # quoted speech following a closed quotation: new speaker/paragraph
        if brk:
            paras.append(cur); cur = [b]
        else:
            cur.append(b)
    paras.append(cur)
    out = []
    for p in paras:
        s = p[0]
        for nxt in p[1:]:
            if s.endswith('\x02'):
                s = s[:-1] + nxt
                stats['softhyphen_joined'] += 1
            elif s.endswith('-') and not s.endswith('--') and nxt[:1].isalpha() and nxt[:1].islower():
                stem = re.search(r"([A-Za-z’']+)-$", s)
                head = stem.group(1) if stem else ''
                tail = re.match(r"[A-Za-z’']+", nxt).group(0)
                hy = (head + '-' + tail).lower()
                nh = (head + tail).lower()
                if vocab.get(hy, 0) > vocab.get(nh, 0):
                    s = s + nxt  # keep hyphen (genuine compound)
                    stats['hyphen_kept'] += 1
                else:
                    s = s[:-1] + nxt
                    stats['hyphen_removed'] += 1
            elif s.endswith('—'):
                s = s + nxt
            else:
                s = s + ' ' + nxt
        out.append(re.sub(r'\s+', ' ', s).strip())
    return out

VERSE = [  # (first line, last line) of the four verse passages in the novel
    ("‘Where the Northern Ocean, in vast whirls,", "Pours in among the stormy Hebrides.’"),
    ("‘My feet they are sore, and my limbs they are weary;", "God is a friend to the poor orphan child.’"),
    ("‘The truest love that ever heart", "As I love—loved am I!’"),
    ("‘Day set on Norham’s castled steep,", "In yellow lustre shone’—"),
]

def build(ls):
    items, verse_found = [], 0
    i, seg = 0, []
    def flush():
        nonlocal seg
        if seg:
            items.extend(join_lines(seg)); seg = []
    while i < len(ls):
        hit = next((v for v in VERSE if ls[i] == v[0]), None)
        if hit:
            j = i
            while ls[j] != hit[1]:
                j += 1
            flush()
            vl = ls[i:j + 1]
            st = 4 if len(vl) % 4 == 0 else len(vl)
            items.append({'verse': [vl[k:k + st] for k in range(0, len(vl), st)]})
            stats['verse_blocks'] += 1
            i = j + 1
        else:
            seg.append(ls[i]); i += 1
    flush()
    return items

SIGS = {'CURRER BELL.', 'December 21st, 1847.', 'April 13th, 1848.'}
book = {'title': 'Jane Eyre', 'author': 'Charlotte Brontë', 'sections': []}
for sec in sections:
    paras = build(sec['lines'])
    paras = [{'sig': q} if isinstance(q, str) and q in SIGS else q for q in paras]
    book['sections'].append({
        'id': sec['id'], 'kind': sec['kind'], 'numeral': sec['numeral'],
        'title': sec['title'], 'paragraphs': paras})
json.dump(book, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
if out.endswith('.json'):  # also emit the <script>-loadable twin so index.html works from file://
    open(out[:-5] + '.js', 'w', encoding='utf-8').write(
        '/* Generated by tools/parse.py from the Planet eBook text. */\nwindow.JANE_EYRE_BOOK=' + json.dumps(book, ensure_ascii=False) + ';\n')
def flat(p):
    if isinstance(p, str): return p
    if 'sig' in p: return p['sig']
    return ' '.join(l for st in p['verse'] for l in st)
tot_p = sum(len(s['paragraphs']) for s in book['sections'])
tot_w = sum(len(flat(p).split()) for s in book['sections'] for p in s['paragraphs'])
print('sections', len(book['sections']), 'paragraphs', tot_p, 'words', tot_w, dict(stats))
