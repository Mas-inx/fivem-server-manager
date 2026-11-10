import { describe, expect, it } from 'vitest'
import { compileIgnore, DEFAULT_IGNORE, resticExcludes } from '../../src/main/sync/ignore'

describe('default ignore list', () => {
  const m = compileIgnore(DEFAULT_IGNORE)

  it('leaves out caches, logs and crash dumps', () => {
    expect(m.ignores('cache', true)).toBe(true)
    expect(m.ignores('cache/files/sessionmanager/resource.rpf', false)).toBe(true)
    expect(m.ignores('txData/default/logs', true)).toBe(true)
    expect(m.ignores('txData/default/logs/admin.log', false)).toBe(true)
    expect(m.ignores('logs/console-2026-11-11.log', false)).toBe(true)
    expect(m.ignores('crashes/dump.zip', false)).toBe(true)
    expect(m.ignores('FXServer_crash.dmp', false)).toBe(true)
    expect(m.ignores('resources/[local]/hud/upload.tmp', false)).toBe(true)
  })

  it('keeps the server itself', () => {
    expect(m.ignores('server.cfg', false)).toBe(false)
    expect(m.ignores('resources/[local]/hud/fxmanifest.lua', false)).toBe(false)
    expect(m.ignores('resources/[maps]/miami/stream/mia_01.ymap', false)).toBe(false)
    expect(m.ignores('txData/default/config.json', false)).toBe(false)
    expect(m.ignores('txData/default/data/playersDB.json', false)).toBe(false)
  })

  it('only matches folders with a trailing slash pattern', () => {
    // "cache/" is a folder rule, so a file called cache is kept.
    expect(m.ignores('resources/thing/cache', false)).toBe(false)
    expect(m.ignores('resources/thing/cache', true)).toBe(true)
  })
})

describe('pattern rules', () => {
  it('anchors patterns that contain a slash', () => {
    const m = compileIgnore('/server-data/big\nstream/*.ytd')
    expect(m.ignores('server-data/big', true)).toBe(true)
    expect(m.ignores('other/server-data/big', true)).toBe(false)
    expect(m.ignores('stream/a.ytd', false)).toBe(true)
    expect(m.ignores('resources/x/stream/a.ytd', false)).toBe(false)
  })

  it('supports ** across folders and * within one', () => {
    const m = compileIgnore('resources/**/dev/\n*.bak')
    expect(m.ignores('resources/dev', true)).toBe(true)
    expect(m.ignores('resources/[a]/[b]/dev', true)).toBe(true)
    expect(m.ignores('resources/[a]/dev/x.lua', false)).toBe(true)
    expect(m.ignores('deep/folder/file.bak', false)).toBe(true)
    expect(m.ignores('file.bak.lua', false)).toBe(false)
  })

  it('lets a later ! line bring a file back', () => {
    const m = compileIgnore('*.log\n!keep.log')
    expect(m.ignores('a.log', false)).toBe(true)
    expect(m.ignores('sub/keep.log', false)).toBe(false)
  })

  it('cannot bring back a file inside an ignored folder', () => {
    const m = compileIgnore('logs/\n!logs/keep.txt')
    expect(m.ignores('logs/keep.txt', false)).toBe(true)
  })

  it('treats [ and ] as plain characters for FiveM categories', () => {
    const m = compileIgnore('resources/[test]/')
    expect(m.ignores('resources/[test]', true)).toBe(true)
    expect(m.ignores('resources/t', true)).toBe(false)
    expect(m.ignores('resources/[test]/thing/fxmanifest.lua', false)).toBe(true)
  })

  it('ignores case and accepts backslashes, comments and blank lines', () => {
    const m = compileIgnore('# comment\n\n  Cache\\  \n')
    expect(m.ignores('CACHE', true)).toBe(true)
    expect(m.ignores('server-data/cache/x', false)).toBe(true)
  })

  it('combines several lists (old and new ignore files during a pull)', () => {
    const m = compileIgnore('a.txt', 'b.txt')
    expect(m.ignores('a.txt', false)).toBe(true)
    expect(m.ignores('b.txt', false)).toBe(true)
    expect(m.ignores('c.txt', false)).toBe(false)
  })
})

describe('restic exclude lines', () => {
  it('writes absolute Windows paths and escapes [ so it is matched literally', () => {
    expect(resticExcludes('C:\\FX\\servers\\a\\', ['cache', 'resources/[local]/x.tmp'])).toEqual([
      'C:\\FX\\servers\\a\\cache',
      'C:\\FX\\servers\\a\\resources\\[[]local]\\x.tmp'
    ])
  })
})
