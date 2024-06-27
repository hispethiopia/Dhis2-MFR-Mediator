const Bull = require("bull");
const winston = require('winston');
const axios = require('axios');
const MFRService = require('../services/MFRService');
const DHIS2Service = require('../services/DHIS2Service');
const fs = require('fs');
const file = './src/utils/lastDate.json';
const references = require('../utils/references');
const { json } = require("express");

const { REDIS_HOST, REDIS_PORT } = process.env;
const queueOptions = {
    redis: {
        host: REDIS_HOST,
        port: REDIS_PORT
    }
};

const hierarchyQueue = new Bull("Hierarchy", queueOptions);
const latestCreatedQueue = new Bull("Latest Created", queueOptions);
const latestUpdatedQueue = new Bull("Latest Updated", queueOptions);
const webhookQueue = new Bull("Webhook", queueOptions);
const failedQueue = new Bull("Failed", queueOptions);

hierarchyQueue.process(async (payload, done) => {
    try {
        const mfrService = new MFRService();

        payload.log("Creating root location " + references.fmohLocationId);
        const fmohDHIS2Data = await createRoot(references.fmohLocationId);

        if (!fmohDHIS2Data) {
            throw new Error("Failed to create root org unit in DHIS2");
        }

        payload.log("Root org unit created", fmohDHIS2Data.name || "Name not available", fmohDHIS2Data.facilityId || "Facility ID not available");

        const regionsData = await mfrService.getOrganizationAffiliation(fmohDHIS2Data.id);
        payload.progress(20);

        if (regionsData.entry) {
            const correctRegionLocations = await processAndSendData(regionsData, fmohDHIS2Data, true);
            payload.log("Region response data " + correctRegionLocations.length);

            payload.progress(30);

            for (const region of correctRegionLocations) {
                payload.progress(40);
                const zonesData = await mfrService.getOrganizationAffiliation(region.id);
                const correctZoneLocations = await processAndSendData(zonesData, region);
                payload.log("Zone response data " + correctZoneLocations.length);

                for (const zone of correctZoneLocations) {
                    payload.progress(50);
                    const woredasData = await mfrService.getOrganizationAffiliation(zone.id);
                    const correctWoredaLocations = await processAndSendData(woredasData, zone);
                    payload.log("Woreda response data " + correctWoredaLocations.length);

                    for (const woreda of correctWoredaLocations) {
                        payload.progress(60);
                        const facilityData = await mfrService.getOrganizationAffiliation(woreda.id);
                        const correctFacilityData = await processAndSendData(facilityData, woreda);
                        payload.log("Facility response data " + correctFacilityData.length);

                        for (const facility of correctFacilityData) {
                            payload.progress(70);
                            const facility2Data = await mfrService.getOrganizationAffiliation(facility.id);
                            const correctFacility2Data = await processAndSendData(facility2Data, facility);
                            payload.log("Facility 2 response data " + correctFacility2Data.length);
                        }
                    }
                }
            }
        }
        payload.log(`Sync completed for hierarchy facility for regions ${JSON.stringify(references.regions)}`);
        winston.info(`Sync completed for hierarchy facility for regions ${JSON.stringify(references.regions)}`);
        payload.progress(100);

        done();
    } catch (err) {
        done(err);
    }
});

module.exports.hierarchyQueue = hierarchyQueue;



// latestUpdatedQueue.process(async (payload, done) => {
//     try {
//         const lastDate = payload.data.lastDate;
//         let lastUpdate = lastDate.lastUpdate;
//         let sync = true;

//         while (sync) {
//             // console.log(`Facility sync started from date ${lastUpdate}`);
//             payload.progress(20);

//             const mfrService = new MFRService();
//             const mfrResponseData = await mfrService.getLatestUpdated(lastUpdate);
//             // console.log(mfrResponseData)
//             if (mfrResponseData !== undefined && mfrResponseData.entry !== undefined && mfrResponseData.entry.length > 0) {
//                 const mfrIds = mfrResponseData.entry.map(entry => entry.resource.id);
//                 console.log(mfrIds)
//                 const dhis2Service = new DHIS2Service();
//                 const dhis2Facilities = await dhis2Service.getFacilitiesByMfrIds(mfrIds);

//                 // payload.log("DHIS2 Facilities fetched: " + dhis2Facilities.length);
//                 payload.progress(40);

//                 for (const entry of mfrResponseData.entry) {
//                     const mfrFacility = entry.resource;
                    
//                     // Find DHIS2 facility matching MFR ID
//                     const dhis2Facility = dhis2Facilities.map(facility => 
//                         facility.attributeValues.some(attr => 
//                             attr.attribute.id === "Jc6iMhyGt6x" && attr.value === mfrFacility.id
//                         )
                    
//                     );
//                     // const lastUpdate = facility.lastUpdate.map(facility => 
//                     //     facility.attributeValues.some(attr => 
//                     //         attr.attribute.id === "JhrOESQAVor" && attr.value === mfrFacility.meta.lastUpdated
//                     //     ));
//                     // for (const facility of dhis2Facilities) {
//                     //     // console.log(facility.lastUpdated);
//                     //     if (facility){
//                     //         const mfrLastUpdated= new Date(mfrFacility.meta.lastUpdated);
//                     //         // console.log("facility:",facility)
//                     //         if(facility.attributeValues.length=== 0){
//                     //             console.log('attribute values is empty for: ',facility.id)
//                     //         }
//                     //         else{
//                     //         const dhis2LastUpdated = new Date(facility.attributeValues.mfrLastUpdated);
//                     //         // console.log(dhis2LastUpdated,':',mfrLastUpdated)
//                     //         if (Date(mfrLastUpdated) ==! Date(dhis2LastUpdated)) {
//                     //             console.log(`MFR lastUpdated (${mfrLastUpdated}) is more recent than DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
//                     //         }  else {
//                     //              console.log(`MFR lastUpdated (${mfrLastUpdated}) is equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
//                     //         }}}
//                     //      else {
//                     //          console.log(`Facility with MFR ID ${mfrFacility.id} not found in DHIS2.`);
//                     //     }}
                        
//                     for (const facility of dhis2Facility) {
//                         if (facility) {
//                             // Parse the lastUpdated date from the MFR facility
//                             const mfrLastUpdated = new Date(mfrFacility.meta.lastUpdated);
//                             console.log(facility);
                    
//                             // Check if attributeValues is not null or undefined
//                             if (facility.attributeValues) {
//                                 // Find the attribute value for mfrLastUpdated
//                                 const dhis2LastUpdatedAttr = facility.attributeValues.find(attr => attr.attribute.id === 'JhrOESQAVor');
                                
//                                 if (dhis2LastUpdatedAttr) {
//                                     // Parse the lastUpdated date from the DHIS2 facility
//                                     const dhis2LastUpdated = new Date(dhis2LastUpdatedAttr.value);
                    
//                                     // Compare the two dates
//                                     if (mfrLastUpdated.getTime() !== dhis2LastUpdated.getTime()) {
//                                         console.log(`MFR lastUpdated (${mfrLastUpdated}) is more recent than DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
//                                     } else {
//                                         console.log(`MFR lastUpdated (${mfrLastUpdated}) is equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
//                                     }
//                                 } else {
//                                     console.log('mfrLastUpdated attribute is missing for facility:', facility.id);
//                                 }
//                             } else {
//                                 console.log('attributeValues is missing for facility:', facility.id);
//                             }
//                         } else {
//                             console.log(`Facility with MFR ID ${mfrFacility.id} not found in DHIS2.`);


//                         }
//                     }
                    
                
//                 }
                    
                    
//                     // console.log(dhis2Facility.lastUpdated);
//                     // console.log(dhis2Facility);
//                     // if (dhis2Facility) {
//                     //     const mfrLastUpdated = new Date(mfrFacility.meta.lastUpdated);
                        
//                     //     const dhis2LastUpdated = new Date(dhis2Facility.lastUpdated);
//                     //     // for(const x of dhis2Facility){
//                     //     //     console.log(x.lastUpdated);
//                     //     // }
                        
                        
//                     //     if (mfrLastUpdated > dhis2LastUpdated) {
//                     //         console.log(`MFR lastUpdated (${mfrLastUpdated}) is more recent than DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
//                     //     } else if (mfrLastUpdated < dhis2LastUpdated) {
//                     //         console.log(`DHIS2 lastUpdated (${dhis2LastUpdated}) is more recent than MFR lastUpdated (${mfrLastUpdated}) for facility ${mfrFacility.id}`);
//                     //     } else {
//                     //         // console.log(`MFR lastUpdated (${mfrLastUpdated}) is equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
//                     //     }
//                     // } else {
//                     //     // console.log(`Facility with MFR ID ${mfrFacility.id} not found in DHIS2.`);
//                     // }
//                 }

//                 // Update lastUpdate with the latest timestamp
//                 // lastUpdate = mfrResponseData.entry[mfrResponseData.entry.length - 1].resource.meta.lastUpdated;
//                 // lastDate.lastUpdate = lastUpdate;

//                 // await _writeLastDateFile(lastDate);
//             // } else {
//             //      console.log(`No updates found after date ${lastDate.lastUpdate}`);
//             //     // await _writeLastDateFile(lastDate);
//             //     sync = false;
//             // }

//             // console.log(`Facility sync completed for updated facilities till ${lastUpdate}`);
//             // winston.info(`Facility sync completed for updated facilities till ${lastUpdate}`);
//             payload.progress(100);
//         }

//         done();
//     } catch (err) {
//         done(err);
//     }
// });


// module.exports.latestUpdatedQueue = latestUpdatedQueue;



// // Helper function to get facilities from DHIS2 using MFR IDs
// DHIS2Service.prototype.getFacilitiesByMfrIds = async function (mfrIds) {
//     try {
//         const response = await axios.get('http://localhost:8090/api/organisationUnits', {
//             params: {
//                 fields: 'name,id,attributeValues,lastUpdated',
//                 'filter[0]': 'attributeValues.attribute.id:eq:Jc6iMhyGt6x',
//                 'filter[1]': `attributeValues.value:in:[${mfrIds.join(',')}]`
//             },
//             auth: {
//                 username: 'admin',
//                 password: 'Dhis_1234'
//             }
//         });
//         // console.log("DHIS2 API Response:", response.data)
//         return response.data.organisationUnits;
//     } catch (error) {
//         winston.error(`Error fetching facilities from DHIS2: ${error.message}`);
//         throw error;
//     }
// };
latestUpdatedQueue.process(async (payload, done) => {
    try {
        const lastDate = payload.data.lastDate;
        let lastUpdate = lastDate.lastUpdate;
        let sync = true;

        while (sync) {
            payload.progress(20);

            const mfrService = new MFRService();
            const mfrResponseData = await mfrService.getLatestUpdated(lastUpdate);

            if (mfrResponseData && mfrResponseData.entry && mfrResponseData.entry.length > 0) {
                const mfrIds = mfrResponseData.entry.map(entry => entry.resource.id);
                const dhis2Service = new DHIS2Service();
                const dhis2Facilities = await dhis2Service.getFacilitiesByMfrIds(mfrIds);

                payload.progress(40);

                for (const entry of mfrResponseData.entry) {
                    const mfrFacility = entry.resource;

                    // Find DHIS2 facility matching MFR ID
                    const dhis2Facility = dhis2Facilities.find(facility => 
                        facility.attributeValues.some(attr => 
                            attr.attribute.id === "Jc6iMhyGt6x" && attr.value === mfrIds
                        )
                    );
                    // console.log(mfrIds);
                        // console.log(dhis2Facility);
                    if (dhis2Facility) {
                       
                        
                        const mfrLastUpdated = new Date(mfrFacility.meta.lastUpdated);
                        const attributeJhrOESQAVor = dhis2Facility.attributeValues.find(attr => attr.attribute.id === 'JhrOESQAVor');
                        const dhis2LastUpdated = attributeJhrOESQAVor;

                        if (mfrLastUpdated.getTime() === dhis2LastUpdated.getTime()) {
                            console.log(`MFR lastUpdated (${mfrLastUpdated}) is equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
                        } else {
                            console.log(`MFR lastUpdated (${mfrLastUpdated}) is not equal to DHIS2 lastUpdated (${dhis2LastUpdated}) for facility ${mfrFacility.id}`);
                        }

                    } else {
                        // console.log(`Facility with MFR ID ${mfrFacility.id} not found in DHIS2.`);
                        await dhis2Service.saveFacilityToDataStore(mfrFacility);
                    }
                }

                // Update lastUpdate with the latest timestamp from mfrResponseData
                lastUpdate = mfrResponseData.entry[mfrResponseData.entry.length - 1].resource.meta.lastUpdated;
                lastDate.lastUpdate = lastUpdate;

                // Write the updated last date to file (or wherever it needs to be saved)
                await _writeLastDateFile1(lastDate);

                payload.progress(100);
            } else {
                // No more entries found in mfrResponseData, so end the sync loop
                sync = false;
            }
        }

        // All processing done, call done() to signal completion
        done();
    } catch (err) {
        // Catch any errors during processing and call done(err) to handle them
        done(err);
    }
});

module.exports.latestUpdatedQueue = latestUpdatedQueue;

// Helper function to write the last date file
async function _writeLastDateFile1(lastDate) {
    const fs = require('fs').promises;
    try {
        await fs.writeFile('lastDate.json', JSON.stringify(lastDate));
    } catch (error) {
        winston.error(`Error writing last date file: ${error.message}`);
        throw error;
    }
}

// Helper function to get facilities from DHIS2 using MFR IDs
DHIS2Service.prototype.getFacilitiesByMfrIds = async function (mfrIds) {
    try {
        const response = await axios.get('http://localhost:8090/api/organisationUnits', {
            params: {
                fields: 'name,id,attributeValues,lastUpdated',
                'filter[0]': 'attributeValues.attribute.id:eq:Jc6iMhyGt6x',
                'filter[1]': `attributeValues.value:in:[${mfrIds.join(',')}]`
            },
            auth: {
                username: 'admin',
                password: 'Dhis_1234'
            }
        });
        return response.data.organisationUnits;
    } catch (error) {
        winston.error(`Error fetching facilities from DHIS2: ${error.message}`);
        throw error;
    }
};





webhookQueue.process(async (payload, done) => {
    syncSingleFacility(payload, done);
});
module.exports.webhookQueue = webhookQueue;

failedQueue.process(async (payload, done) => {
    syncSingleFacility(payload, done);
});
module.exports.failedQueue = failedQueue;

const createRoot = async (fmohLocationId) => {
    const mfrService = new MFRService();
    const fmohLocationData = await mfrService.getLocation(fmohLocationId);
    const dhisIdentifiers = fmohLocationData.identifier.find(identifier => identifier.type.coding[0].code === 'dhisId');
    const facilityIdentifier = fmohLocationData.identifier.find(identifier => identifier.type.coding[0].code === 'facilityId');

    const data = fmohLocationData.extension.find(extension => extension.url === "FacilityInformation");
    const yearOpened = data.extension.find(ex => ex.url === 'yearOpened');

    const fmohDHIS2Data = {
        dhisId: dhisIdentifiers.value,
        id: fmohLocationData.id,
        name: fmohLocationData.name,
        facilityId: facilityIdentifier.value,
        type: fmohLocationData.type[0].text,
        isPrimaryHealthCareUnit: false,
        yearOpened: yearOpened.valueDate,
    };

    const dhis2Service = new DHIS2Service();
    const rootOrg = await dhis2Service._getDHIS2OrgUnit(fmohDHIS2Data.dhisId);

    if (rootOrg.httpStatusCode && rootOrg.httpStatusCode == 404) {
        const response = await dhis2Service._sendDHIS2OrgUnit({
            "id": fmohDHIS2Data.dhisId,
            "name": fmohDHIS2Data.name,
            "shortName": fmohDHIS2Data.name,
            "code": fmohDHIS2Data.facilityId,
            "openingDate": fmohDHIS2Data.yearOpened,
            "attributeValues": [{
                "value": fmohDHIS2Data.type,
                "attribute": {
                    "id": "POvZKpgXXlg"
                }
            }],
        });
        return fmohDHIS2Data;
    }

    return fmohDHIS2Data;
};

const processAndSendData = async (mfrResponseData, parent, isRegion = false) => {
    if (mfrResponseData.entry) {
        const filteredLocations = [];
        for (const location of mfrResponseData.entry) {
            const loc = location.resource;
            const data = loc.extension.find(extension => extension.url === "FacilityInformation");

            const latitude = data.extension.find(ex => ex.url === 'latitude');
            const longitude = data.extension.find(ex => ex.url === 'longitude');

            const latitudeVal = latitude.valueDecimal;
            const longitudeVal = longitude.valueDecimal;

            const dhisIdentifiers = loc.identifier.find(identifier => identifier.type.coding[0].code === 'dhisId');
            const facilityIdentifier = loc.identifier.find(identifier => identifier.type.coding[0].code === 'facilityId');
            const type = loc.type[0].text;

            const dhis2Data = {
                "id": dhisIdentifiers.value,
                "parent": {
                    "id": parent.dhisId
                },
                "name": loc.name,
                "shortName": loc.name,
                "code": facilityIdentifier.value,
                "openingDate": "2000-01-01T00:00:00.000",
                "attributeValues": [{
                    "value": type,
                    "attribute": {
                        "id": "POvZKpgXXlg"
                    }
                }],
                "coordinates": `[${longitudeVal}, ${latitudeVal}]`,
                "featureType": "POINT"
            };

            const dhis2Service = new DHIS2Service();
            const orgUnit = await dhis2Service._getDHIS2OrgUnit(dhis2Data.id);

            if (orgUnit.httpStatusCode && orgUnit.httpStatusCode == 404) {
                await dhis2Service._sendDHIS2OrgUnit(dhis2Data);
            }
            filteredLocations.push({
                "id": loc.id,
                "dhisId": dhis2Data.id
            });
        }
        return filteredLocations;
    }
    return [];
};

const _writeLastDateFile = async (lastDate) => {
    try {
        await fs.writeFileSync(file, JSON.stringify(lastDate), "utf8");
        winston.info(`Updated last date`);
    } catch (err) {
        winston.error(`Failed to write last date to file: ${err.message}`);
    }
};

const syncSingleFacility = async (payload, done) => {
    try {
        const mfrId = payload.data.mfrId;
        const mfrService = new MFRService();
        const facility = await mfrService.getFacility(mfrId);

        const dhis2Service = new DHIS2Service();
        const dhis2OrgUnit = await dhis2Service.getOrgUnitByAttributeValue(mfrId);

        if (dhis2OrgUnit) {
            const dhis2LastUpdated = dhis2OrgUnit.attributeValues.find(attr => attr.attribute.id === "Jc6iMhyGt6x").value;
            if (dhis2LastUpdated === facility.meta.lastUpdated) {
                return done();
            }
        }

        const dhis2Objects = await mfrService.mFRtoDhis2ObjectConverter([facility]);
        if (dhis2Objects.length > 0) {
            const dhis2ResponseData = await dhis2Service.sendOrgUnit(dhis2Objects, payload);
            payload.log(`Facility sync to DHIS2: ${dhis2ResponseData.length}`);
            payload.progress(60);
        }

        done();
    } catch (err) {
        done(err);
    }
};
