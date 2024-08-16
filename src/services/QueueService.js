const Bull = require("bull");
const winston = require('winston');
const axios = require('axios');
const MFRService = require('./MFRService.js');
const DHIS2Service = require('./DHIS2Service.js');
const fs = require('fs');
const { Console } = require("console");
const file = './src/utils/lastDate.json';



const { REDIS_HOST, REDIS_PORT } = process.env;
const queueOptions = {
    redis: {
        host: REDIS_HOST,
        port: REDIS_PORT
    }
};

const latestUpdatedQueue = new Bull("Latest Updated", queueOptions);
const webhookQueue = new Bull("Webhook", queueOptions);







// latestUpdatedQueue.process(async (payload, done) => {
//     try {
//         let lastDate = new Date();
//         const DAYS_TO_SUBTRACT = process.env.DAYS_TO_SUBTRACT || 90;
//         lastDate.setDate(new Date().getDate() - DAYS_TO_SUBTRACT);
//         let lastUpdate = lastDate.toISOString();
//         let sync = true;

//         while (sync) {
//             payload.progress(20);

//             const mfrService = new MFRService();
//             winston.info(lastUpdate);
//              const mfrResponseData = await mfrService.getLatestUpdated(lastUpdate);
            

//             if (mfrResponseData && mfrResponseData.entry && mfrResponseData.entry.length > 0) {
//                 const mfrIds = mfrResponseData.entry.map(entry => entry.resource.id);
//                 const dhis2Service = new DHIS2Service();
//                 const dhis2Facilities = await dhis2Service.getFacilitiesByMfrIds(mfrIds);
//                 payload.progress(40);
//                 for (const entry of mfrResponseData.entry) {
//                     const mfrFacility = entry.resource;
//                     const lastUpdated = await dhis2Service.getMfrLastUpdated(mfrFacility.id);
//                     const lastUpdatedDate = new Date(lastUpdated);
//                     const mfrLastUpdatedDate = new Date(mfrFacility.meta.lastUpdated);
//                     if (lastUpdatedDate.getTime() === mfrLastUpdatedDate.getTime()) {
//                             payload.log("Mfr facility "+ mfrFacility.meta.id + " lastUpdated is equal");
//                             continue;
//                         }else{
//                             const attributeId = process.env.DHIS2_ATTRIBUTE_ID;
//                         const dhis2Facility = dhis2Facilities.find(facility =>
//                             facility.attributeValues && facility.attributeValues.some(attr =>
//                                 attr.attribute.id === attributeId && attr.value === mfrFacility.id
//                             )
//                         );
                        
//                         // Check if the parent facility is PHCU
//                 if(mfrFacility.extension == undefined)
//                 continue
                
//                         const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
//                         if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
//                             const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
//                             entry.isParentPHCU = false;
//                             if (hierarchyParts.length > 1) {
//                                 const parentFacilityId = hierarchyParts[1];
//                                 const isPHCU = await mfrService.isPhcu(parentFacilityId);
//                                 entry.isParentPHCU = isPHCU;
    
//                                 if (isPHCU === true) {
//                                     payload.log(`Parent facility ${parentFacilityId} of facility ${mfrFacility.id} is a PHCU.`);
//                                 }
//                             }
//                         }
    
                        
//                         // winston.info(`${dhis2Facility? "Updating":"Creating"} Facility with id ${entry.resource.id}`);
//                         await dhis2Service.saveFacilityToDataStore(entry, payload);
//                         }
                    
//                 }
//                 // lastUpdate = mfrResponseData.entry[mfrResponseData.entry.length - 1].resource.meta.lastUpdated;
                
//                 // lastDate.lastUpdate = lastUpdate;
                
//                 // await _writeLastDateFile(lastDate);

//                 payload.progress(100);
//             } else {
//                 sync = false;
//             }
//         }

//         done()
//     } catch (err) {
//         done(err);
//     }
// });
latestUpdatedQueue.process(async (payload, done) => {
    try {
        let lastDate = new Date();
        const DAYS_TO_SUBTRACT = process.env.DAYS_TO_SUBTRACT || 90;
        lastDate.setDate(new Date().getDate() - DAYS_TO_SUBTRACT);
        let lastUpdate = lastDate.toISOString();
        let sync = true;

        const mfrService = new MFRService();

        while (sync) {
            payload.progress(20);

            winston.info(lastUpdate);

            await mfrService.getLatestUpdated(lastUpdate, async (mfrResponseData) => {
                if (mfrResponseData && mfrResponseData.entry && mfrResponseData.entry.length > 0) {
                    const mfrIds = mfrResponseData.entry.map(entry => entry.resource.id);
                    const dhis2Service = new DHIS2Service();
                    const dhis2Facilities = await dhis2Service.getFacilitiesByMfrIds(mfrIds);
                    payload.progress(40);

                    for (const entry of mfrResponseData.entry) {
                        const mfrFacility = entry.resource;
                        const lastUpdated = await dhis2Service.getMfrLastUpdated(mfrFacility.id);
                        const lastUpdatedDate = new Date(lastUpdated);
                        const mfrLastUpdatedDate = new Date(mfrFacility.meta.lastUpdated);

                        if (lastUpdatedDate.getTime() === mfrLastUpdatedDate.getTime()) {
                            payload.log("Mfr facility " + mfrFacility.meta.id + " lastUpdated is equal");
                            continue;
                        } else {
                            const attributeId = process.env.DHIS2_ATTRIBUTE_ID;
                            const dhis2Facility = dhis2Facilities.find(facility =>
                                facility.attributeValues && facility.attributeValues.some(attr =>
                                    attr.attribute.id === attributeId && attr.value === mfrFacility.id
                                )
                            );

                            // Check if the parent facility is PHCU
                            if (mfrFacility.extension === undefined) continue;

                            const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
                            if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
                                const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
                                entry.isParentPHCU = false;
                                if (hierarchyParts.length > 1) {
                                    const parentFacilityId = hierarchyParts[1];
                                    const isPHCU = await mfrService.isPhcu(parentFacilityId);
                                    entry.isParentPHCU = isPHCU;

                                    if (isPHCU === true) {
                                        payload.log(`Parent facility ${parentFacilityId} of facility ${mfrFacility.id} is a PHCU.`);
                                    }
                                }
                            }

                            await dhis2Service.saveFacilityToDataStore(entry, payload);
                        }
                    }

                    payload.progress(100);
                } else {
                    sync = false;
                }
            });
        }

        done();
    } catch (err) {
        done(err);
    }
});


module.exports.latestUpdatedQueue = latestUpdatedQueue;

async function _writeLastDateFile(lastDate) {
    const fs = require('fs').promises;
    try {
        await fs.writeFile('lastDate.json', JSON.stringify(lastDate));
    } catch (error) {
        winston.error(`Error writing last date file: ${error.message}`);
        throw error;
    }
}



webhookQueue.process(async (payload, done) => {
    syncSingleFacility(payload, done);
});
module.exports.webhookQueue = webhookQueue;



const syncSingleFacility = async (payload, done) => {
    try {
        const id = payload.data.id;
        payload.log("Started single facility sync: " + id);
        
        const mfrService = new MFRService();
        const facility = await mfrService.getSingleMFRFacilty(id);
        const dhis2Service = new DHIS2Service();
        const dhis2OrgUnit = await dhis2Service.getFacilityByMfrId(id);
        const lastUpdated = await dhis2Service.getMfrLastUpdated(id)
        const facilityLastUpdatedDate = new Date(facility.resource.meta.lastUpdated);
        const lastUpdatedDate = new Date(lastUpdated);
        if (facilityLastUpdatedDate.getTime() === lastUpdatedDate.getTime()) {
                payload.log("Mfr facility "+facility.resource.id+" lastUpdated is equal");
                done();
            }
            else{
                if (dhis2OrgUnit.length !== 0) {
                    await dhis2Service.saveFacilityToDataStore(facility,payload);
                    payload.log("Mfr facility mapped for DHIS2 facility: " + facility.resource.name);
                } else {
                    payload.log("Facility not found in DHIS2, creating new entry: " + facility.resource.name);
                    await dhis2Service.saveFacilityToDataStore(facility,payload);
                }
            }
        }
        catch (err) {
        done(err);
    }
};
