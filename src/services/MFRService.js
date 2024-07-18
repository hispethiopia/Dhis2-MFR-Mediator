const request = require('requestretry')
const winston = require('winston')


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
  
 async getSingleMFRFacilty(mfrid){
  options.url = `${process.env.MFR_HOST}Location/${mfrid}`
  try{
    const response = await request(options)
    return await JSON.parse(response.body)
  } catch (error){
    throw Error(error)
  }
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

  

}

module.exports = MFRService