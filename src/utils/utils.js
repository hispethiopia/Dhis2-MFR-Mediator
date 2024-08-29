'use strict'
const URI = require('urijs')

const mfrMapping = {
  mfrId: "resource_id",
  lastUdated: "resource_meta_lastUpdated",
  versionId: "resource_meta_versionId",
  status: "resource_extension_status",
  createdDate: "resource_extension_createdDate",
  reportingHierarchyId: "resource_extension_reportingHierarchyId",
  closedDate: "resource_extension_FacilityInformation_closedDate",
  suspensionStartDate: "resource_extension_FacilityInformation_suspensionStartDate",
  suspensionEndDate: "resource_extension_FacilityInformation_suspensionEndDate",
  settlement: "resource_extension_FacilityInformation_settlement",
  yearOpened: "resource_extension_FacilityInformation_yearOpened",
  ownership: "resource_extension_FacilityInformation_ownership",
  oldIdentificationNumber: "resource_extension_FacilityInformation_oldIdentificationNumber",
  ethiopianNationalFacilityId: "resource_extension_FacilityInformation_ethiopianNationalFacilityId",
  hmisCode: "resource_extension_FacilityInformation_hmisCode",
  echisId: "resource_extension_FacilityInformation_echisId",
  dhisId: "resource_extension_FacilityInformation_dihsId",
  facilityId: "resource_extension_FacilityInformation_facilityId",
  operationalStatus: "resource_operationalStatus_display",
  name: "resource_name",
  FT: "resource_type_FT",
  longitude: "resource_position_longitude",
  latitude: "resource_position_latitude",
  altitude: "resource_position_altitude",
  managingOrganization: "resource_managingOrganization_reference",
  isParentPhcu: "isParentPhcu",  
}

const flattenObject = ({ parentField, objectToFlatten, destinationObject }) => {
  Object.keys(objectToFlatten).forEach(field => {
    if (field === "extension") {
      flattenExtension({
        extensionToFlatten: objectToFlatten[field],
        parentField: parentField + "_" + field,
        destinationObject: destinationObject
      })
    } else if (field === "identifier") {
      filterCoding({
        identifierToFlatten: objectToFlatten[field],
        parentField: parentField + "_" + field,
        destinationObject,
        type: 'identifier',
      })
    }
    else if (field === "type") {
      filterCoding({
        identifierToFlatten: objectToFlatten[field],
        parentField: parentField + "_" + field,
        destinationObject,
        type: "type"
      })
    }
    else {
      let type = typeof objectToFlatten[field]
      if (type === "string" || type === "number") {
        destinationObject[parentField + "_" + field] = objectToFlatten[field]
      } else {
        flattenObject({
          parentField: parentField + "_" + field,
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
        let code = type === "identifier" ? identifier.type.coding[0]?.code : type === "type" ? identifier.coding[0].code : null
        destinationObject[parentField + "_" + code] = identifier[valueFieldName]
      }
    })
  else {
    let valueFieldName = identifierToFlatten.coding[0].code;
    if (
      identifierToFlatten.text !== null && identifierToFlatten.text !== undefined
    ) {
      destinationObject[parentField + "_" + valueFieldName] = identifierToFlatten[valueFieldName]
    }
  }
}

const flattenExtension = ({
  extensionToFlatten, destinationObject, parentField
}) => {
  extensionToFlatten.forEach(extension => {
    let valueFieldName = Object.keys(extension).filter(item => item.includes("value"))
    if (extension.url !== null && valueFieldName !== null && extension[valueFieldName] !== null && extension[valueFieldName] !== undefined) {
      destinationObject[parentField + "_" + extension.url] = extension[valueFieldName]
    } else {
      if (extension.url !== null && extension.extension) {
        flattenExtension({
          extensionToFlatten: extension.extension,
          parentField: parentField + "_" + extension.url,
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
    if (type === "string" || type === "number" || type === "boolean") {
      tempObject[field] = mfrObject[field];
      return;
    }
    flattenObject({ parentField: field, objectToFlatten: mfrObject[field], destinationObject: tempObject });
  });

  return tempObject;
};
