require('dotenv').config();
const request = require('requestretry');
const winston = require('winston');
const MFRService = require('./MFRService');
const references = require('../utils/references');
const queue = require('./QueueService');
const axios = require('axios');
const { remapMfrToDhis } = require('../utils/utils');
const options = {
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  auth: {
    username: process.env.DHIS2_USER,
    password: process.env.DHIS2_PASSWORD,
  },
  json: true,
  maxAttempts: 10,
  retryDelay: 5000,
  retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
};

class DHIS2Service {
  sendSingleOrgUnit = async (dhis2Object, updateIfExist = false) => {
    winston.info('Processing DHIS2 Object', { name: dhis2Object.name, reportsTo: dhis2Object.reportsTo.name });
    console.log(dhis2Object.name)
    let locationOrg = await this._getDHIS2OrgUnit(dhis2Object.dhisId);

    if (!locationOrg) {
      locationOrg = await this._findOrgUnitByCode(dhis2Object.facilityId);
    }

    if (!locationOrg) {
      const orgUnitId = await this._getFacilityParent(dhis2Object);

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
    } else {
      if (updateIfExist) {
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
  };

  sendOrgUnit = async (dhis2Objects, payload = null) => {
    const failedQueue = queue.failedQueue;
    const responseBody = [];

    winston.info('Preparing facilities to send to DHIS2', { count: dhis2Objects.length });

    for (const dhis2Object of dhis2Objects) {
      if (payload != null) payload.log(`Sending facility ${dhis2Object.name} - ${dhis2Object.id} to DHIS2`);

      const response = await this.sendSingleOrgUnit(dhis2Object, true);

      if (!response) {
        winston.error('Failed to send facility', { id: dhis2Object.id });
        failedQueue.add({ id: dhis2Object.id });
      } else {
        winston.info('Successfully sent facility', { id: dhis2Object.id });
        responseBody.push(response);
      }
    }

    return responseBody;
  };

 



//   saveFacilityToDataStore = async function (mfrFacility) {
//     let dataStoreValue = null;
//     try {
//       dataStoreValue = await axios.get(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, {
//         auth: {
//           username: process.env.DHIS2_USER,
//           password: process.env.DHIS2_PASSWORD
//         }
//         });
//     } catch (e) {
//         // Do nothing 
//     }
//     try {
//         // console.log(Object.keys(dataStoreValue.data))
//         if (dataStoreValue && dataStoreValue.data["resource.meta.lastUpdated"] === mfrFacility.resource.meta.lastUpdated) {
//             console.log(`Facility with MFR ID ${mfrFacility.resource.id} already exists in the datastore. No update needed`);
//         } else if (dataStoreValue) {
//           await axios.put(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remapMfrToDhis(mfrFacility), {
//             auth: {
//               username: process.env.DHIS2_USER,
//               password: process.env.DHIS2_PASSWORD
//             }
//             });
//             console.log(`Facility with MFR ID ${mfrFacility.resource.id} updated in the datastore.`);
//         } else {
//           await axios.post(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remapMfrToDhis(mfrFacility), {
//             auth: {
//               username: process.env.DHIS2_USER,
//               password: process.env.DHIS2_PASSWORD
//             }
//             });
//             console.log(`Facility with MFR ID ${mfrFacility.resource.id} created in the datastore.`);
//         }
//     } catch (error) {
//         winston.error(`Error saving facility ${mfrFacility.resource.id} to datastore: ${error.message}`);
//     }
// };


//  saveFacilityToDataStore = async function (mfrFacility) {
//   let dataStoreValue = null;
//   try {
//     dataStoreValue = await axios.get(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, {
//       auth: {
//         username: process.env.DHIS2_USER,
//         password: process.env.DHIS2_PASSWORD
//       }
//     });
//   } catch (e) {
//     // Do nothing 
//   }

//   const remappedFacility = remapMfrToDhis(mfrFacility);
  
//   try {
//     if (dataStoreValue && dataStoreValue.data["resource.meta.lastUpdated"] === mfrFacility.resource.meta.lastUpdated) {
//       console.log(`Facility with MFR ID ${mfrFacility.resource.id} already exists in the datastore. No update needed`);
//     } else if (dataStoreValue) {
//       await axios.put(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
//         auth: {
//           username: process.env.DHIS2_USER,
//           password: process.env.DHIS2_PASSWORD
//         }
//       });
//       console.log(`Facility with MFR ID ${mfrFacility.resource.id} updated in the datastore.`);
//     } else {
//       await axios.post(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
//         auth: {
//           username: process.env.DHIS2_USER,
//           password: process.env.DHIS2_PASSWORD
//         }
//       });
//       console.log(`Facility with MFR ID ${mfrFacility.resource.id} created in the datastore.`);
//     }
//   } catch (error) {
//     winston.error(`Error saving facility ${mfrFacility.resource.id} to datastore: ${error.message}`);
//   }
// };

saveFacilityToDataStore = async function (mfrFacility) {
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
      
      if (dataStoreValue && dataStoreValue.data["resource.meta.lastUpdated"] === mfrFacility.resource.meta.lastUpdated) {
        console.log(`Facility with MFR ID ${mfrFacility.resource.id} already exists in the datastore. No update needed`);
      } else if (dataStoreValue) {
        await axios.put(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
          auth: {
            username: process.env.DHIS2_USER,
            password: process.env.DHIS2_PASSWORD
          }
        });
        console.log(`Facility with MFR ID ${mfrFacility.resource.id} updated in the datastore.`);
      } else {
        await axios.post(`${process.env.DHIS2_HOST}/dataStore/Dhis2-MFRApproval/${mfrFacility.resource.id}`, remappedFacility, {
          auth: {
            username: process.env.DHIS2_USER,
            password: process.env.DHIS2_PASSWORD
          }
        });
        console.log(`Facility with MFR ID ${mfrFacility.resource.id} created in the datastore.`);
      }
    } catch (error) {
      winston.error(`Error saving facility ${mfrFacility.resource.id} to datastore: ${error.message}`);
    }
  };

  


  // async checkFacilityInDataStore(facilityId) {
  //   try {
  //     const response = await axios.get(`http://localhost:8090/api/dataStore/Dhis2-MFRApproval/${facilityId}`, {
  //       auth: {
  //         username: 'admin',
  //         password: 'Dhis_1234'
  //       }
  //     });
  //     return response.status === 200;
  //   } catch (error) {
  //     if (error.response && error.response.status === 404) {
  //       return false; // Facility not found in datastore
  //     } else {
  //       winston.error(`Error checking facility in datastore: ${error.message}`);
  //       throw error;
  //     }
  //   }
  // };



  async getOrgUnitByAttributeValue(attributeValue) {
    const url = `${process.env.DHIS2_HOST}/organisationUnits.json?filter=attributeValues.value:eq:${attributeValue}&fields=id,displayName,attributeValues`;

    try {
      const response = await request.get(url, options);

      if (response.statusCode === 200) {
        const data = response.body;

        if (data.organisationUnits && data.organisationUnits.length > 0) {
          return data.organisationUnits[0]; // Return the first matching organisation unit
        } else {
          return null; // No matching organisation unit found
        }
      } else {
        throw new Error(`Failed to fetch org unit by attribute value: ${response.statusCode}`);
      }
    } catch (error) {
      winston.error(`Error fetching org unit by attribute value: ${error.message}`);
      return null;
    }
  }
  _getPHCUName = (dhis2Object) => {
    if (dhis2Object.type === 'Health Center') {
      return dhis2Object.name.replace(/Health Center/gi, '').trim();
    }
    return dhis2Object.name;
  };

  _limitShortName = (shortName) => (shortName.length > 40 ? shortName.substring(0, 40) : shortName);

  _getFacilityParent = async (dhis2Object) => {
    const filter = `filter=code:eq:${dhis2Object.reportsTo.facilityId}`;
    let dhis2OrgUnits = await this._filterDHIS2OrgUnit(filter);

    let orgUnitId = await this._getParent(dhis2Object, dhis2OrgUnits);

    if (!orgUnitId) {
      const nameFilter = `filter=name:eq:${dhis2Object.reportsTo.name}`;
      dhis2OrgUnits = await this._filterDHIS2OrgUnit(nameFilter);
      orgUnitId = await this._getParent(dhis2Object, dhis2OrgUnits);
    }

    return orgUnitId;
  };

  _getParent = async (dhis2Object, dhis2OrgUnits) => {
    if (!Array.isArray(dhis2OrgUnits.organisationUnits)) return null;

    for (const orgUnit of dhis2OrgUnits.organisationUnits) {
      if (dhis2Object.reportsTo.isPrimaryHealthCareUnit) {
        const response = await this._getDHIS2OrgUnitParent(orgUnit.id);
        const parentName = this._getPHCUName(dhis2Object.reportsTo);

        if (response?.parent?.name?.includes(parentName)) {
          return response.parent.id;
        }
      } else {
        if (orgUnit.name.includes(dhis2Object.reportsTo.name)) {
          return orgUnit.id;
        }
      }
    }
    return null;
  };

  _filterDHIS2OrgUnit = async (filter) => {
    options.url = encodeURI(`${process.env.DHIS2_HOST}organisationUnits?${filter}&fields=:all`);
    options.method = 'GET';

    try {
      const response = await request(options);
      return response.body;
    } catch (error) {
      winston.error('Failed to filter DHIS2 Org Unit', { filter, error });
      return null;
    }
  };

  _getDHIS2OrgUnit = async (uid) => {
    if (!uid) return null;

    options.url = encodeURI(`${process.env.DHIS2_HOST}organisationUnits/${uid}`);
    options.method = 'GET';

    try {
      const response = await request(options);
      return response.body;
    } catch (error) {
      winston.error('Failed to get DHIS2 Org Unit', { uid, error });
      return null;
    }
  };

  _getDHIS2OrgUnitParent = async (uid) => {
    options.url = `${process.env.DHIS2_HOST}organisationUnits/${uid}/parent`;
    options.method = 'GET';

    try {
      const response = await request(options);
      return response.body;
    } catch (error) {
      winston.error('Failed to get DHIS2 Org Unit Parent', { uid, error });
      return null;
    }
  };

  _createPHCU = async (dhis2Object, orgUnitId) => {
    winston.info('Creating new PHCU information on DHIS2', { name: dhis2Object.name, facilityId: dhis2Object.facilityId });

    const phcuObject = {
      name: `${this._getPHCUName(dhis2Object)} PHCU`,
      code: `${dhis2Object.facilityId}-phcu`,
      shortName: `${this._limitShortName(this._getPHCUName(dhis2Object))} PHCU`,
      openingDate: dhis2Object.yearOpened,
      parent: {
        id: orgUnitId,
      },
      ...(dhis2Object.closedDate && { closedDate: dhis2Object.closedDate }),
    };

    const registerPHCU = await this._sendDHIS2OrgUnit(phcuObject);
    if (registerPHCU.response.errorReports.length > 0) {
      winston.error('Failed to create PHCU', { errorReports: registerPHCU.response.errorReports });
      return null;
    }

    await this._attachPHCUOrgUnitGroup(registerPHCU.response.uid, dhis2Object.closedDate);

    return registerPHCU;
  };

  _createOrgUnit = async (dhis2Object, orgUnitId) => {
    winston.info('Creating new Org Unit on DHIS2', { name: dhis2Object.name, parentOrgUnitId: orgUnitId });

    const dhisObj = {
      name: dhis2Object.name,
      shortName: this._limitShortName(dhis2Object.name),
      code: dhis2Object.facilityId,
      openingDate: dhis2Object.yearOpened,
      parent: {
        id: orgUnitId,
      },
      attributeValues: [
        {
          value: dhis2Object.id,
          attribute: {
            id: references.locationAttributeId,
          },
        },
      ],
      geometry: {
        type: 'Point',
        coordinates: [dhis2Object.position.longitude, dhis2Object.position.latitude],
      },
      ...(dhis2Object.dhisId && { id: dhis2Object.dhisId }),
      ...(dhis2Object.closedDate && { closedDate: dhis2Object.closedDate }),
    };

    const response = await this._sendDHIS2OrgUnit(dhisObj);
    if (response.response.errorReports.length > 0) {
      winston.error('Failed to create Org Unit', { errorReports: response.response.errorReports });
      return null;
    }

    await this._attachOtherOrgUnitGroup(response.response.uid, dhis2Object);

    return response;
  };

  _updateExistingOrgUnit = async (dhis2Object, locationOrg) => {
    winston.info('Updating existing Org Unit on DHIS2', { orgUnitId: locationOrg.id });

    const parentId = await this._getUpdatedParentId(dhis2Object, locationOrg);

    const updateObj = {
      id: locationOrg.id,
      name: dhis2Object.name,
      shortName: this._limitShortName(dhis2Object.name),
      code: dhis2Object.facilityId,
      openingDate: dhis2Object.yearOpened,
      parent: {
        id: parentId,
      },
      attributeValues: [
        {
          value: dhis2Object.id,
          attribute: {
            id: references.locationAttributeId,
          },
        },
      ],
      geometry: {
        type: 'Point',
        coordinates: [dhis2Object.position.longitude, dhis2Object.position.latitude],
      },
      ...(dhis2Object.dhisId && { id: dhis2Object.dhisId }),
      ...(dhis2Object.closedDate && { closedDate: dhis2Object.closedDate }),
    };

    const response = await this._sendDHIS2OrgUnit(updateObj, true);
    if (response.response.errorReports.length > 0) {
      winston.error('Failed to update Org Unit', { errorReports: response.response.errorReports });
      return null;
    }

    await this._attachOtherOrgUnitGroup(response.response.uid, dhis2Object, true);

    return {
      orgUnitId: response.response.uid,
      parentOrgUnitId: parentId,
      ...dhis2Object,
    };
  };

  _getUpdatedParentId = async (dhis2Object, locationOrg) => {
    const locationOrgParent = await this._getDHIS2OrgUnitParent(locationOrg.id);

    let parentId = locationOrgParent?.parent?.id;

    if (parentId !== dhis2Object.reportsTo.dhisId) {
      parentId = await this._getFacilityParent(dhis2Object);
    }

    return parentId;
  };

  _findOrgUnitByCode = async (code) => {
    const filter = `filter=code:eq:${code}`;
    const dhis2OrgUnits = await this._filterDHIS2OrgUnit(filter);
    return dhis2OrgUnits?.organisationUnits?.[0] || null;
  };

  _sendDHIS2OrgUnit = async (dhisObj, update = false) => {
    options.url = `${process.env.DHIS2_HOST}organisationUnits${update ? `/${dhisObj.id}` : ''}`;
    options.method = update ? 'PUT' : 'POST';
    options.body = dhisObj;

    try {
      const response = await request(options);
      return response.body;
    } catch (error) {
      winston.error('Failed to send DHIS2 Org Unit', { dhisObj, update, error });
      return null;
    }
  };

  _attachPHCUOrgUnitGroup = async (orgUnitId, closedDate) => {
    options.url = `${process.env.DHIS2_HOST}organisationUnitGroups/${references.phcuGroupId}/organisationUnits/${orgUnitId}`;
    options.method = 'POST';

    try {
      const response = await request(options);
      if (response.body.status !== 'OK') {
        winston.error('Failed to attach PHCU group', { orgUnitId, response: response.body });
      }
    } catch (error) {
      winston.error('Failed to attach PHCU group', { orgUnitId, error });
    }
  };

  _attachOtherOrgUnitGroup = async (orgUnitId, dhis2Object, update) => {
    const orgUnitGroupId = this._getOrgUnitGroupId(dhis2Object.type);

    if (orgUnitGroupId) {
      if (update) {
        await this._detachExistingGroup(orgUnitId);
      }

      options.url = `${process.env.DHIS2_HOST}organisationUnitGroups/${orgUnitGroupId}/organisationUnits/${orgUnitId}`;
      options.method = 'POST';

      try {
        const response = await request(options);
        if (response.body.status !== 'OK') {
          winston.error('Failed to attach Org Unit group', { orgUnitId, orgUnitGroupId, response: response.body });
        }
      } catch (error) {
        winston.error('Failed to attach Org Unit group', { orgUnitId, orgUnitGroupId, error });
      }
    }
  };

  _getOrgUnitGroupId = (type) => {
    switch (type) {
      case 'Primary Health Care Unit':
        return references.phcuGroupId;
      case 'Health Center':
        return references.hcGroupId;
      case 'Health Post':
        return references.hpGroupId;
      case 'Hospital':
        return references.hospGroupId;
      case 'Specialized Hospital':
        return references.spHospGroupId;
      default:
        return null;
    }
  };

  _detachExistingGroup = async (orgUnitId) => {
    const groups = [
      references.phcuGroupId,
      references.hcGroupId,
      references.hpGroupId,
      references.hospGroupId,
      references.spHospGroupId,
    ];

    for (const groupId of groups) {
      options.url = `${process.env.DHIS2_HOST}organisationUnitGroups/${groupId}/organisationUnits/${orgUnitId}`;
      options.method = 'DELETE';

      try {
        await request(options);
      } catch (error) {
        winston.error('Failed to detach existing Org Unit group', { orgUnitId, groupId, error });
      }
    }
  };

  _isOfficeOrZonalHealthDept = (type) => ['Office', 'Zonal Health Department'].includes(type);
}

module.exports = DHIS2Service;
