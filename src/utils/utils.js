'use strict'
const URI = require('urijs')





const mfrMapping = {
  mfrId: "resource.id",
  /**
   * Date time of MFR, found in meta.lastUpdated
   */
  lastUdated: "resource.meta.lastUpdated",
  /**
   * facility version id, which is incrementing on update. found in meta.versionId.
   */
  versionId: "resource.meta.versionId",
  /**
   * the status of the facility wether it is approved or not.
   */
  status: "resource.extension.status",
  /**
   * Date facility was created in MFR
   */
  createdDate: "resource.extension.createdDate",
  /**
   * The path of the facility using MFR ids.
   *  */
  reportingHierarchyId: "resource.extension.reportingHierarchyId",
  /**
   * Closed date in MFR.
   */
  closedDate: "resource.extension.FacilityInformation.closedDate",
  suspensionStartDate: "resource.extension.FacilityInformation.suspensionStartDate",
  suspensionEndDate: "resource.extension.FacilityInformation.suspensionEndDate",
  /**
   * Type of settlement in MFR.
   */
  settlement: "resource.extension.FacilityInformation.settlement",
  yearOpened: "resource.extension.FacilityInformation.yearOpened",
  ownership: "resource.extension.FacilityInformation.ownership",
  oldIdentificationNumber: "resource.extension.FacilityInformation.oldIdentificationNumber",
  ethiopianNationalFacilityId: "resource.extension.FacilityInformation.ethiopianNationalFacilityId",
  hmisCode: "resource.extension.FacilityInformation.hmisCode",
  echisId: "resource.extension.FacilityInformation.echisId",
  dhisId: "resource.extension.FacilityInformation.dihsId",
  facilityId: "resource.extension.FacilityInformation.facilityId",
  operationalStatus: "resource.operationalStatus.display",
  name: "resource.name",
  FT: "resource.type.FT",
  longitude: "resource.position.longitude",
  latitude: "resource.position.latitude",
  altitude: "resource.position.altitude",
  managingOrganization: "resource.managingOrganization.reference",
  mfrId: "resource.id",
  lastUpdated: "resource.meta.lastUpdated",
  versionId: "resource.meta.versionId",
  status: "resource.extension.status",
  createdDate: "resource.extension.createdDate",
  reportingHierarchyId: "resource.extension.reportingHierarchyId",
  closedDate: "resource.extension.FacilityInformation.closedDate",
  suspensionStartDate: "resource.extension.FacilityInformation.suspensionStartDate",
  suspensionEndDate: "resource.extension.FacilityInformation.suspensionEndDate",
  settlement: "resource.extension.FacilityInformation.settlement",
  yearOpened: "resource.extension.FacilityInformation.yearOpened",
  ownership: "resource.extension.FacilityInformation.ownership",
  oldIdentificationNumber: "resource.extension.FacilityInformation.oldIdentificationNumber",
  ethiopianNationalFacilityId: "resource.extension.FacilityInformation.ethiopianNationalFacilityId",
  hmisCode: "resource.extension.FacilityInformation.hmisCode",
  echisId: "resource.extension.FacilityInformation.echisId",
  dhisId: "resource.extension.FacilityInformation.dihsId",
  facilityId: "resource.extension.FacilityInformation.facilityId",
  operationalStatus: "resource.operationalStatus.display",
  name: "resource.name",
  FT: "resource.type.FT",
  longitude: "resource.position.longitude",
  latitude: "resource.position.latitude",
  altitude: "resource.position.altitude",
  managingOrganization: "resource.managingOrganization.reference",
  isParentPhcu: "isParentPhcu",  

}

const flattenObject = ({ parentField, objectToFlatten, destinationObject }) => {
  Object.keys(objectToFlatten).forEach(field => {
    if (field === "extension") {//Because extensions are collections, treat them differently
      flattenExtension({
        extensionToFlatten: objectToFlatten[field],
        parentField: parentField + "." + field,
        destinationObject: destinationObject
      })
    } else if (field === "identifier") {
      filterCoding({
        identifierToFlatten: objectToFlatten[field],
        parentField: parentField + "." + field,
        destinationObject,
        type: 'identifier',
      })
    }
    else if (field === "type") {
      filterCoding({
        identifierToFlatten: objectToFlatten[field],
        parentField: parentField + "." + field,
        destinationObject,
        type: "type"
      })
    }
    else {
      let type = typeof objectToFlatten[field]
      if (type === "string" || type === "number") {
        destinationObject[parentField + "." + field] = objectToFlatten[field]
      } else {
        flattenObject({
          parentField: parentField + "." + field,
          objectToFlatten: objectToFlatten[field],
          destinationObject
        })
      }
    }
  })
}

const filterCoding = ({
  identifierToFlatten,
  destinationObject,
  parentField,
  type
}) => {
  if (Array.isArray(identifierToFlatten))
    identifierToFlatten.forEach(identifier => {
      let valueFieldName = Object.keys(identifier).filter(item => item.includes(type === "identifier" ? "value" : type === "type" ? "text" : null))
      if (
        identifier[valueFieldName] !== null && identifier[valueFieldName] !== undefined
      ) {
        //Find the code and then assign it.
        let code = type === "identifier" ? identifier.type.coding[0]?.code : type === "type" ? identifier.coding[0].code : null
        destinationObject[parentField + "." + code] = identifier[valueFieldName]
      }
    })
  else {
    let valueFieldName = identifierToFlatten.coding[0].code;
    if (
      identifierToFlatten.text !== null && identifierToFlatten.text !== undefined
    ) {
      destinationObject[parentField + "." + valueFieldName] = identifierToFlatten[valueFieldName]
    }
  }
}

const flattenExtension = ({
  extensionToFlatten, destinationObject, parentField
}) => {
  extensionToFlatten.forEach(extension => {
    let valueFieldName = Object.keys(extension).filter(item => item.includes("value"))
    if (extension.url !== null && valueFieldName !== null && extension[valueFieldName] !== null && extension[valueFieldName] !== undefined) {
      //This one handles if the value for that extension is a string, number, date... primitive types
      destinationObject[parentField + "." + extension.url] = extension[valueFieldName]
    } else {
      //This means that there is no primitive value for the extension.
      if (extension.url !== null && extension.extension) {
        //This means that the value for this extension is an extension itself.
        flattenExtension({
          extensionToFlatten: extension.extension,
          parentField: parentField + "." + extension.url,
          destinationObject
        })
      }
    }

  });
}

module.exports.remapMfrToDhis = (mfrObject) => {
  let tempObject = {};
  Object.keys(mfrObject).forEach(field => {
    let type = typeof mfrObject[field];
    if (type === "string" || type === "number" || type==="boolean") {
      tempObject[field] = mfrObject[field];
      return;
    }
    flattenObject({ parentField: field, objectToFlatten: mfrObject[field], destinationObject: tempObject });
  });

  return tempObject;
};


