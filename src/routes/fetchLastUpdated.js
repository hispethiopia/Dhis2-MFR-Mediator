const express = require('express')

const Queue = require("bull");
const { createBullBoard } = require("@bull-board/api");
const { BullAdapter } = require("@bull-board/api/bullAdapter");
const { ExpressAdapter } = require("@bull-board/express");


var router = express.Router()

const winston = require('winston')

const fs = require('fs');

const mediatorConfig = require('../config/mediator')
const utils = require('../utils/utils')

const { startSyncUpdated, startSyncWebhook } = require('../services/main');
const file = './src/utils/lastDate.json';

var responseBody = {}
var lastDate = {}




//Queue Board
const { REDIS_HOST, REDIS_PORT} = process.env
const redisOptions = {
    redis: {
        host: REDIS_HOST,
        port: REDIS_PORT
    }
}

// Create a new queue with the Redis connection options
const queuesList = [ "Latest Updated", "Webhook", "Failed"];

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(process.env.Root+"mediator");

const queues = queuesList
    .map((qs) => new Queue(qs, redisOptions))
    .map((q) => new BullAdapter(q));
const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues,
    serverAdapter: serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'MFR-DHIS2',
      },
    },
});



router.use('/fetchLatestUpdated', function (req, res, next) {
  // This route get all facilities using last update at parameter and send to dhis2

  if(process.env.lastUpdate == 'true'){
    try {
      fs.readFile(file, 'utf8', (err, jsonString) => {
        if (err) {
          winston.error("File read failed:", err)        
          res.send("Cannot read file")
        }
          
        lastDate = JSON.parse(jsonString);
        winston.info('Request initiated', lastDate.lastUpdate)
        
        startSyncUpdated(lastDate).then(response => {
          winston.info('Sync response from last update', response)
  
          res.send(response)
        })      
      })
    } catch (error) {
      res.send(error)
    }
  } else
    res.send("Cannot export newly updated facilities")
})

router.get('/webhook/:id', (req, res) => {
  startSyncWebhook(req.params.id).then(response => {
    res.send(response);
  })
})

router.use('/mediator', serverAdapter.getRouter())

module.exports = router