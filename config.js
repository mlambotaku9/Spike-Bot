const fs = require('fs')
const chalk = require('chalk')

global.pairingNum = ""

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.yellow(`'${__filename}' has been updated`))
    delete require.cache[file]
    require(file)
})