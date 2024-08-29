const request = require('requestretry')
const winston = require('winston')
const axios = require('axios');
const axiosRetry = require('axios-retry');
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

  

  async isPhcu(locationId) {
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
            throw Error('isPrimaryHealthCareUnit not found in FacilityInformation extensions');
          }
        } else {
          throw Error('FacilityInformation not found in extensions or it has no sub-extensions');
        }
      } else {
        throw Error('Extensions array not found in the response');
      }
    } catch (error) {
      console.error(`Error fetching primary health care unit information: ${error.message}`);
      return false;    }
  }
  
 async getSingleMFRFacilty(mfrid){
  options.url = `${process.env.MFR_HOST}Location/${mfrid}`
  try{
    const response = await request(options)
    const facility= JSON.parse(response.body)
    const transformedFacility = {
      resource: facility,
      search: { mode: 'match' },
      isParentPHCU: false 
  };
  const reportingHierarchyExtension = facility.extension.find(ext => ext.url === 'reportingHierarchyId');
        if (reportingHierarchyExtension && typeof reportingHierarchyExtension.valueString === 'string') {
            const hierarchyParts = reportingHierarchyExtension.valueString.split('/');
            if (hierarchyParts.length > 1) {
                const parentFacilityId = hierarchyParts[1];
                const isPHCU =  await this.isPhcu(parentFacilityId);
                transformedFacility.isParentPHCU = isPHCU;

                if (isPHCU === true) {
                    winston.info(`Parent facility ${parentFacilityId} of facility ${facility.id} is a PHCU.`);
                }
            }
        }

        return transformedFacility;
  } catch (error){
    throw Error(error)
  }
 }



async  getAllData(lastUpdated) {
  let nextUrl = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=5000&_sort=_lastUpdated`;
  const allEntries = [];  

  try {
    while (nextUrl) {
      winston.info("Fetching URL: ", nextUrl);
      const response = await axios.get(nextUrl);
      const responseBody = response.data;

      if (responseBody.entry && responseBody.entry.length > 0) {
        allEntries.push(...responseBody.entry);
      }

      const nextLink = responseBody.link && responseBody.link.find(link => link.relation === "next");
      nextUrl = nextLink ? nextLink.url : null;
    }
  } catch (error) {
    throw new Error(`Error fetching data: ${error.message}`);
  }

  return allEntries;  
}

async  getLatestUpdated(lastUpdated, processBatch) {
  try {
    const mfrService = new MFRService();
    const allData = await mfrService.getAllData(lastUpdated); 
    await processBatch({
      resourceType: "Bundle",
      type: "searchset",
      entry: allData, 
    });
  } catch (error) {
    throw new Error(`Error fetching and processing data: ${error.message}`);
  }
}

}

module.exports = MFRService