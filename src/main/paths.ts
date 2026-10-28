import { join } from 'node:path'
import type { Platform } from '@shared/types'
import { store } from './store'

const lib = (): string => store.settings.libraryPath

export const paths = {
  library: lib,
  artifacts: (platform: Platform): string => join(lib(), 'artifacts', platform),
  artifact: (platform: Platform, build: string): string => join(lib(), 'artifacts', platform, build),
  servers: (): string => join(lib(), 'servers'),
  downloads: (): string => join(lib(), '.downloads'),
  mariadb: (): string => join(lib(), 'mariadb'),
  mariadbData: (): string => join(lib(), 'mariadb', 'data')
}
