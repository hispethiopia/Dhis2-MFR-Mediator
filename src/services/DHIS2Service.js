require('dotenv').config();
const request = require('requestretry');
const winston = require('winston');
const MFRService = require('./MFRService.js');
const queue = require('./QueueService.js');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { remapMfrToDhis } = require('../utils/utils');
const { response } = require('express');

axiosRetry(axios, {
  retries: 10, 
  retryDelay: (retryCount) => {
    return retryCount * 5000; 
  },
  retryCondition: (error) => {
    return error.response?.status >= 500 || error.code === 'ECONNABORTED';
  },
});

class DHIS2Service {
  
  async sendSingleOrgUnit(dhis2Object, updateIfExist = false) {
    winston.info('Processing DHIS2 Object', { name: dhis2Object.name, reportsTo: dhis2Object.reportsTo.name });

    let locationOrg = await this._getDHIS2OrgUnit(dhis2Object.dhisId);

    if (!locationOrg) {
      locationOrg = await this._findOrgUnitByCode(dhis2Object.facilityId);
    }

    if (!locationOrg) {
      let orgUnitId = await this._getFacilityParent(dhis2Object);

      if (!orgUnitId) {
        winston.info('No orgunit found for location', { facilityId: dhis2Object.facilityId });
        return;
      }

      if (dhis2Object.isPrimaryHealthCareUnit && !this._isOfficeOrZonalHealthDept(dhis2Object.type)) {
        const phcuResponse = await this._createPHCU(dhis2Object, orgUnitId);
        if (phcuResponse) {
          orgUnitId = phcuResponse.response.uid;
        }
      }

      const createResponse = await this._createOrgUnit(dhis2Object, orgUnitId);
      if (createResponse) {
        winston.info('Created new Org Unit', { orgUnitId: createResponse.response.uid });
        return {
          orgUnitId: createResponse.response.uid,
          parentOrgUnitId: orgUnitId,
          ...dhis2Object,
        };
      }
    } else if (updateIfExist) {
      const updateResponse = await this._updateExistingOrgUnit(dhis2Object, locationOrg);
      if (updateResponse) {
        winston.info('Updated existing Org Unit', { orgUnitId: updateResponse.orgUnitId });
      }
      return updateResponse;
    }
    return {
      orgUnitId: locationOrg.id,
      ...dhis2Object,
    };
  }
  ispchu = async function (dhisId) {
    try {
        const filter = `attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`
        const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits/${dhisId}?fields=attributeValues&${filter}`;
  
        const response = await axios.get(dhisUrl, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
            }
        });
  
          const organisationUnit = response.data;
  
        if (organisationUnit) {
          const attributeId = process.env.MFR_isPHCU;
            const attribute = organisationUnit.attributeValues.find(attr => attr.attribute.id === attributeId);
            if (attribute) {
                return attribute.value;
            }
        }
  
        return null; 
  
    } catch (error) {
        winston.error(`Error fetching isPhcu from DHIS2: ${error.message}`);
        throw error;
    }
  }
  
  getFacilitiesByMfrIds = async function (mfrIds) {
    try {
        const filters = [
            `attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`,
            `attributeValues.value:in:[${mfrIds.join(',')}]`
        ];
  
        const queryParams = filters.map(filter => `filter=${encodeURIComponent(filter)}`).join('&');
        const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits?fields=code,name,id,attributeValues,lastUpdated&${queryParams}`;
        
  
        const response = await axios.get(dhisUrl, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
            },
            
        });
  
        return response.data.organisationUnits;
    } catch (error) {
        winston.error(`Error fetching facilities from DHIS2: ${error.message}`);
        throw error;
    }
  };
  
  getFacilityByMfrId = async function (mfrId) {
    try {
        const filters = [
            `attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`,
            `attributeValues.value:eq:${mfrId}`
        ];
  
        const queryParams = filters.map(filter => `filter=${encodeURIComponent(filter)}`).join('&');
        const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits?fields=path,geometry,code,name,shortName,openingDate,id,attributeValues,lastUpdated,parent%5B*%5D&${queryParams}`;
        
  
        const response = await axios.get(dhisUrl, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
            },
        });
  
        return response.data.organisationUnits;
    } catch (error) {
        winston.error(`Error fetching facility from DHIS2: ${error.message}`);
        throw error;
    }
  };
  getMfrId = async function (dhisId){
    try{
      const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits/${dhisId}?fields=attributeValues`;
      const response = await axios.get(dhisUrl, {
        headers: {
            'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
        },
      
       
    }); 
    const mfrIdObject = response.data.attributeValues.find(
      a => a.attribute.id === `${process.env.DHIS2_ATTRIBUTE_ID}`
    );
    const mfrId = mfrIdObject ? mfrIdObject.value : null;
    return mfrId;
    }catch (error) {
        winston.error(`Error fetching Mfr id from DHIS2: ${error.message}`);
        throw error;
    }
  }

  updateFacility = async function (dhisId, updatedFacility,payload) {
    try {
      const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits/${dhisId}`;
      
      const response = await axios.put(dhisUrl, updatedFacility, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      });
  
      if (response.status !== 200) {
        throw new Error(`Failed to update facility in DHIS2. Status: ${response.status}`);
      }
      payload.log('Facility '+updatedFacility.name+ ' directly updated ')
      return response.data; 
    } catch (error) {
      winston.error(`Error updating facility with ID ${dhisId} in DHIS2: ${error.message}`);
      throw error;
    }
  };
  
  getMfrLastUpdated = async function (mfrId) {
    try {
        const filters = [
            `attributeValues.attribute.id:eq:${process.env.DHIS2_ATTRIBUTE_ID}`,
            `attributeValues.value:eq:${mfrId}`
        ];
  
        const queryParams = filters.map(filter => `filter=${encodeURIComponent(filter)}`).join('&');
        const dhisUrl = `${process.env.DHIS2_HOST}/organisationUnits?fields=attributeValues&${queryParams}`;
  
        const response = await axios.get(dhisUrl, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${process.env.DHIS2_USER}:${process.env.DHIS2_PASSWORD}`).toString('base64')}`
            },
          
        });
  
        const organisationUnit = response.data.organisationUnits[0];
  
        if (organisationUnit) {
          const attributeId = process.env.MFR_LastUpdated;
            const attribute = organisationUnit.attributeValues.find(attr => attr.attribute.id === attributeId);
            if (attribute) {
                return attribute.value;
            }
        }
  
        return null;
  
    } catch (error) {
        winston.error(`Error fetching facility from DHIS2: ${error.message}`);
        throw error;
    }
  }

  saveFacilityToDataStore = async function (mfrFacility,payload) {
    let dataStoreValue = null;
    try {
      dataStoreValue = await axios.get(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, {
        auth: {
          username: process.env.DHIS2_USER,
          password: process.env.DHIS2_PASSWORD
        }
      });
    } catch (e) {
      // Do nothing 
    }
  
    const remappedFacility = remapMfrToDhis(mfrFacility);
    
    try {
      
      if (dataStoreValue && dataStoreValue.data["resource_meta_lastUpdated"] === mfrFacility.resource.meta.lastUpdated) {
        payload.log(`Facility with MFR ID ${mfrFacility.resource.id} already exists in the datastore. No update needed`)
      } else if (dataStoreValue) {
        await axios.put(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
          auth: {
            username: process.env.DHIS2_USER,
            password: process.env.DHIS2_PASSWORD
          }
        });
        payload.log(`Facility with MFR ID ${mfrFacility.resource.id} updated in the datastore.`)
      } else {
        await axios.post(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
          auth: {
            username: process.env.DHIS2_USER,
            password: process.env.DHIS2_PASSWORD
          }
        });
        payload.log(`Facility with MFR ID ${mfrFacility.resource.id} created in the datastore.`);
      }
    } catch (error) {
      payload.log(`Error saving facility ${mfrFacility.resource.id} to datastore: ${error.message}`);
    }
  };
}

module.exports = DHIS2Service;
