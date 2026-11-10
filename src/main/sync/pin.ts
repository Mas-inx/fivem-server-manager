/**
 * The sync engine is restic, pinned to one release and checked against the SHA-256 published in
 * that release's SHA256SUMS before it is ever run. Updating means changing all three values.
 */
export const RESTIC_VERSION = '0.19.1'
export const RESTIC_URL = `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_windows_amd64.zip`
export const RESTIC_SHA256 = 'da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d'

/** restic's rest-server, for the hub role. Same rule: pinned release, published SHA-256. */
export const REST_SERVER_VERSION = '0.14.0'
export const REST_SERVER_URL = `https://github.com/restic/rest-server/releases/download/v${REST_SERVER_VERSION}/rest-server_${REST_SERVER_VERSION}_windows_amd64.zip`
export const REST_SERVER_SHA256 = '98e31e33816861722e0f04c7f56811a3ff2f37e006def217ad6eda8e438c9d82'
