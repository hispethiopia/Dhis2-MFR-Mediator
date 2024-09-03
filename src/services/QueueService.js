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
        const dhis2Service = new DHIS2Service();

        await mfrService.getLatestUpdated(lastUpdate, async (mfrResponseData) => {
            if (mfrResponseData?.entry?.length > 0) {
                payload.progress(40);

                for (const entry of mfrResponseData.entry) {
                    const mfrFacility = entry.resource;
                    const dhis2facility = await dhis2Service.getFacilityByMfrId(mfrFacility.id);
                    const lastUpdated = await dhis2Service.getMfrLastUpdated(mfrFacility.id);
                    const lastUpdatedDate = new Date(lastUpdated);
                    const mfrLastUpdatedDate = new Date(mfrFacility.meta.lastUpdated);

                    if (lastUpdatedDate.getTime() === mfrLastUpdatedDate.getTime()) {
                        payload.log(`MFR facility ${mfrFacility.id} lastUpdated is equal`);
                        continue;
                    }

                    if (!mfrFacility.operationalStatus?.display || mfrFacility.operationalStatus.display === "Duplicate") {
                        payload.log(`Facility ${mfrFacility.id} is duplicate or has no operational status`);
                        continue;
                    }

                    if (!mfrFacility.extension) continue;

                    if (dhis2facility.length > 0) {
                        const facilityId = mfrFacility.identifier.find(identifier =>
                            identifier.type.coding.some(coding => coding.code === 'facilityId')
                        )?.value;

                        const dhisId = mfrFacility.identifier.find(identifier =>
                            identifier.type.coding.some(coding => coding.code === 'dhisId')
                        )?.value;

                        let dhis = dhis2facility.find(dhis => dhis.code);
                        const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
                        if (dhis.code === facilityId && (dhis.id === dhisId || dhisId == null)) {
                            if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
                                const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
                                const isPHCU = await mfrService.isPhcu(hierarchyParts[0])
                                const ownership = mfrFacility.extension.find(ext => ext.url === "FacilityInformation")
                                        ?.extension.find(subExt => subExt.url === "ownership")?.valueString;

                                    const settlement = mfrFacility.extension.find(ext => ext.url === "FacilityInformation")
                                        ?.extension.find(subExt => subExt.url === "settlement")?.valueString;

                                    const MfrIsPhcu = mfrFacility.extension.find(ext => ext.url === "FacilityInformation")
                                        ?.extension.find(subExt => subExt.url === "isPrimaryHealthCareUnit")?.valueBoolean;

                                    const ft = mfrFacility.type.find(type => type.coding.some(coding => coding.code === "FT"))?.text;

                                    const yearOpened = mfrFacility.extension.find(ext => ext.url === "FacilityInformation")
                                        ?.extension.find(subExt => subExt.url === "yearOpened")?.valueDate;
                                    const openingDate = new Date(yearOpened);
                                    if(isPHCU === false){
                                    let mfrParent = hierarchyParts[1];
                                    const dhisMfrIsPchu = dhis.attributeValues.find(attr => attr.attribute.id === process.env.MFR_isPHCU)?.value;
                                    const dhisOwnership = dhis.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_OWNERSHIP)?.value;
                                    const dhisSettlement = dhis.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_SETTLEMENT)?.value;
                                    const dhisFt = dhis.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_FT)?.value;
                                    const dhisOperationalStatus = dhis.attributeValues.find(attr => attr.attribute.id === process.env.MFR_OperationalStatus)?.value;
                                    const dhisParentId = await dhis2Service.getMfrId(dhis.parent.id);
                                    
                                    if ( ownership !== dhisOwnership || settlement !== dhisSettlement || ft !== dhisFt || dhisMfrIsPchu !== MfrIsPhcu || mfrFacility.operationalStatus.display !== dhisOperationalStatus) {
                                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                                    }
                                    else{
                                        if(mfrParent === dhisParentId || `${mfrParent}_PHCU` === dhisParentId ){
                                            const updatedFacility = {
                                                            name: mfrFacility.name,
                                                            code: dhis.code,
                                                            shortName: dhis.shortName,
                                                            openingDate: openingDate,
                                                            attributeValues: dhis.attributeValues.map(attr => {
                                                                if (attr.attribute.id === process.env.MFR_LastUpdated) {
                                                                    return { ...attr, value: mfrLastUpdatedDate };
                                                                }
                                                                return attr;
                                                            }),
                                                        };
                                                         if((dhis.geometry && dhis.geometry.type === 'Point') || dhis.geometry === null){
                                                            updatedFacility.geometry = {
                                                                type: "Point",
                                                                coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                                                            };
                                                        }
                
                                                        await dhis2Service.updateFacility(dhis.id, updatedFacility, payload);  
                                        } else {
                                            await handleReportingHierarchy(mfrFacility, mfrService, entry, payload)
                                            await dhis2Service.saveFacilityToDataStore(entry, payload);
                                        }
                                    }
                                }
                                else if(isPHCU === true){
                                    const phcufacility = await dhis2Service.getFacilityByMfrId(`${mfrFacility.id}_PHCU`)
                                    const hc_pchu = phcufacility.find(dhis=>dhis.code);
                                    const dhisMfrIsPchu = hc_pchu.attributeValues.find(attr => attr.attribute.id === process.env.MFR_isPHCU)?.value;
                                    const dhisOwnership = hc_pchu.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_OWNERSHIP)?.value;
                                    const dhisSettlement = hc_pchu.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_SETTLEMENT)?.value;
                                    const dhisFt = hc_pchu.attributeValues.find(attr => attr.attribute.id === process.env.DHIS2_FT)?.value;
                                    const dhisOperationalStatus = hc_pchu.attributeValues.find(attr => attr.attribute.id === process.env.MFR_OperationalStatus)?.value;
                                    if ( ownership !== dhisOwnership || settlement !== dhisSettlement || ft !== dhisFt || dhisMfrIsPchu !== MfrIsPhcu || mfrFacility.operationalStatus.display !== dhisOperationalStatus) {
                                        await handleReportingHierarchy(mfrFacility, mfrService, entry, payload)
                                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                                    }
                                    const parent = hc_pchu.parent.id;
                                    const parentId = await dhis2Service.getMfrId(parent);
                                    if(parentId === hierarchyParts[1]){
                                        const updatedFacility = {
                                            name: mfrFacility.name,
                                            code: dhis.code,
                                            shortName: dhis.shortName,
                                            openingDate: openingDate,
                                            attributeValues: dhis.attributeValues.map(attr => {
                                                if (attr.attribute.id === process.env.MFR_LastUpdated) {
                                                    return { ...attr, value: mfrLastUpdatedDate };
                                                }
                                                return attr;
                                            }),
                                        };
                                         if((dhis.geometry && dhis.geometry.type === 'Point') || dhis.geometry === null){
                                            updatedFacility.geometry = {
                                                type: "Point",
                                                coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                                            };
                                        }
                                        const updated_pchu = {
                                            name: mfrFacility.name,
                                            code: hc_pchu.code,
                                            shortName: hc_pchu.shortName,
                                            openingDate: openingDate,
                                            attributeValues: hc_pchu.attributeValues.map(attr => {
                                                if (attr.attribute.id === process.env.MFR_LastUpdated) {
                                                    return { ...attr, value: mfrLastUpdatedDate };
                                                }
                                                return attr;
                                            }),
                                        }
                                        if((hc_pchu.geometry && hc_pchu.geometry.type === 'Point') || hc_pchu.geometry === null){
                                            updated_pchu.geometry = {
                                                type: "Point",
                                                coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                                            };
                                        }
                                        await dhis2Service.updateFacility(dhis.id, updatedFacility, payload);
                                        await dhis2Service.updateFacility(hc_pchu.id, updated_pchu, payload);

                                    }else{
                                        await handleReportingHierarchy(mfrFacility, mfrService, entry, payload)
                                        await dhis2Service.saveFacilityToDataStore(entry, payload);

                                    }
                                }
                            }
                        } else {
                            await handleReportingHierarchy(mfrFacility, mfrService, entry, payload)
                            await dhis2Service.saveFacilityToDataStore(entry, payload);
                        }
                    } else {
                        await handleReportingHierarchy(mfrFacility, mfrService, entry, payload)
                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                    }
                }

                payload.progress(100);
            } else {
                sync = false;
            }
        });

        done();
    } catch (err) {
        done(err);
    }
});
module.exports.latestUpdatedQueue = latestUpdatedQueue;

async function handleReportingHierarchy(mfrFacility, mfrService, entry, payload) {
    const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
    if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
        const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
        entry.isParentPHCU = false;
        if (hierarchyParts.length > 1) {
            const parentFacilityId = hierarchyParts[1];
            const isPHCU = await mfrService.isPhcu(parentFacilityId);
            entry.isParentPHCU = isPHCU;

            if (isPHCU) {
                payload.log(`Parent facility ${parentFacilityId} of facility ${mfrFacility.id} is a PHCU.`);
            }
        }
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
