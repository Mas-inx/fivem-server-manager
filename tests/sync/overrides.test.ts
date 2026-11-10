import { describe, expect, it } from 'vitest'
import { applyLocalCfg, rebasePaths, txHostEnv, type LocalSettings } from '../../src/main/sync/overrides'

const pulled = [
  '# from the recording VPS',
  'endpoint_add_tcp "0.0.0.0:30150"',
  'endpoint_add_udp "0.0.0.0:30150"',
  'set mysql_connection_string "mysql://root:vpspass@127.0.0.1:3307/vps_db?charset=utf8mb4"',
  'sv_maxclients 64',
  '# sv_licenseKey "commented"',
  'sv_licenseKey "cfxk_vps_key"',
  'ensure chat',
  ''
].join('\r\n')

const local: LocalSettings = {
  mode: 'standalone',
  gamePort: 30120,
  txAdminPort: 40120,
  licenseKey: 'cfxk_pc_key',
  database: 'pc_db',
  connectionString: 'mysql://root:pcpass@127.0.0.1:3306/pc_db?charset=utf8mb4',
  db: { host: '127.0.0.1', port: 3306, user: 'root', password: 'pcpass' }
}

describe('applyLocalCfg', () => {
  it("puts this machine's port, license key and database back", () => {
    const out = applyLocalCfg(pulled, local)
    expect(out).toContain('endpoint_add_tcp "0.0.0.0:30120"')
    expect(out).toContain('endpoint_add_udp "0.0.0.0:30120"')
    expect(out).toContain('sv_licenseKey "cfxk_pc_key"')
    expect(out).toContain('set mysql_connection_string "mysql://root:pcpass@127.0.0.1:3306/pc_db?charset=utf8mb4"')
    expect(out).not.toContain('30150')
    expect(out).not.toContain('vpspass')
  })

  it('leaves everything else alone, comments and line endings included', () => {
    const out = applyLocalCfg(pulled, local)
    expect(out).toContain('# sv_licenseKey "commented"')
    expect(out).toContain('sv_maxclients 64')
    expect(out).toContain('ensure chat')
    expect(out.split('\r\n').length).toBe(pulled.split('\r\n').length)
  })

  it('adds missing lines to a standalone config', () => {
    const out = applyLocalCfg('ensure chat\n', local)
    expect(out).toContain('endpoint_add_tcp "0.0.0.0:30120"')
    expect(out).toContain('sv_licenseKey "cfxk_pc_key"')
    expect(out).toContain('set mysql_connection_string')
  })

  it('only rewrites existing lines in a txAdmin config', () => {
    const tx = { ...local, mode: 'txadmin' as const }
    expect(applyLocalCfg('ensure chat\n', tx)).toBe('ensure chat\n')
    expect(applyLocalCfg(pulled, tx)).toContain('endpoint_add_udp "0.0.0.0:30120"')
  })

  it('keeps the pulled values when this machine has none', () => {
    const out = applyLocalCfg(pulled, { ...local, licenseKey: '', database: null, connectionString: null })
    expect(out).toContain('sv_licenseKey "cfxk_vps_key"')
    expect(out).toContain('vps_db')
    expect(out).toContain('0.0.0.0:30120')
  })
})

describe('txHostEnv', () => {
  it("is built from this machine's settings", () => {
    const env = txHostEnv('D:\\FX\\a\\txData', { ...local, licenseKey: 'cfxk_abc_123' })
    expect(env).toMatchObject({
      TXHOST_DATA_PATH: 'D:\\FX\\a\\txData',
      TXHOST_TXA_PORT: '40120',
      TXHOST_FXS_PORT: '30120',
      TXHOST_DEFAULT_CFXKEY: 'cfxk_abc_123',
      TXHOST_DEFAULT_DBNAME: 'pc_db',
      TXHOST_DEFAULT_DBPORT: '3306',
      TXHOST_DEFAULT_DBPASS: 'pcpass'
    })
  })

  it('skips malformed keys and absent databases', () => {
    const env = txHostEnv('x', { ...local, licenseKey: 'changeme', database: null })
    expect(env.TXHOST_DEFAULT_CFXKEY).toBeUndefined()
    expect(env.TXHOST_DEFAULT_DBNAME).toBeUndefined()
  })
})

describe('rebasePaths', () => {
  const config = {
    server: { dataPath: 'C:\\FXServers\\servers\\vid2\\txData\\CFX.base\\', cfgPath: 'server.cfg' },
    logger: { path: 'c:/fxservers/servers/vid2/txData/default/logs/' },
    other: ['C:\\FXServers\\servers\\vid2-old\\x', 42, null]
  }

  it("moves txAdmin's paths to this machine's folder", () => {
    const out = rebasePaths(config, 'C:\\FXServers\\servers\\vid2', 'D:\\Servers\\vid2') as typeof config
    expect(out.server.dataPath).toBe('D:\\Servers\\vid2\\txData\\CFX.base')
    expect(out.server.cfgPath).toBe('server.cfg')
    expect(out.logger.path).toBe('D:/Servers/vid2/txData/default/logs/')
  })

  it('does not touch a sibling folder that only shares the prefix', () => {
    const out = rebasePaths(config, 'C:\\FXServers\\servers\\vid2', 'D:\\Servers\\vid2') as typeof config
    expect(out.other).toEqual(['C:\\FXServers\\servers\\vid2-old\\x', 42, null])
  })
})
