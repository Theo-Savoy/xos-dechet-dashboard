/**
 * XOS Salesforce configuration. Keep every Salesforce API field and
 * organization-specific picklist value here so the adapter remains portable.
 */
const mapping = {
  apiVersion: "v67.0",
  objects: {
    account: {
      name: "Account",
      fields: {
        id: "Id",
        name: "Name",
        industry: "Industry",
        employeeCount: "Nombre_employes__c",
        customerType: "Type_de_client__c",
        parentId: "ParentId",
        ownerId: "OwnerId",
      },
      employeeBands: [
        "1 - 50",
        "51 - 250",
        "251 - 500",
        "501 - 1000",
        "1001 - 2000",
        "2001 - 4999",
        "5000 et plus",
      ],
      customerTypes: ["Client inactif", "Client", "Prospect"],
    },
    contact: {
      name: "Contact",
      fields: {
        id: "Id",
        name: "Name",
        phone: "Phone",
        accountId: "AccountId",
        title: "Title",
        decisionLevel: "Niveau_de_d_cision__c",
        doNotCall: "NPA__c",
      },
      decisionLevels: ["+", "=", "-"],
    },
    task: {
      name: "Task",
      childRelationship: "Tasks",
      fields: {
        id: "Id",
        subject: "Subject",
        description: "Description",
        result: "Resultat_call__c",
        subtype: "TaskSubtype",
        duration: "CallDurationInSeconds",
        whoId: "WhoId",
        whatId: "WhatId",
        status: "Status",
        ownerId: "OwnerId",
        activityDate: "ActivityDate",
      },
      subtypeValue: "Call",
      statusValue: "Achevée",
      results: [
        "Appel non décroché",
        "Message répondeur",
        "Appel décroché",
        "Appel argumenté",
        "RDV planifié",
      ],
      resultSemantic: {
        rdv: "RDV planifié",
        followUpNoAnswer: "Appel non décroché",
        followUpVoicemail: "Message répondeur",
      },
    },
    opportunity: {
      name: "Opportunity",
      fields: {
        accountId: "AccountId",
        isClosed: "IsClosed",
        isWon: "IsWon",
        stageName: "StageName",
      },
      closedLostStage: "Fermée / Perdue",
    },
    event: {
      name: "Event",
      relationName: "EventRelation",
      fields: {
        subject: "Subject",
        startDateTime: "StartDateTime",
        endDateTime: "EndDateTime",
        whoId: "WhoId",
        whatId: "WhatId",
        ownerId: "OwnerId",
        relationId: "RelationId",
        eventId: "EventId",
      },
    },
  },
};

export default mapping;
