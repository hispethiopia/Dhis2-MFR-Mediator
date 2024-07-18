
const {latestUpdatedQueue,webhookQueue} = require('./QueueService')

const adress = process.env.ADRESS



module.exports.startSyncUpdated = async (lastDate) => {
    job = await latestUpdatedQueue.add({lastDate})
    return `The job for lastUpdated sync is started: ${adress}/mediator/queue/latestUpdated/${job.id}`    
}


module.exports.startSyncWebhook = async(id) => {
    if (id){
        job = await webhookQueue.add({id})
        return `The job for webhook sync is started: ${adress}/mediator/queue/webhook/${job.id} and location id ${id}`        
    }
}
