// @vitest-environment jsdom
import { expect, it } from 'vitest'
import type { Link, Paragraph, Root } from 'mdast'
import { parseGfm, parseGfmWithMath } from '../src/markdown/parse.ts'

/** The first link of a one-paragraph document. */
function link(parse: (text: string) => Root, markdown: string): Link {
  return (parse(markdown).children[0] as Paragraph).children[0] as Link
}

it.each([parseGfm, parseGfmWithMath])('keeps Windows destinations literal and leaves other destinations to CommonMark', (parse) => {
  // A drive path has no scheme and no slash, so every backslash stays literal.
  expect(link(parse, '[repo](D:\\work\\repo)').url).toBe('D:\\work\\repo')
  // A backslash before punctuation would otherwise be read as an escape.
  expect(link(parse, '[workflow](C:\\repo\\.github\\workflows)').url).toBe('C:\\repo\\.github\\workflows')
  // A relative destination stays privileged through a slash when a backslash precedes a letter or digit.
  expect(link(parse, '[relative](./dir\\file.md)').url).toBe('./dir\\file.md')
  // Slash plus a backslash before punctuation is an escaped character, not a path.
  expect(link(parse, '[punctuation](./dir\\.hidden)').url).toBe('./dir.hidden')
  // A URL scheme wins over the backslashes, so this destination parses as CommonMark reads it.
  expect(link(parse, '[scheme](dsh-file:a\\.b)').url).toBe('dsh-file:a.b')
  // Character references still decode inside a preserved Windows destination.
  expect(link(parse, '[ampersand](D:\\a\\&amp;b)').url).toBe('D:\\a\\&b')
})
