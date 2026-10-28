// Renders the SVG logos in /resources into the PNG and ICO files Electron and the installer need.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

const render = (svgFile, size) =>
  new Resvg(readFileSync(join(root, svgFile)), { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(join(root, 'icon.png'), render('logo.svg', 512))
writeFileSync(join(root, 'tray.png'), render('tray.svg', 32))
writeFileSync(join(root, 'tray@2x.png'), render('tray.svg', 64))

const sizes = [16, 24, 32, 48, 64, 128, 256]
writeFileSync(join(root, 'icon.ico'), await pngToIco(sizes.map((s) => render('logo.svg', s))))

console.log('Icons written to', root)
