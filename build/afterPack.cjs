const fs = require('node:fs')
const path = require('node:path')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])

module.exports = async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales')
  if (!fs.existsSync(localesDir)) return

  for (const fileName of fs.readdirSync(localesDir)) {
    if (KEEP_LOCALES.has(fileName)) continue
    fs.rmSync(path.join(localesDir, fileName), { force: true })
  }
}
