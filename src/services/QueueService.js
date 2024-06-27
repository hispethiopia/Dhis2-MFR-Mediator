const Bull = require("bull");
const winston = require('winston');
const axios = require('axios');
const MFRService = require('./MFRService');
const DHIS2Service = require('./DHIS2Service');
const fs = require('fs');
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
const failedQueue = new Bull("Failed", queueOptions);





latestUpdatedQueue.process(async (payload, done) => {
    try {
        let lastDate = new Date();
        const DAYS_TO_SUBTRACT = process.env.DAYS_TO_SUBTRACT || 90;
        lastDate.setDate(new Date().getDate() - DAYS_TO_SUBTRACT);
        let lastUpdate = lastDate.toISOString();
        let sync = true;

        while (sync) {
            payload.progress(20);

            const mfrService = new MFRService();
            console.log(lastUpdate);
            const mfrResponseData = await mfrService.getLatestUpdated(lastUpdate);

            if (mfrResponseData && mfrResponseData.entry && mfrResponseData.entry.length > 0) {
                const mfrIds = mfrResponseData.entry.map(entry => entry.resource.id);
                const dhis2Service = new DHIS2Service();
                const dhis2Facilities = await dhis2Service.getFacilitiesByMfrIds(mfrIds);
                payload.progress(40);

                for (const entry of mfrResponseData.entry) {
                    const mfrFacility = entry.resource;

                    //Checks if there is a DHIS2 facility
                    const attributeId = process.env.DHIS2_ATTRIBUTE_ID;
                    const dhis2Facility = dhis2Facilities.find(facility =>
                        facility.attributeValues.some(attr =>
                            attr.attribute.id === attributeId && attr.value === mfrFacility.id
                        )
                    );

                    // Check if the parent facility is PHCU
                    const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
                    if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
                        const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
                        entry.isParentPHCU = false;
                        if (hierarchyParts.length > 1) {
                            const parentFacilityId = hierarchyParts[1];
                            const isPHCU = await mfrService.isPhcu(parentFacilityId);
                            entry.isParentPHCU = isPHCU;

                            if (isPHCU === true) {
                                console.log(`Parent facility ${parentFacilityId} of facility ${mfrFacility.id} is a PHCU.`);
                            } 
                        }
                    }

                    if (dhis2Facility && (new Date(mfrFacility.meta.lastUpdated)).getTime() === (new Date(attributeJhrOESQAVor.value)).getTime()) {
                        console.log(`MFR lastUpdated (${mfrLastUpdated}) is equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
                        continue
                    }

                    // console.log(`${dhis2Facility? "Updating":"Creating"} Facility with id ${entry.resource.id}`);
                    await dhis2Service.saveFacilityToDataStore(entry);

                }

                lastUpdate = mfrResponseData.entry[mfrResponseData.entry.length - 1].resource.meta.lastUpdated;
                lastDate.lastUpdate = lastUpdate;

                await _writeLastDateFile(lastDate);

                payload.progress(100);
            } else {
                sync = false;
            }
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




DHIS2Service.prototype.getFacilitiesByMfrIds = async function (mfrIds) {
    try {
        const response = await axios.get(`${process.env.DHIS2_HOST}/organisationUnits`, {
            params: {
                fields: 'name,id,attributeValues,lastUpdated',
                'filter[0]': `attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`,
                'filter[1]': `attributeValues.value:in:[${mfrIds.join(',')}]`
            },
            auth: {
                username: process.env.DHIS2_USER,
                password: process.env.DHIS2_PASSWORD
            }
        });
        return response.data.organisationUnits;
    } catch (error) {
        winston.error(`Error fetching facilities from DHIS2: ${error.message}`);
        throw error;
    }
};


// webhookQueue.process(async (payload, done) => {
//     syncSingleFacility(payload, done);
// });
// module.exports.webhookQueue = webhookQueue;

// failedQueue.process(async (payload, done) => {
//     syncSingleFacility(payload, done);
// });
// module.exports.failedQueue = failedQueue;



// const syncSingleFacility = async (payload, done) => {
//     try {
//         const mfrId = payload.data.mfrId;
//         const mfrService = new MFRService();
//         const facility = await mfrService.getFacility(mfrId);

//         const dhis2Service = new DHIS2Service();
//         const dhis2OrgUnit = await dhis2Service.getOrgUnitByAttributeValue(mfrId);

//         if (dhis2OrgUnit) {
//             const dhis2LastUpdated = dhis2OrgUnit.attributeValues.find(attr => attr.attribute.id === "Jc6iMhyGt6x").value;
//             if (dhis2LastUpdated === facility.meta.lastUpdated) {
//                 return done();
//             }
//         }

//         const dhis2Objects = await mfrService.mFRtoDhis2ObjectConverter([facility]);
//         if (dhis2Objects.length > 0) {
//             const dhis2ResponseData = await dhis2Service.sendOrgUnit(dhis2Objects, payload);
//             payload.log(`Facility sync to DHIS2: ${dhis2ResponseData.length}`);
//             payload.progress(60);
//         }

//         done();
//     } catch (err) {
//         done(err);
//     }
// };
