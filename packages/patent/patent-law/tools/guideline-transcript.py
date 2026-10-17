#!/usr/bin/env python3
"""Transcribe 《专利审查指南》 sections into the shipped index from the official PDF.

Each indexed section records its own text and where that text came from, so a
citation can be decided against the wording it points at instead of being reported
as unverified. The source PDF cannot be copied out directly: it carries a margin
column of statute numbers (法 26.3、细则 70.2), a running header, a page number and
a 《部分》page code, and it hard-wraps every paragraph at a fixed column, so a copy
out of a reader loses the boundaries and mixes the margin column into the body.
This script derives the text mechanically:

- Spans starting left of x=145 lie in the margin column and are dropped; body text
  starts at x≈148.7 and headings at x≈154.6.
- Lines above y=60 and below y=660 are the running header and the page footer.
- A heading is a line carrying a 黑体 span whose text is `<number> <title>`; the
  margin column of the heading's own line is dropped first.
- A section's text runs from its heading to the next heading in the same part and
  chapter, so subsections are transcribed under their own path and no text is
  recorded twice.
- A body line indented to x>=170 starts a paragraph, because the PDF indents the
  first line of every paragraph by two characters; other lines continue it.
- A line whose text repeats the tail of the previous line on the same baseline is a
  duplicated run of the source PDF, not content, and is dropped.

The body-column threshold is measured on Parts I, II, IV and V; the PDF sets Part III
at a different left edge, and no Part III path is indexed. The source PDF is not
shipped with this repository, so `--check` reports the absent source instead of
passing silently, and the shipped index stays the only record of the transcription. Run `--write` after changing any rule above; it rewrites the
`text`, `sourceDoc` and `verifiedOn` fields only, leaving the hand-verified `topics`
and the file header untouched. `--check` compares the derived `text` and `sourceDoc`
and keeps whichever `verifiedOn` dates the file carries, because a date is not
something the extraction can derive.

Usage:
  python3 tools/guideline-transcript.py --check [--pdf PATH] [--yaml PATH]
  python3 tools/guideline-transcript.py --write [--verified-on DATE] [--pdf PATH]

The source path defaults to `$DSH_GUIDELINE_PDF`, then to the copy this repository's
owner keeps under `~/projects/宝宸知识库_Raw/`; `--pdf` overrides both. PyMuPDF is
required when the source is present: `python3 -m pip install pymupdf`.
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, NoReturn

# Bounding boxes of the body column and of the text zone, in PDF points.
BODY_LEFT = 145.0
INDENT_LEFT = 170.0
TOP_ZONE = 60.0
BOTTOM_ZONE = 660.0
HEAD_FONTS = ('ºÚÌå', '·½Õý´óºÚ¼òÌå')

# A character narrower than ZERO_WIDTH this close to a visible one with the same
# value is the text layer's duplicate of that glyph, not a second character.
ZERO_WIDTH = 0.5
DUPLICATE_ORIGIN = 2.0

DEFAULT_PDF = Path(
    os.environ.get('DSH_GUIDELINE_PDF')
    or Path.home() / 'projects/宝宸知识库_Raw/专利审查指南/专利审查指南（2023版-未修改）.pdf'
)
DEFAULT_YAML = Path(__file__).resolve().parent.parent / 'assets/law/cn-examination-guidelines.yaml'

SOURCE_DOC = (
    '《专利审查指南》2023 年修订版（2024-01-20 施行）——本机 PDF 全文抽取的节正文'
    '（去页眉页脚与左边栏法规号、去固定列折行）'
)
SUPERSEDED_DOC = (
    '；该节已被 2026 年版《专利审查指南》（2026-01-01 施行）修改，本节文本是修改前文本'
)

# Sections the 2026 revision is known to have changed, from the local change table.
# Each entry's sourceDoc states that its text predates that revision.
SUPERSEDED_PATHS = frozenset({
    '第二部分第一章4.4',
    '第四部分第三章2.1',
    '第四部分第三章3.3',
})

PATH_PATTERN = re.compile(r'^  - path: (\S+)$')
FIELD_PATTERN = re.compile(r'^    (path|topics|text|sourceDoc|verifiedOn):')
CHAPTER_PATTERN = re.compile(r'专利审查指南(第[一二三四五六]部分第?[一二三四五六七八九十]*章?)')
NUMBER_PATTERN = re.compile(r'^(\d+(?:\.\d+)*)\.?(?:\s+(.*))?$')
PATH_PATTERN_PARTS = re.compile(r'^第([一二三四五六])部分(?:第([一二三四五六七八九十]+)章)?(.*)$')


def fail(message: str) -> NoReturn:
    """Exit with a concise, user-correctable error."""
    print(f'guideline-transcript: {message}', file=sys.stderr)
    raise SystemExit(1)


def line_text(spans: list[dict]) -> str:
    """Join one line's spans, dropping zero-width duplicates of visible glyphs.

    The PDF text layer carries some quotes twice: a zero-width copy at almost the
    same origin as the visible glyph. A zero-width run that has no visible twin is
    not a duplicate — it is the only text-layer copy of that part of the line.
    """
    visible = [
        (char['c'], char['origin'][0])
        for span in spans
        for char in span.get('chars', [])
        if char['bbox'][2] - char['bbox'][0] >= ZERO_WIDTH
    ]
    parts: list[str] = []
    for span in spans:
        chars = span.get('chars')
        if chars is None:
            parts.append(span.get('text', ''))
            continue
        kept: list[str] = []
        for char in chars:
            if char['bbox'][2] - char['bbox'][0] < ZERO_WIDTH and char['c'].strip():
                if any(value == char['c'] and abs(origin - char['origin'][0]) < DUPLICATE_ORIGIN
                       for value, origin in visible):
                    continue
            kept.append(char['c'])
        parts.append(''.join(kept))
    return ''.join(parts)


class Source:
    """The official guideline PDF, addressed by page, chapter and section number."""

    def __init__(self, pdf: Path) -> None:
        try:
            import fitz
        except ImportError:
            fail('缺少 PyMuPDF：请运行 python3 -m pip install pymupdf')
        self.doc = fitz.open(str(pdf))
        self._lines: dict[int, list[dict]] = {}
        self.chapters: dict[str, list[int]] = {}
        for page in range(self.doc.page_count):
            chapter = self._chapter(page)
            if chapter:
                self.chapters.setdefault(chapter, []).append(page)

    def _chapter(self, page: int) -> str | None:
        """Part and chapter the running header names on one page."""
        for block in self.doc[page].get_text('dict')['blocks']:
            if block['type'] != 0 or block['bbox'][1] >= TOP_ZONE:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    match = CHAPTER_PATTERN.search(span['text'])
                    if match:
                        return match.group(1)
        return None

    def lines(self, page: int) -> list[dict]:
        """Body column lines of one page: the margin annotation column is dropped.

        A line whose text repeats the tail of the preceding line on the same
        baseline is a duplicated run of the source PDF and is dropped as well.
        """
        if page not in self._lines:
            kept: list[dict] = []
            for block in self.doc[page].get_text('rawdict')['blocks']:
                if block['type'] != 0:
                    continue
                for line in block['lines']:
                    spans = [span for span in line['spans'] if span['bbox'][0] >= BODY_LEFT]
                    if not spans:
                        continue
                    text = line_text(spans)
                    entry = {
                        'spans': spans,
                        'text': text,
                        'x0': spans[0]['bbox'][0],
                        'y0': min(span['bbox'][1] for span in spans),
                        'y1': max(span['bbox'][3] for span in spans),
                    }
                    if kept and text.strip() and text.strip() in kept[-1]['text'] \
                            and abs(entry['y0'] - kept[-1]['y0']) < 4 \
                            and entry['x0'] > kept[-1]['x0']:
                        continue
                    kept.append(entry)
            self._lines[page] = kept
        return self._lines[page]

    def body_lines(self, page: int) -> Iterator[dict]:
        """Lines inside the text zone of one page."""
        for line in self.lines(page):
            if line['y0'] < TOP_ZONE or line['y1'] > BOTTOM_ZONE:
                continue
            yield line

    @staticmethod
    def heading(line: dict) -> tuple[str, str] | None:
        """Number and title when the line is a section heading, else None."""
        if not any(span['font'] in HEAD_FONTS for span in line['spans']):
            return None
        match = NUMBER_PATTERN.match(line['text'].strip())
        if not match:
            return None
        return match.group(1), (match.group(2) or '').strip()

    @staticmethod
    def heading_material(line: dict) -> bool:
        """True when every span is in the heading font.

        A heading that outruns one line continues in the same font, so this is how
        the rest of a wrapped heading is recognised; the PDF sets no body text in
        the heading font.
        """
        return bool(line['spans']) and all(span['font'] in HEAD_FONTS for span in line['spans'])


def split_path(path: str) -> tuple[str, str]:
    """Part and chapter, and the section number after it, of one normalized index path."""
    match = PATH_PATTERN_PARTS.match(path)
    if not match:
        fail(f'索引路径无法解析：{path}')
    part, chapter, tail = match.group(1), match.group(2), match.group(3)
    return f'第{part}部分' + (f'第{chapter}章' if chapter else ''), tail


def headings(source: Source, chapter: str) -> list[tuple[int, float, str]]:
    """Every heading of one part and chapter, in page order."""
    out: list[tuple[int, float, str]] = []
    for page in source.chapters.get(chapter, []):
        for line in source.lines(page):
            heading = Source.heading(line)
            if heading:
                out.append((page, round(line['y0'], 2), heading[0]))
    return out


def section(source: Source, path: str) -> list[str] | None:
    """Paragraphs of one section, or None when the index names no such heading.

    A part or chapter path yields the text that precedes its first section, which
    is empty for every indexed part and chapter.
    """
    chapter, tail = split_path(path)
    pages = source.chapters.get(chapter, [])
    if not pages:
        return None
    marks = headings(source, chapter)
    if not tail:
        start = (pages[0], -1.0)
        index = None
    else:
        index = next((position for position, mark in enumerate(marks) if mark[2] == tail), None)
        if index is None:
            return None
        start = marks[index][:2]
    end = marks[index + 1][:2] if index is not None and index + 1 < len(marks) else None
    paragraphs: list[str] = []
    current: list[str] = []
    for page in pages:
        if page < start[0]:
            continue
        if end and page > end[0]:
            break
        for line in source.body_lines(page):
            if page == start[0] and line['y0'] <= start[1]:
                continue
            if end and page == end[0] and line['y0'] >= end[1]:
                break
            if Source.heading(line) or Source.heading_material(line):
                continue
            if current and line['x0'] >= INDENT_LEFT:
                paragraphs.append(''.join(current))
                current = []
            current.append(line['text'].rstrip())
    if current:
        paragraphs.append(''.join(current))
    return [paragraph for paragraph in paragraphs if paragraph.strip()]


def entry_lines(path: str, paragraphs: list[str], verified_on: str | None) -> list[str]:
    """The transcription lines of one index entry.

    `verified_on` is None while checking, where the file's own date is kept: a
    transcription date is not something the extraction can derive.
    """
    if not paragraphs or verified_on is None:
        return []
    source_doc = SOURCE_DOC + (SUPERSEDED_DOC if path in SUPERSEDED_PATHS else '')
    return [
        '    text: |-',
        *[f'      {paragraph}' for paragraph in paragraphs],
        f"    sourceDoc: '{source_doc}'",
        f'    verifiedOn: {verified_on}',
    ]


@dataclass
class Entry:
    """One section entry as read from the shipped index."""

    path: str
    lines: list[str]
    recorded: str | None = None


def read_entries(text: str) -> list[Entry]:
    """Index entries as their path, the lines kept verbatim, and the date the file records."""
    entries: list[Entry] = []
    current: Entry | None = None
    skipping = False
    for line in text.split('\n'):
        if skipping:
            if line.startswith('      '):
                continue
            skipping = False
        match = PATH_PATTERN.match(line)
        if match:
            current = Entry(match.group(1), [line])
            entries.append(current)
            continue
        if current is None:
            continue
        field = FIELD_PATTERN.match(line)
        if field:
            if field.group(1) == 'topics':
                current.lines.append(line)
            if field.group(1) == 'verifiedOn':
                current.recorded = line.split(':', 1)[1].strip()
            skipping = field.group(1) == 'text'
            continue
        current.lines.append(line)
    return [
        Entry(entry.path, [line for line in entry.lines if line.strip()], entry.recorded)
        for entry in entries
    ]


def rebuild(text: str, entries: list[Entry], sections: dict[str, list[str]], stamp: str | None) -> str:
    """Rewrite the sections block with the derived transcription fields."""
    head = text.split('sections:')[0]
    out = [*head.rstrip('\n').split('\n'), 'sections:']
    for entry in entries:
        out.extend(entry.lines)
        out.extend(entry_lines(entry.path, sections[entry.path], stamp if stamp is not None else entry.recorded))
        out.append('')
    return '\n'.join(out).rstrip('\n') + '\n'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--check', action='store_true', help='verify the index against the source (default)')
    parser.add_argument('--write', action='store_true', help='rewrite the index instead of checking it')
    parser.add_argument('--verified-on', help='date --write records, default today')
    parser.add_argument('--pdf', type=Path, default=DEFAULT_PDF, help='official guideline PDF')
    parser.add_argument('--yaml', type=Path, default=DEFAULT_YAML, help='shipped section index')
    args = parser.parse_args()

    if not args.pdf.exists():
        print(f'guideline-transcript: 未核验——源 PDF 不在 {args.pdf}；索引中的转录未与本机源比对', file=sys.stderr)
        return
    if not args.yaml.exists():
        fail(f'索引不在 {args.yaml}')

    source = Source(args.pdf)
    text = args.yaml.read_text(encoding='utf-8')
    entries = read_entries(text)
    if not entries:
        fail(f'{args.yaml} 没有可解析的 section 条目')
    untopiced = [entry.path for entry in entries
                 if not any(line.startswith('    topics:') for line in entry.lines)]
    if untopiced:
        fail('以下条目缺少手工核定的 topics，重写会丢失它们：' + '、'.join(untopiced))

    sections: dict[str, list[str]] = {}
    unresolved: list[str] = []
    for entry in entries:
        chapter, tail = split_path(entry.path)
        if not tail:
            if not any(key.startswith(chapter) for key in source.chapters):
                unresolved.append(entry.path)
            sections[entry.path] = []
            continue
        paragraphs = section(source, entry.path)
        if paragraphs is None:
            unresolved.append(entry.path)
            sections[entry.path] = []
            continue
        sections[entry.path] = paragraphs

    if unresolved:
        fail('索引中的路径在源 PDF 中找不到对应标题：' + '、'.join(unresolved))

    if not args.write:
        # Without a recorded date the derived output omits the section text, so a
        # file that also omits it would compare equal: the check must refuse that
        # comparison instead of reporting a section as transcribed.
        unrecorded = [entry.path for entry in entries if sections[entry.path] and entry.recorded is None]
        if unrecorded:
            fail('以下条目在源 PDF 中有节正文，但索引没有 verifiedOn，--check 无法确认其转录：'
                 + '、'.join(unrecorded))

    stamp = arg_date(args) if args.write else None
    rebuilt = rebuild(text, entries, sections, stamp)
    transcribed = sum(1 for paragraphs in sections.values() if paragraphs)
    if args.write:
        args.yaml.write_text(rebuilt, encoding='utf-8')
        print(f'已写入 {args.yaml}：{transcribed}/{len(entries)} 条有节正文，'
              f'{len(entries) - transcribed} 条为部分、章或节的容器路径，转录日期 {stamp}')
        return

    if rebuilt == text:
        print(f'一致：{transcribed}/{len(entries)} 条节正文与源 PDF 抽取结果逐字相同')
        return
    fail(f'{args.yaml} 与源 PDF 的抽取结果不一致；运行 --write 重写')


def arg_date(args: argparse.Namespace) -> str:
    """The date `--write` records."""
    if args.verified_on:
        return args.verified_on
    return datetime.date.today().isoformat()


if __name__ == '__main__':
    main()
