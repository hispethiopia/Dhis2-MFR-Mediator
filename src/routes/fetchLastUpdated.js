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

const { startSyncUpdated, startSyncCreated, startSyncHierarchy, startSyncWebhook } = require('../services/main');
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
const queuesList = ["Hierarchy", "Latest Created", "Latest Updated", "Webhook", "Failed"];

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

router.use('/fetchLatestCreated', function (req, res) {
  // This route get all facilities using created at parameter and send to dhis2
  
  if(process.env.createdDate == 'true'){
    try {
      fs.readFile(file, 'utf8', (err, jsonString) => {
        if (err) {
          winston.error("File read failed:", err)        
          res.send("Cannot read file")
        }
          
        lastDate = JSON.parse(jsonString);
        winston.info('Request initiated', lastDate.lastCreate)
        
        startSyncCreated(lastDate).then(response => {
          winston.info('Sync response from last created', response)
  
          res.send(response)  
        })      
      })
    } catch (error) {
      res.send(error)
    }
  }else
  res.send("Cannot export newly created facilities")
  
})

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

router.use('/fetchHierarchy', function(req, res){
  // const transactionId = req.headers['x-openhim-transactionid']

  // Example usage:
  // Call the function with the desired status and an optional message
  // utils.updateTransactionStatus('success', 'Transaction completed successfully');
  // Or update with a failure status
  // utils.updateTransactionStatus('failed', 'Transaction failed due to an error', transactionId);
  // return res.send("Data")

  startSyncHierarchy(lastDate).then(response => {
    winston.info('Sync response ', response)

    responseBody = response
    
    // set content type header so that OpenHIM knows how to handle the response
    res.set('Content-Type', 'application/json+openhim')
    
    var headers = {
      'content-type': 'application/json'
    }

    // add logic to alter the request here

    // capture orchestration data
    var orchestrationResponse = {
      statusCode: 200,
      headers: headers
    }
    const orchestrations = []
    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, JSON.stringify(responseBody)))
    
    // construct return object
    var properties = {
      property: 'Primary Route'
    }

    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Successful', 200, headers, JSON.stringify(responseBody), orchestrations, properties))
  })
})


router.use('/mediator', serverAdapter.getRouter())

module.exports = router