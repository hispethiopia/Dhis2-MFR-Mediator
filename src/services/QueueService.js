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
            winston.info(lastUpdate);
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
                                winston.info(`Parent facility ${parentFacilityId} of facility ${mfrFacility.id} is a PHCU.`);
                            }
                        }
                    }

                    if (dhis2Facility && (new Date(mfrFacility.meta.lastUpdated)).getTime() === (new Date(attributeJhrOESQAVor.value)).getTime()) {
                        winston.info(`MFR lastUpdated (${mfrLastUpdated}) is equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
                        continue
                    }

                    // winston.info(`${dhis2Facility? "Updating":"Creating"} Facility with id ${entry.resource.id}`);
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
        const filters =[`attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`,
        `attributeValues.value:in:[${mfrIds.join(',')}]`]
        const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits?`+encodeURIComponent(`fields=name,id,attributeValues,lastUpdated&${filters.map(filter => `filter=${filter}`).join('&')}`)
        // console.log(dhisUrl);
        
        const response = await axios.get(dhisUrl, {
           
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
            }
        });
        // console.log("success",response.data.organisationUnits.length);
        return response.data.organisationUnits;
    
    } catch (error) {
        console.log(error);
        winston.error(`Error fetching facilities from DHIS2: ${error.message}`);
        throw error;
    }
};
DHIS2Service.prototype.getFacilityByMfrId = async function (mfrId) {
    try {
        const filters =[`attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`,
        `attributeValues.value:eq:[${mfrId}]`]
        const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits?`+encodeURIComponent(`fields=name,id,attributeValues,lastUpdated&${filters.map(filter => `filter=${filter}`).join('&')}`)

        const response = await axios.get(dhisUrl, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
            }
        });
        return response.data.organisationUnits;
    } catch (error) {
        winston.error(`Error fetching facility from DHIS2: ${error.message}`);
        throw error;
    }
};



webhookQueue.process(async (payload, done) => {
    syncSingleFacility(payload, done);
});
module.exports.webhookQueue = webhookQueue;





const syncSingleFacility = async (payload, done) => {
    try {
        const id = payload.data.id;
        winston.info("started single facility sync: " + id)
        const mfrService = new MFRService();
        const facility = await mfrService.getSingleMFRFacilty(id);
        const dhis2Service = new DHIS2Service();
        const dhis2OrgUnit = await dhis2Service.getFacilityByMfrId(id);
        const attributeId = process.env.DHIS2_ATTRIBUTE_ID;
        if (dhis2OrgUnit.length !== 0) {

            await dhis2Service.saveFacilityToDataStore(facility);
            winston.info("Facility object mapping for DHIS2 " + facility.name)

        }
        throw winston.Error('Unable to find faclity in dhis2')
    } catch (err) {
        done(err);
    }
};