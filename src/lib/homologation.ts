export const homologationBypassAuth =
  import.meta.env["VITE_HOMOLOGATION_BYPASS_AUTH"] === "true";

export const homologationFamilyId =
  import.meta.env["VITE_HOMOLOGATION_FAMILY_ID"] ?? "";

export const homologationFamilyName =
  import.meta.env["VITE_HOMOLOGATION_FAMILY_NAME"] ?? "Família de homologação";

export function assertHomologationConfiguration() {
  if (homologationBypassAuth && !homologationFamilyId) {
    throw new Error("VITE_HOMOLOGATION_FAMILY_ID is required when auth bypass is enabled");
  }
}
