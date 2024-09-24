const Bull = require("bull");
// const winston = require('winston');
// const axios = require('axios');
const MFRService = require('./MFRService.js');
const DHIS2Service = require('./DHIS2Service.js');

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

processFacility = async function (mfrFacility, dhis2facility, dhis2Service, payload, entry) {
        try{
            const lastUpdated = mfrFacility.meta.lastUpdated;
            const lastUpdatedDate = new Date(lastUpdated);
            const facilityId = mfrFacility.identifier.find(identifier =>
            identifier.type.coding.some(coding => coding.code === 'facilityId')
            )?.value?? null;
            const dhis = dhis2facility.find(dhis => dhis.code)??null;
         
            if (!dhis) {
                await dhis2Service.saveFacilityToDataStore(entry, payload);
                return;
            }
            const dhisId = mfrFacility.identifier.find(identifier =>
                identifier.type.coding.some(coding => coding.code === 'dhisId')
            )?.value?? null;
            if (dhis.code !== facilityId || (dhisId && dhisId !== dhis.id)) {
                await dhis2Service.saveFacilityToDataStore(entry, payload);
                return;
            }
    
        const reportingHierarchyExtension = mfrFacility.extension.find(ext => ext.url === 'reportingHierarchyId');
        if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
            const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
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
            if (MfrIsPhcu === false) {
                const dhisMfrIsPchu = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.MFR_isPHCU)?.value||null;
                const dhisOwnership = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_OWNERSHIP)?.value||null;
                const dhisSettlement = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_SETTLEMENT)?.value||null;
                const dhisFt = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_FT)?.value||null;
                const dhisOperationalStatus = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.MFR_OperationalStatus)?.value||null;
                if (dhis.parent && dhis.parent.attributeValues && dhis.parent.attributeValues.length > 0) {
                    const dhisParentId = dhis.parent.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_ATTRIBUTE_ID)?.value||null;
                    if (
                        String(ownership).trim() !== String(dhisOwnership).trim() || 
                        String(settlement).trim() !== String(dhisSettlement).trim() || 
                        String(ft).trim() !== String(dhisFt).trim() || 
                        String(dhisMfrIsPchu) !== String(MfrIsPhcu) || 
                        mfrFacility.operationalStatus.display.trim() !== String(dhisOperationalStatus).trim()
                    ) {
                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                    }
                    else if (hierarchyParts[1] === dhisParentId || `${hierarchyParts[1]}_PHCU` === dhisParentId) {
                        const updatedFacility = {
                            name: mfrFacility.name,
                            code: dhis.code,
                            shortName: dhis.shortName,
                            openingDate: openingDate,
                            parent: {
                                id: dhis.parent ? dhis.parent.id : null, 
                            },
                            attributeValues: dhis.attributeValues.map(attr => {
                                if (attr.attribute.id === process.env.MFR_LastUpdated) {
                                    return { ...attr, value: lastUpdatedDate };
                                }
                                return attr;
                            }),

                        };
                        if ((dhis.geometry && dhis.geometry.type === 'Point') || dhis.geometry === null) {
                            updatedFacility.geometry = {
                                type: "Point",
                                coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                            };
                        }
                        await dhis2Service.updateFacility(dhis.id, updatedFacility, payload);
                    } else {
                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                    }
                } else {
                    await dhis2Service.saveFacilityToDataStore(entry, payload);
                }
            } else if (MfrIsPhcu === true) {
                const phcufacility = await dhis2Service.getFacilityByMfrId(`${mfrFacility.id}_PHCU`);
                if (phcufacility) {
                      const hc_pchu = phcufacility.find(dhis => dhis.code) ?? null;
                      if (!hc_pchu) {
                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                        return;
                    }
                    const dhisMfrIsPchu = hc_pchu.attributeValues?.find(attr => attr.attribute.id === process.env.MFR_isPHCU)?.value||null;
                    const dhisOwnership = hc_pchu.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_OWNERSHIP)?.value||null;
                    const dhisSettlement = hc_pchu.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_SETTLEMENT)?.value||null;
                    const dhisFt = hc_pchu.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_FT)?.value||null;
                    const dhisOperationalStatus = hc_pchu.attributeValues?.find(attr => attr.attribute.id === process.env.MFR_OperationalStatus)?.value||null;
                    if (hc_pchu.parent && hc_pchu.parent.attributeValues && hc_pchu.parent.attributeValues.length > 0) {
                        const parentId = hc_pchu.parent.attributeValues?.find(attr => attr.attribute.id === process.env.DHIS2_ATTRIBUTE_ID)?.value||null;
                        if (
                            String(ownership).trim() !== String(dhisOwnership).trim() || 
                            String(settlement).trim() !== String(dhisSettlement).trim() || 
                            String(ft).trim() !== String(dhisFt).trim() || 
                            String(dhisMfrIsPchu) !== String(MfrIsPhcu) || 
                            mfrFacility.operationalStatus.display.trim() !== String(dhisOperationalStatus).trim()
                        ) {
                            await dhis2Service.saveFacilityToDataStore(entry, payload);
                        }
                        else if (parentId === hierarchyParts[1]) {
                            const updatedFacility = {
                                name: mfrFacility.name,
                                code: dhis.code,
                                shortName: dhis.shortName,
                                openingDate: openingDate,
                                parent: {
                                    id: dhis.parent ? dhis.parent.id : null,
                                },
                                attributeValues: dhis.attributeValues.map(attr => {
                                    if (attr.attribute.id === process.env.MFR_LastUpdated) {
                                        return { ...attr, value: lastUpdatedDate };
                                    }
                                    return attr;
                                }),
                            };
                            if ((dhis.geometry && dhis.geometry.type === 'Point') || dhis.geometry === null) {
                                updatedFacility.geometry = {
                                    type: "Point",
                                    coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                                };
                            }
                            const updated_pchu = {
                                name: mfrFacility.name.replace(/(Health center|Primary Clinic)$/ig, '')
                                    .trim() + '_PHCU',
                                code: hc_pchu.code,
                                shortName: hc_pchu.shortName,
                                openingDate: openingDate,
                                parent: {
                                    id: hc_pchu.parent ? hc_pchu.parent.id :null,
                                },
                                attributeValues: hc_pchu.attributeValues.map(attr => {
                                    if (attr.attribute.id === process.env.MFR_LastUpdated) {
                                        return { ...attr, value: lastUpdatedDate };
                                    }
                                    return attr;
                                }),
                            };
                            if ((hc_pchu.geometry && hc_pchu.geometry.type === 'Point') || hc_pchu.geometry === null) {
                                updated_pchu.geometry = {
                                    type: "Point",
                                    coordinates: [mfrFacility.position.longitude, mfrFacility.position.latitude]
                                };
                            }
                            await dhis2Service.updateFacility(dhis.id, updatedFacility, payload);
                            await dhis2Service.updateFacility(hc_pchu.id, updated_pchu, payload);
                        }
                    } else {
                        await dhis2Service.saveFacilityToDataStore(entry, payload);
                    }
                }
            }
        } 
        }
        
        catch (err) {
            throw err;
        }
    };
latestUpdatedQueue.process(async (payload, done) => {
        try {
            let lastDate = new Date();
            const DAYS_TO_SUBTRACT = process.env.DAYS_TO_SUBTRACT || 90;
            lastDate.setDate(new Date().getDate() - DAYS_TO_SUBTRACT);
            let lastUpdate = lastDate.toISOString();
    
            payload.log(`Getting updated list of facilities from MFR since ${lastUpdate}`);
    
            const mfrService = new MFRService();
            const dhis2Service = new DHIS2Service();
    
            await mfrService.getLatestUpdated(lastUpdate, payload, async (mfrResponseData) => {
                if (mfrResponseData?.entry?.length > 0) {
                    payload.progress(40);
    
                    for (const entry of mfrResponseData.entry) {
                        const mfrFacility = entry.resource;
                        const dhis2facility = await dhis2Service.getFacilityByMfrId(mfrFacility.id);
                        if (!mfrFacility.extension) continue;
                        if (dhis2facility.length > 0) {
                            const dhis = dhis2facility.find(dhis => dhis.code);
                            const lastUpdated = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.MFR_LastUpdated)?.value|| null;
                            const lastUpdatedDate = new Date(lastUpdated);
                            const mfrLastUpdatedDate = new Date(mfrFacility.meta.lastUpdated);
                            if (!isNaN(lastUpdatedDate.getTime()) && !isNaN(mfrLastUpdatedDate.getTime())) {
                                if (lastUpdatedDate.getTime() === mfrLastUpdatedDate.getTime()) {
                                    payload.log(`MFR facility ${mfrFacility.id} lastUpdated is equal`);
                                    continue;
                                }
                            }
                            if (!mfrFacility.operationalStatus?.display || mfrFacility.operationalStatus.display === "Duplicate") {
                                payload.log(`Facility ${mfrFacility.id} is duplicate or has no operational status`);
                                continue;
                            }
                             await handleReportingHierarchy(mfrFacility,mfrService,entry,payload)
                             await processFacility(mfrFacility, dhis2facility, dhis2Service, payload, entry);
                        }else {
                            await handleReportingHierarchy(mfrFacility,mfrService,entry,payload)
                            await dhis2Service.saveFacilityToDataStore(entry, payload);
                        }
    
                    payload.progress(100);
                } 
            }});
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
        if(dhis2OrgUnit.length === 0){
            payload.log("Facility not found in DHIS2, creating new entry: " + facility.resource.name);
            await dhis2Service.saveFacilityToDataStore(facility,payload);
            done();
        } else{
            const dhis= dhis2OrgUnit?.find(dhis=>dhis.code|| null)
            const lastUpdated = dhis.attributeValues?.find(attr => attr.attribute.id === process.env.MFR_LastUpdated )?.value|| null;
            const facilityLastUpdatedDate = new Date(facility.resource.meta.lastUpdated);
            const lastUpdatedDate = new Date(lastUpdated);
            if (facilityLastUpdatedDate.getTime() === lastUpdatedDate.getTime()) {
                payload.log("Mfr facility "+facility.resource.id+" lastUpdated is equal");
                done()
                return
            }
            if(facility.resource.operationalStatus?.display === undefined || facility.resource.operationalStatus?.display === "Duplicate"){
                payload.log(`Facility ${id} duplicate or have no operational status`)
                done()
                return
            }
            payload.log("Mfr facility mapped for DHIS2 facility: " + facility.resource.name);
            await processFacility(facility.resource, dhis2OrgUnit, dhis2Service, payload, facility);
            done()
        }
    }
    catch (err) {
        done(err);
    }
};