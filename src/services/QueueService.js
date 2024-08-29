const Bull = require("bull");
// const winston = require('winston');
// const axios = require('axios');
const MFRService = require('./MFRService.js');
const DHIS2Service = require('./DHIS2Service.js');
// const fs = require('fs');
// const { Console } = require("console");
// const file = './src/utils/lastDate.json';



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

        payload.log(`Getting updated list of facilities from MFR since ${lastUpdate}`);

        const mfrService = new MFRService();

        await mfrService.getLatestUpdated(lastUpdate, async (mfrResponseData) => {
            if (mfrResponseData && mfrResponseData.entry && mfrResponseData.entry.length > 0) {
                const dhis2Service = new DHIS2Service();
                payload.progress(40);

                for (const entry of mfrResponseData.entry) {
                    const mfrFacility = entry.resource;
                    const dhis2facility= await dhis2Service.getFacilityByMfrId(mfrFacility.id)
                    const lastUpdated = await dhis2Service.getMfrLastUpdated(mfrFacility.id);
                    const lastUpdatedDate = new Date(lastUpdated);
                    const mfrLastUpdatedDate = new Date(mfrFacility.meta.lastUpdated);
                    if (lastUpdatedDate.getTime() === mfrLastUpdatedDate.getTime()) {
                            payload.log("Mfr facility " + mfrFacility.id + " lastUpdated is equal");
                            continue;
                        }
                    if(mfrFacility.operationalStatus?.display === undefined || mfrFacility.operationalStatus?.display === "Duplicate"){
                            payload.log(`Facility ${mfrFacility.id} duplicate or have no operational status`)
                    }
                   else { 
                    if (mfrFacility.extension === undefined) continue;
                    if(dhis2facility.length > 0){
                        
                    const facilityId = mfrFacility.identifier.find(identifier => 
                        identifier.type.coding.some(coding => coding.code === 'facilityId')
                      ).value;
                    const dhisId = mfrFacility.identifier.find(identifier => 
                        identifier.type.coding.some(coding => coding.code === 'dhisId')
                      ).value;
                      
                      const dhis = dhis2facility.find(dhis =>dhis.code)
        
                    if (dhis.code === facilityId && (dhis.id === dhisId || dhisId == null)) {
                        const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
                            if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
                                const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
                                if (hierarchyParts.length > 1) {
                                    const parentFacilityId = hierarchyParts[1];
                                    const dhisParentId = await dhis2Service.getMfrId(dhis.id)
                                    const isPHCU = await mfrService.isPhcu(parentFacilityId);
                                    entry.isParentPHCU = isPHCU;
                                    if(parentFacilityId ===  dhisParentId || isPHCU === true){
                                        console.log(parentFacilityId,":",dhisParentId)
                                        const ownership = mfrFacility.extension.find(ext => ext.url === "FacilityInformation")
                                            ?.extension.find(subExt => subExt.url === "ownership")?.valueString;

                                        const settlement = mfrFacility.extension.find(ext => ext.url === "FacilityInformation")
                                            ?.extension.find(subExt => subExt.url === "settlement")?.valueString;

                                        const ft = mfrFacility.type.find(type => type.coding.some(coding => coding.code === "FT"))?.text;
                                        console.log()
                                        const dhisOwnership = dhis.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_OWNERSHIP)?.value;
                                        const dhisSettlement = dhis.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_SETTLEMENT)?.value;
                                        const dhisFt = dhis.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_FT)?.value;
                                        updateRequired =false;
                                        if(mfrFacility.name !== dhis.name){
                                            dhis.name=mfrFacility.name;
                                            updateRequired = true;
                                        }
                                        if (ownership !== dhisOwnership){
                                            dhisOwnership = ownership;
                                            updateRequired = true;
                                        }
                                        if (settlement !== dhisSettlement){
                                            dhisSettlement = settlement;
                                            updateRequired = true;
                                        } 
                                        if (ft !== dhisFt){
                                            dhisFt = ft;
                                            updateRequired = true;
                                        }
                                        if(dhis.geometry){
                                            if (dhis.geometry.type === 'Point' && (dhis.geometry.coordinates[0] !== mfrFacility.position.longitude || dhis.geometry.coordinates[1] !== mfrFacility.position.latitude) ){
                                                dhis.geometry.coordinates[0] = mfrFacility.position.longitude;
                                                dhis.geometry.coordinates[1] = mfrFacility.position.latitude;
                                                updateRequired = true;
                                            }
                                        }else if(dhis.geometry === null){
                                            updateRequired = true;
                                        }
                                        
                                        if (updateRequired) {
                                            
                                            const updatedFacility = {
                                                name: dhis.name,
                                                code: dhis.code,
                                                shortName:dhis.shortName,
                                                openingDate : dhis.openingDate,
                                                attributeValues: dhis.attributeValues.map(attr => {
                                                    if (attr.attribute.id === 'rN5rM32rGn2') {
                                                        return { ...attr, value: dhisOwnership };
                                                    } else if (attr.attribute.id === 'PPqNjqpFoRn') {
                                                        return { ...attr, value: dhisSettlement };
                                                    } else if (attr.attribute.id === 'jfNsdZwddzD') {
                                                        return { ...attr, value: dhisFt };
                                                    }
                                                    return attr;
                                                }),
                                                geometry: {
                                                    type: "Point",
                                                    coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                                                }
                                            };

                                            
                                            await dhis2Service.updateFacility(dhis.id, updatedFacility);
                                        } else {
                                            await dhis2Service.saveFacilityToDataStore(entry, payload);
                                        }
                                        

                                    }else{

                                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                                    }
                                   
    
                                    
                                }
                            }

                    } else {
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
                    }
                  
                } else{
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
            } 
                    }else {
                        sync = false;
                    }
                    
        });

        done();
    } catch (err) {
        done(err);
    }
});


module.exports.latestUpdatedQueue = latestUpdatedQueue;





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
        if(facility.resource.operationalStatus?.display === undefined || facility.resource.operationalStatus?.display === "Duplicate"){
            throw Error(`Facility ${id} duplicate or have no operational status`)
        }
        if (dhis2OrgUnit.length !== 0) {
            await dhis2Service.saveFacilityToDataStore(facility,payload);
            payload.log("Mfr facility mapped for DHIS2 facility: " + facility.resource.name);
       } else {
            payload.log("Facility not found in DHIS2, creating new entry: " + facility.resource.name);
            await dhis2Service.saveFacilityToDataStore(facility,payload);
           }

            done();
          
        }
        catch (err) {
        done(err);
    }
};
