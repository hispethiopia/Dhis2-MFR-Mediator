const express = require('express')
const path = require('path')

//OpenHIM dependencies
const medUtils = require('openhim-mediator-utils')
const winston = require('winston')

//Setting up .env variables
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {
  level: 'info',
  timestamp: true,
  colorize: true
})

winston.add(winston.transports.File, {filename: 'logs/Dhis2-MFR-mediator.log'})

// Config
let config = {} // this will vary depending on whats set in openhim-core
const apiConf = process.env.NODE_ENV === 'test' ? require('./src/config/test') : require('./src/config/config')
const mediatorConfig = require('./src/config/mediator')
let port = process.env.NODE_ENV === 'test' ? 7001 : process.env.PORT
/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
 function setupApp () {
  const app = express();

  app.use('/', require('./src/routes/fetchLastUpdated'))
  
  return app
 }

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
 function start (callback) {
  if (apiConf.api.trustSelfSigned) { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' }

  if (apiConf.register) {
    medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        winston.error('Failed to register this mediator, check your config')
        winston.error(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
        winston.info('Received initial config:')
        winston.info(JSON.stringify(newConfig))
        config = newConfig
        if (err) {
          winston.error('Failed to fetch initial config')
          winston.error(err.stack)
          process.exit(1)
        } else {
          winston.info('Successfully registered mediator!')
          let app = setupApp()
          const server = app.listen(port, () => {
            if (apiConf.heartbeat) {
              let configEmitter = medUtils.activateHeartbeat(apiConf.api)
              configEmitter.on('config', (newConfig) => {
                winston.info('Received updated config:')
                winston.info(JSON.stringify(newConfig))
                // set new config for mediator
                config = newConfig

                // we can act on the new config received from the OpenHIM here
                winston.info(config)
              })
            }
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let app = setupApp()
    const server = app.listen(port, () => callback(server))
  }
}
exports.start = start

// app.listen(port, () => {
//   winston.info(`Hapi fire mediator app listening on port ${port}!`)
// });

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => {
    winston.info(`Running on ${port}...`);
    winston.info(`For the UI, open ${process.env.ADRESS}/mediator`);
    winston.info("Make sure Redis is running on port 6379 by default");
  })

}