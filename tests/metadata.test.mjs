// Zero-dependency checks for the static landing page.
// Covers head metadata, social preview tags, internal anchors and local assets.
// Run with: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(root, 'index.html'), 'utf8')

// Custom domain is the single source of truth for absolute URLs.
const origin = 'https://' + readFileSync(join(root, 'CNAME'), 'utf8').trim()

// Pull every <tag ...> of a kind, with attributes as a plain object.
const tags = (name) =>
  [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) =>
    Object.fromEntries(
      [...m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((a) => [a[1].toLowerCase(), a[2]])
    )
  )

const meta = (key, value) =>
  tags('meta').find((t) => (t.property ?? t.name)?.toLowerCase() === key)?.[value ?? 'content']

const link = (rel) => tags('link').find((t) => t.rel?.toLowerCase() === rel)?.href

test('html element declares a language', () => {
  assert.match(html, /<html[^>]*\blang="[a-z]{2}(-[A-Za-z]+)?"/)
})

test('title is present and not runaway length', () => {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1].trim()
  assert.ok(title, 'missing <title>')
  // Google truncates around 60; 70 is the hard failure so copy tweaks stay free.
  assert.ok(title.length <= 70, `title is ${title.length} chars: ${title}`)
})

test('meta description is present and not runaway length', () => {
  const desc = meta('description')
  assert.ok(desc, 'missing <meta name="description">')
  assert.ok(desc.length <= 200, `description is ${desc.length} chars`)
})

test('required Open Graph tags are present', () => {
  for (const key of ['og:title', 'og:description', 'og:type', 'og:image', 'og:url']) {
    assert.ok(meta(key)?.trim(), `missing ${key}`)
  }
})

// Facebook, LinkedIn and WhatsApp crawlers reject relative og:image paths.
test('og:image is an absolute URL on the canonical origin', () => {
  const src = meta('og:image')
  assert.ok(src.startsWith(`${origin}/`), `og:image must start with ${origin}/ but is "${src}"`)
})

test('og:image points at a file that exists in the repo', () => {
  const path = meta('og:image').slice(origin.length + 1)
  assert.ok(existsSync(join(root, path)), `og:image target "${path}" is not in the repo`)
})

test('og:url and canonical agree with the CNAME origin', () => {
  for (const [label, url] of [['og:url', meta('og:url')], ['canonical', link('canonical')]]) {
    assert.ok(url, `missing ${label}`)
    assert.ok(url.startsWith(origin), `${label} "${url}" does not match CNAME origin ${origin}`)
  }
})

test('twitter card is declared', () => {
  assert.ok(meta('twitter:card')?.trim(), 'missing <meta name="twitter:card">')
})

test('element ids are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  assert.deepEqual([...new Set(dupes)], [], 'duplicate ids')
})

test('every in-page anchor resolves to a real id', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
  const broken = [...html.matchAll(/href="#([^"]+)"/g)]
    .map((m) => m[1])
    .filter((frag) => !ids.has(frag))
  assert.deepEqual([...new Set(broken)], [], 'anchors with no matching id')
})

test('every local asset reference exists on disk', () => {
  const refs = [
    ...tags('img').map((t) => t.src),
    ...tags('link').map((t) => t.href),
    ...tags('script').map((t) => t.src),
  ].filter((ref) => ref && !/^(https?:)?\/\//.test(ref) && !ref.startsWith('#'))

  const missing = refs.filter((ref) => !existsSync(join(root, ref.split(/[?#]/)[0])))
  assert.deepEqual(missing, [], 'referenced files not found in the repo')
})
