const request = require('requestretry')
const winston = require('winston')

const references = require('../utils/references')

const options = {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Request',
    'X-platform': 'Node'
  },
  maxAttempts: 10, // (default) try 5 times
  retryDelay: 5000, // (default) wait for 5s before trying again
  retryStrategy: request.RetryStrategies.HTTPOrNetworkError // (default) retry on 5xx or network errors
}

class MFRService {

  async getOrganizationAffiliation(locationId) {
    winston.info("Getting organization affiliation under ", locationId)
    options.url = `${process.env.MFR_HOST}OrganizationAffiliation?rpt=${locationId}&_count=10000`

    try {
      const response = await request(options)
      return await JSON.parse(response.body)
    } catch (error) {
      throw Error(error)
    }
  }

  

  async  isPhcu(locationId) {
    const options = {
      uri: `${process.env.MFR_HOST}Location/${locationId}`,
      json: true 
    };
  
    try {
      const response = await request(options);
  
  
      if (response.body && response.body.extension && Array.isArray(response.body.extension)) {
     
        const facilityInfo = response.body.extension.find(ext => ext.url === "FacilityInformation");
  
        if (facilityInfo && facilityInfo.extension && Array.isArray(facilityInfo.extension)) {
          const primaryHealthCareUnit = facilityInfo.extension.find(ext => ext.url === "isPrimaryHealthCareUnit");
  
          if (primaryHealthCareUnit && typeof primaryHealthCareUnit.valueBoolean !== 'undefined') {
            return primaryHealthCareUnit.valueBoolean;
          } else {
            throw new Error('isPrimaryHealthCareUnit not found in FacilityInformation extensions');
          }
        } else {
          throw new Error('FacilityInformation not found in extensions or it has no sub-extensions');
        }
      } else {
        throw new Error('Extensions array not found in the response');
      }
    } catch (error) {
      console.error(`Error fetching primary health care unit information: ${error.message}`);
      return false;    }
  }
  

  


  async getLatestUpdated(lastUpdated) {
    winston.info("Getting updated list of facilities from MFR since ", lastUpdated)
    options.url = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=100&_sort=_lastUpdated`

    try {
      const response = await request(options)
      return await JSON.parse(response.body)
    } catch (error) {
      throw Error(error)
    }
  }

  async getLatestCreated(lastCreated) {
    winston.info("Getting created list of facilities from MFR since ",lastCreated)
    options.url = `${process.env.MFR_HOST}Location?crd=gt${lastCreated}&_count=100&_sort=crd`

    try {
      const response = await request(options)
      return await JSON.parse(response.body)
    } catch (error) {
      throw Error(error)
    }
  }

  async mFRtoDhis2ObjectConverter(mfrResponseDataEntry) {
    return mfrResponseDataEntry;
    const listOfDHIS2Objects = []
    winston.info("Preparing MFR object to DHIS2 of ", mfrResponseDataEntry.length)

    for (let index = 0; index < mfrResponseDataEntry.length; index++) {      
      const entry = mfrResponseDataEntry[index]
      
      if (entry.resource.name !== null && entry.resource.name !== undefined &&
        entry.resource.extension !== null && entry.resource.extension !== undefined &&
        entry.resource.operationalStatus !== undefined && references.allowedOperationalStatuses.includes(entry.resource.operationalStatus.display) && entry.resource.type[0].text !== undefined) {

        if (references.organisationUnitGroups.find(orgUnitGroup => orgUnitGroup.name.toUpperCase() === entry.resource.type[0].text.toUpperCase()) == undefined && 
        (!entry.resource.type[0].text.includes('Office') || !entry.resource.type[0].text === 'Zonal Health Department'))
            continue
        
        var facilityIdentifiers = entry.resource.identifier.find(identifier => {
          if ('facilityId' === identifier.type.coding[0].code) {
            return identifier
          }
        })

        if (facilityIdentifiers.value == undefined)
          continue

        var dhisIdentifiers = entry.resource.identifier.find(identifier => {
          if ('dhisId' === identifier.type.coding[0].code) {
            return identifier
          }
        })

        if (process.env.DHISID_REQUIRED == 'true' && dhisIdentifiers?.value == undefined
          && entry.resource.type[0].text.includes('Office') == false && entry.resource.type[0].text != 'Zonal Health Department'){          
          continue     
        }

        const reportingHierarchyId = entry.resource.extension.find(function (extension, index) {
          if (extension.url === "reportingHierarchyId") {
            return extension;
          }
        })

        const reportsToHierarchy = reportingHierarchyId.valueString.split('/')

        var reportsTo = await this.getReportsToLocation(reportsToHierarchy[1]);

        if (reportsTo != null && reportsTo != undefined) {

          var innerExtension = entry.resource.extension.find(function (extension, index) {
            if (extension.url === "FacilityInformation") {
              return extension;
            }
          })

          var settlement = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'settlement') {
              return ex
            }
          })

          var ownership = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'ownership') {
              return ex
            }
          })

          var isPrimaryHealthCareUnit = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'isPrimaryHealthCareUnit') {
              return ex
            }
          })

          var yearOpened = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'yearOpened') {
              return ex
            }
          })

          var closedDate = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'closedDate') {
              return ex
            }
          })

          if (entry.resource.operationalStatus.display === "Suspended"){
            closedDate = innerExtension.extension.find(function (ex, index) {
              if (ex.url === 'suspensionEndDate') {
                return ex
              }
            })
          }

          if (entry.resource.type[0].text && (entry.resource.type[0].text.includes('Office') || entry.resource.type[0].text === 'Zonal Health Department'))
            isPrimaryHealthCareUnit.valueBoolean = 0

          var dhis2 = {
            dhisId: dhisIdentifiers.value,
            facilityId: facilityIdentifiers.value,
            id: entry.resource.id,
            name: entry.resource.name,
            settlement: settlement.valueString,
            ownership: ownership.valueString,
            type: entry.resource.type[0].text,
            position: entry.resource.position,
            isPrimaryHealthCareUnit: isPrimaryHealthCareUnit.valueBoolean,
            yearOpened: yearOpened.valueDate,
            closedDate: closedDate ? closedDate.valueDate : undefined,
            reportsTo,
            lastUpdated: entry.resource.meta.lastUpdated,
            reportingHierarchyId: reportingHierarchyId.valueString.split('/')
          }

          winston.info("MFR object for DHIS2 ", dhis2)
          listOfDHIS2Objects.push(dhis2)
        }
      }
    }

    return listOfDHIS2Objects
  }

  async mFRtoDhis2SingleObjectConverter(entry) {
    winston.info("Preparing MFR object to DHIS2 of ", entry.name)

    if (entry.name !== null && entry.name !== undefined &&
      entry.extension !== null && entry.extension !== undefined &&
      entry.operationalStatus !== undefined && references.allowedOperationalStatuses.includes(entry.operationalStatus.display)&& entry.type[0].text !== undefined) {

      if (references.organisationUnitGroups.find(orgUnitGroup => orgUnitGroup.name.toUpperCase() === entry.type[0].text.toUpperCase()) == undefined && 
      (!entry.type[0].text.includes('Office') || !entry.type[0].text === 'Zonal Health Department'))
          return null

      var facilityIdentifiers = entry.identifier.find(identifier => {
        if ('facilityId' === identifier.type.coding[0].code) {
          return identifier
        }
      })

      if (facilityIdentifiers.value == undefined)
        return null

      var dhisIdentifiers = entry.identifier.find(identifier => {
        if ('dhisId' === identifier.type.coding[0].code) {
          return identifier
        }
      })

      if (process.env.DHISID_REQUIRED == 'true' && dhisIdentifiers?.value == undefined 
          && entry.type[0].text.includes('Office') == false && entry.type[0].text != 'Zonal Health Department'){          
          return null          
      }

      const reportingHierarchyId = entry.extension.find(function (extension, index) {
        if (extension.url === "reportingHierarchyId") {
          return extension;
        }
      })

      const reportsToHierarchy = reportingHierarchyId.valueString.split('/')

      var reportsTo = await this.getReportsToLocation(reportsToHierarchy[1]);

      if (reportsTo != null && reportsTo != undefined) {

        var innerExtension = entry.extension.find(function (extension, index) {
          if (extension.url === "FacilityInformation") {
            return extension;
          }
        })

        var settlement = innerExtension.extension.find(function (ex, index) {
          if (ex.url === 'settlement') {
            return ex
          }
        })

        var ownership = innerExtension.extension.find(function (ex, index) {
          if (ex.url === 'ownership') {
            return ex
          }
        })

        var isPrimaryHealthCareUnit = innerExtension.extension.find(function (ex, index) {
          if (ex.url === 'isPrimaryHealthCareUnit') {
            return ex
          }
        })

        var yearOpened = innerExtension.extension.find(function (ex, index) {
          if (ex.url === 'yearOpened') {
            return ex
          }
        })

        var closedDate = undefined

        if (entry.operationalStatus.display === "Closed"){
          closedDate = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'closedDate') {
              return ex
            }
          })
        }

        if (entry.operationalStatus.display === "Suspended"){
          closedDate = innerExtension.extension.find(function (ex, index) {
            if (ex.url === 'suspensionEndDate') {
              return ex
            }
          })
        }

        if (entry.type[0].text && (entry.type[0].text.includes('Office') || entry.type[0].text === 'Zonal Health Department'))
          isPrimaryHealthCareUnit.valueBoolean = 0

        var dhis2 = {
          dhisId: dhisIdentifiers.value,
          facilityId: facilityIdentifiers.value,
          id: entry.id,
          name: entry.name,
          settlement: settlement.valueString,
          ownership: ownership.valueString,
          type: entry.type[0].text,
          position: entry.position,
          isPrimaryHealthCareUnit: isPrimaryHealthCareUnit.valueBoolean,
          yearOpened: yearOpened.valueDate,
          closedDate: closedDate ? closedDate.valueDate : undefined,
          reportsTo,
          lastUpdated: entry.meta.lastUpdated,
          reportingHierarchyId: reportingHierarchyId.valueString.split('/')
        }

        winston.info("MFR object for DHIS2 ", dhis2)
        return dhis2
      }
    }  

    return null
  }

  getReportsToLocation = async (locationId) => {
    winston.info("Getting reports", locationId)
    try {
      const reportsToLocation = await this.getLocation(locationId)
      if (reportsToLocation.name !== null && reportsToLocation.name !== undefined) {
        if (reportsToLocation.type[0].text === undefined)
          return null

        var innerExtension = reportsToLocation.extension.find(function (extension, index) {
          if (extension.url === "FacilityInformation") {
            return extension;
          }
        })

        var isPrimaryHealthCareUnit = innerExtension.extension.find(function (ex, index) {
          if (ex.url === 'isPrimaryHealthCareUnit') {
            return ex
          }
        })        

        var facilityIdentifiers = reportsToLocation.identifier.find(identifier => {
          if ('facilityId' === identifier.type.coding[0].code) {
            return identifier
          }
        })

        if (reportsToLocation.type[0].text.includes('Office') || reportsToLocation.type[0].text === 'Zonal Health Department')
          isPrimaryHealthCareUnit.valueBoolean = 0

        return {
          id: reportsToLocation.id,
          name: reportsToLocation.name,
          type: reportsToLocation.type[0].text,
          facilityId: facilityIdentifiers.value,
          isPrimaryHealthCareUnit: isPrimaryHealthCareUnit.valueBoolean
        }
      }
    } catch (error) {
      winston.error('Error when getting reports to information', error)
      return null
    }
  }

  getLocation = async (uuid) => {
    options.url = `${process.env.MFR_HOST}Location/${uuid}`;

    try {
      const response = await request(options)
      return await JSON.parse(response.body)
    } catch (error) {
      throw Error(error)
    }
  }

  mfrDatatoDHIS2Data = (locationData, reportsTo) => {
    if (locationData.type[0].text === undefined)
      return
    
    winston.info("Preparing MFR object to DHIS2 of ", locationData.name, locationData.id)

    var facilityIdentifiers = locationData.identifier.find(identifier => {
      if ('facilityId' === identifier.type.coding[0].code) {
        return identifier
      }
    })

    if (facilityIdentifiers.value == undefined)
      return

    var dhisIdentifiers = locationData.identifier.find(identifier => {
      if ('dhisId' === identifier.type.coding[0].code) {
        return identifier
      }
    })

    if (process.env.DHISID_REQUIRED == 'true' && dhisIdentifiers?.value == undefined 
        && locationData.type[0].text.includes('Office') == false && locationData.type[0].text != 'Zonal Health Department'){          
        return          
    }

    if (locationData.operationalStatus === undefined || !references.allowedOperationalStatuses.includes(locationData.operationalStatus.display))
      return

    if (references.organisationUnitGroups.find(orgUnitGroup => orgUnitGroup.name.toUpperCase() === locationData.type[0].text.toUpperCase()) == undefined && 
    (!locationData.type[0].text.includes('Office') || !locationData.type[0].text === 'Zonal Health Department'))
        return

    const innerExtension = locationData.extension.find(function (extension, index) {
      if (extension.url === "FacilityInformation") {
        return extension;
      }
    })

    const settlement = innerExtension.extension.find(function (ex, index) {
      if (ex.url === 'settlement') {
        return ex
      }
    })

    const ownership = innerExtension.extension.find(function (ex, index) {
      if (ex.url === 'ownership') {
        return ex
      }
    })

    const isPrimaryHealthCareUnit = innerExtension.extension.find(function (ex, index) {
      if (ex.url === 'isPrimaryHealthCareUnit') {
        return ex
      }
    })

    const yearOpened = innerExtension.extension.find(function (ex, index) {
      if (ex.url === 'yearOpened') {
        return ex
      }
    })

    const closedDate = innerExtension.extension.find(function (ex, index) {
      if (ex.url === 'closedDate') {
        return ex
      }
    })

    const reportingHierarchyId = locationData.extension.find(function (extension, index) {
      if (extension.url === "reportingHierarchyId") {
        return extension;
      }
    })

    if (locationData.type[0].text && (locationData.type[0].text.includes('Office') || locationData.type[0].text === 'Zonal Health Department'))
      isPrimaryHealthCareUnit.valueBoolean = 0

    return {
      dhisId: dhisIdentifiers.value,
      facilityId: facilityIdentifiers.value,
      id: locationData.id,
      name: locationData.name,
      settlement: settlement.valueString,
      ownership: ownership.valueString,
      type: locationData.type[0].text,
      position: locationData.position,
      isPrimaryHealthCareUnit: isPrimaryHealthCareUnit.valueBoolean,
      yearOpened: yearOpened.valueDate,
      closedDate: closedDate ? closedDate.valueDate : undefined,
      reportsTo,
      lastUpdated: locationData.meta.lastUpdated,
      reportingHierarchyId: reportingHierarchyId.valueString.split('/')
    }
  }
}

module.exports = MFRService