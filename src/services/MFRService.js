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
                    console.log(`Parent facility ${parentFacilityId} of facility ${facility.id} is a PHCU.`);
                }
            }
        }

        return transformedFacility;
  } catch (error){
    throw Error(error)
  }
 }



  // async getLatestUpdated(lastUpdated,page) {
  //   winston.info("Getting updated list of facilities from MFR since ", lastUpdated)
  //   options.url = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=100&_sort=_lastUpdated&_getpagesoffset=${page}`

  //   try {
  //     const response = await request(options)
  //     return await JSON.parse(response.body)
  //   } catch (error) {
  //     throw Error(error)
  //   }
  // }
//   async getLatestUpdated(lastUpdated) {
//     winston.info("Getting updated list of facilities from MFR since ", lastUpdated);
//     const accumulatedEntries = [];
//     let nextUrl = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=100&_sort=_lastUpdated`;

//     try {
//         const response =await axios.get(nextUrl);
  
//         while (nextUrl) {
//             const response = await axios.get(nextUrl);
//             const responseBody = response.data;
            
//             // console.log(responseBody.entry)
//             // Accumulate entries from the current response
            

//             // Check if there is a "next" link to continue fetching
//             const nextLink = responseBody.link && responseBody.link.find(link => link.relation === "next");
//             nextUrl = nextLink ? nextLink.url : null;
//             if (responseBody.entry && responseBody.entry.length > 0) {
//               console.log(responseBody.entry) 
//               // yield responseBody.entry
//             }
//         }   
        
       

//         // Return the accumulated entries as part of a single bundle
//         // return {
//         //     resourceType: "Bundle",
//         //     type: "searchset",
//         //     entry: accumulatedEntries
           
//         //   };
        
//     } catch (error) {
//         throw new Error(`Error fetching updated facilities: ${error.message}`);
//     }
// }
// async getLatestUpdated(lastUpdated, processBatch) {
//   winston.info("Getting updated list of facilities from MFR since ", lastUpdated);
//   let nextUrl = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=100&_sort=_lastUpdated`;

//   try {
//       while (nextUrl) {
//           const response = await axios.get(nextUrl);
//           const responseBody = response.data;

//           // Process the current batch of entries
//           if (responseBody.entry && responseBody.entry.length > 0) {
//               await processBatch(responseBody.entry);
//           }

//           // Check if there is a "next" link to continue fetching
//           const nextLink = responseBody.link && responseBody.link.find(link => link.relation === "next");
//           nextUrl = nextLink ? nextLink.url : null;
//       }
//   } catch (error) {
//       throw new Error(`Error fetching updated facilities: ${error.message}`);
//   }
// }

// async getLatestUpdated(lastUpdated) {
//   winston.info("Getting updated list of facilities from MFR since ", lastUpdated);
//   const accumulatedEntries = [];
//   let nextUrl = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=100&_sort=_lastUpdated`;

//   try {
//       while (nextUrl) {
//           const response = await axios.get(nextUrl);
//           const responseBody = response.data;

//           if (responseBody.entry && responseBody.entry.length > 0) {
//               accumulatedEntries.push(...responseBody.entry);
//           }

//           const nextLink = responseBody.link && responseBody.link.find(link => link.relation === "next");
//           nextUrl = nextLink ? nextLink.url : null;
//       }

//       return {
//           resourceType: "Bundle",
//           type: "searchset",
//           entry: accumulatedEntries
//       };
//   } catch (error) {
//       throw new Error(`Error fetching latest updated facilities: ${error.message}`);
//   }
// }

async getLatestUpdated(lastUpdated, processBatch) {
  winston.info("Getting updated list of facilities from MFR since ", lastUpdated);
  let nextUrl = `${process.env.MFR_HOST}Location?_lastUpdated=gt${lastUpdated}&_count=100&_sort=_lastUpdated`;

  
  try {
      while (nextUrl) {
          const response = await axios.get(nextUrl);
          const responseBody = response.data;

          if (responseBody.entry && responseBody.entry.length > 0) {
             
              await processBatch({
                  resourceType: "Bundle",
                  type: "searchset",
                  entry: responseBody.entry
              });
          }

          const nextLink = responseBody.link && responseBody.link.find(link => link.relation === "next");
          nextUrl = nextLink ? nextLink.url : null;

          if (!nextUrl) {
              break;
          }
      }
  } catch (error) {
      throw new Error(`Error fetching latest updated facilities: ${error.message}`);
  }
}




}

module.exports = MFRService