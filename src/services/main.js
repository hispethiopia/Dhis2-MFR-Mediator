
const {latestUpdatedQueue} = require('./QueueService')

const adress = process.env.ADRESS



module.exports.startSyncUpdated = async (lastDate) => {
    job = await latestUpdatedQueue.add({lastDate})
    return `The job for lastUpdated sync is started: ${adress}/mediator/queue/latestUpdated/${job.id}`    
}



