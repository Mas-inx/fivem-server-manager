import { describe, expect, it } from 'vitest'
import type { FileChange } from '../../src/shared/types'
import { classifySync, needsConfirmation, overlappingChanges, parseResticDiff } from '../../src/shared/sync'
import { decodeManifest, diffManifest, encodeManifest, type Manifest } from '../../src/main/sync/manifest'

const edit = (path: string): FileChange => ({ path, change: 'modified' })

describe('classifySync', () => {
  it('knows when there is nothing on the remote yet', () => {
    expect(classifySync({ base: null, latest: null, local: [] })).toBe('no-remote-copy')
  })

  it('knows when this machine never synced the server', () => {
    expect(classifySync({ base: null, latest: 'aaa', local: [] })).toBe('never-synced')
  })

  it('is in sync when neither side changed', () => {
    expect(classifySync({ base: 'abc123', latest: 'abc123ff', local: [] })).toBe('in-sync')
  })

  it('sees local-only and remote-only changes', () => {
    expect(classifySync({ base: 'aaa', latest: 'aaa', local: [edit('server.cfg')] })).toBe('local-changed')
    expect(classifySync({ base: 'aaa', latest: 'bbb', local: [] })).toBe('remote-changed')
  })

  it('flags a conflict when both changed since the last sync', () => {
    expect(classifySync({ base: 'aaa', latest: 'bbb', local: [edit('server.cfg')] })).toBe('diverged')
  })
})

describe('needsConfirmation', () => {
  it('stops a push over newer remote work and any diverged copy', () => {
    expect(needsConfirmation('push', 'remote-changed')).toBe(true)
    expect(needsConfirmation('push', 'diverged')).toBe(true)
    expect(needsConfirmation('push', 'local-changed')).toBe(false)
    expect(needsConfirmation('push', 'no-remote-copy')).toBe(false)
  })

  it('stops a pull over local edits', () => {
    expect(needsConfirmation('pull', 'local-changed')).toBe(true)
    expect(needsConfirmation('pull', 'never-synced')).toBe(true)
    expect(needsConfirmation('pull', 'diverged')).toBe(true)
    expect(needsConfirmation('pull', 'remote-changed')).toBe(false)
    expect(needsConfirmation('pull', 'in-sync')).toBe(false)
  })
})

describe('change lists', () => {
  it('lists files changed on both sides, ignoring case', () => {
    expect(overlappingChanges([edit('Server.cfg'), edit('a.lua')], [edit('server.cfg'), edit('b.lua')])).toEqual(['Server.cfg'])
  })

  it('reads restic diff output, skipping folders and the sync folder', () => {
    const changes = parseResticDiff([
      { message_type: 'change', path: '/resources/[local]/', modifier: '+' },
      { message_type: 'change', path: '/resources/[local]/a.lua', modifier: '+' },
      { message_type: 'change', path: '/old.lua', modifier: '-' },
      { message_type: 'change', path: '/server.cfg', modifier: 'M' },
      { message_type: 'change', path: '/.fxsync/database.sql', modifier: 'M' },
      { message_type: 'statistics' }
    ])
    expect(changes).toEqual([
      { path: 'resources/[local]/a.lua', change: 'added' },
      { path: 'old.lua', change: 'removed' },
      { path: 'server.cfg', change: 'modified' }
    ])
  })
})

describe('diffManifest', () => {
  const before: Manifest = new Map([
    ['server.cfg', { size: 100, mtime: 1 }],
    ['resources/a.lua', { size: 10, mtime: 1 }],
    ['resources/b.lua', { size: 10, mtime: 1 }]
  ])

  it('finds added, removed and modified files', () => {
    const after: Manifest = new Map([
      ['server.cfg', { size: 100, mtime: 2 }],
      ['resources/a.lua', { size: 10, mtime: 1 }],
      ['resources/c.lua', { size: 5, mtime: 1 }]
    ])
    expect(diffManifest(before, after)).toEqual([
      { path: 'resources/b.lua', change: 'removed' },
      { path: 'resources/c.lua', change: 'added' },
      { path: 'server.cfg', change: 'modified' }
    ])
  })

  it('treats a case-only rename as the same file on Windows', () => {
    const after: Manifest = new Map([...before].map(([p, e]) => [p.toUpperCase(), e]))
    expect(diffManifest(before, after)).toEqual([])
  })

  it('round-trips through the saved form', () => {
    const { snapshot, files } = decodeManifest(encodeManifest('abc', before))
    expect(snapshot).toBe('abc')
    expect(diffManifest(before, files)).toEqual([])
  })
})
