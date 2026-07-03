/**
 * Windows <-> IANA time-zone id mapping.
 *
 * Data derived from the Unicode CLDR supplemental file
 * `common/supplemental/windowsZones.xml`
 * (https://github.com/unicode-org/cldr — Unicode License / Unicode-3.0),
 * using ONLY the `territory="001"` (world / default) mappings, so that each
 * Windows time-zone display name maps to exactly ONE canonical IANA id.
 *
 * A handful of legacy IANA aliases that CLDR still emits have been updated to
 * their current canonical IANA ids:
 *   Europe/Kiev              -> Europe/Kyiv
 *   Asia/Calcutta            -> Asia/Kolkata
 *   Asia/Rangoon             -> Asia/Yangon
 *   Asia/Katmandu            -> Asia/Kathmandu
 *   America/Godthab          -> America/Nuuk
 *   America/Buenos_Aires     -> America/Argentina/Buenos_Aires
 *   America/Indianapolis     -> America/Indiana/Indianapolis
 *
 * IMPORTANT: the Windows -> IANA relation is inherently lossy. Windows time
 * zones are far coarser than the IANA tz database (a single Windows zone such
 * as "W. Europe Standard Time" covers many IANA zones), so this map picks the
 * CLDR default representative id. The reverse (IANA -> Windows) direction is
 * therefore only approximate — it recovers a representative Windows zone, not
 * necessarily the exact original.
 *
 * This module is pure and browser-safe: it depends only on the built-in `Intl`
 * API and pulls in no external / npm dependencies.
 */

/** Complete CLDR territory="001" Windows-display-name -> canonical IANA map. */
export const WINDOWS_TO_IANA: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "UTC-11": "Etc/GMT+11",
  "Aleutian Standard Time": "America/Adak",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Marquesas Standard Time": "Pacific/Marquesas",
  "Alaskan Standard Time": "America/Anchorage",
  "UTC-09": "Etc/GMT+9",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "UTC-08": "Etc/GMT+8",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Mountain Standard Time": "America/Denver",
  "Yukon Standard Time": "America/Whitehorse",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time": "America/Chicago",
  "Easter Island Standard Time": "Pacific/Easter",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Eastern Standard Time": "America/New_York",
  "Haiti Standard Time": "America/Port-au-Prince",
  "Cuba Standard Time": "America/Havana",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Turks And Caicos Standard Time": "America/Grand_Turk",
  "Paraguay Standard Time": "America/Asuncion",
  "Atlantic Standard Time": "America/Halifax",
  "Venezuela Standard Time": "America/Caracas",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "SA Western Standard Time": "America/La_Paz",
  "Pacific SA Standard Time": "America/Santiago",
  "Newfoundland Standard Time": "America/St_Johns",
  "Tocantins Standard Time": "America/Araguaina",
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Eastern Standard Time": "America/Cayenne",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Greenland Standard Time": "America/Nuuk",
  "Montevideo Standard Time": "America/Montevideo",
  "Magallanes Standard Time": "America/Punta_Arenas",
  "Saint Pierre Standard Time": "America/Miquelon",
  "Bahia Standard Time": "America/Bahia",
  "UTC-02": "Etc/GMT+2",
  "Azores Standard Time": "Atlantic/Azores",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  UTC: "Etc/UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "Sao Tome Standard Time": "Africa/Sao_Tome",
  "Morocco Standard Time": "Africa/Casablanca",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "Jordan Standard Time": "Asia/Amman",
  "GTB Standard Time": "Europe/Bucharest",
  "Middle East Standard Time": "Asia/Beirut",
  "Egypt Standard Time": "Africa/Cairo",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Syria Standard Time": "Asia/Damascus",
  "West Bank Standard Time": "Asia/Hebron",
  "South Africa Standard Time": "Africa/Johannesburg",
  "FLE Standard Time": "Europe/Kyiv",
  "Israel Standard Time": "Asia/Jerusalem",
  "South Sudan Standard Time": "Africa/Juba",
  "Kaliningrad Standard Time": "Europe/Kaliningrad",
  "Sudan Standard Time": "Africa/Khartoum",
  "Libya Standard Time": "Africa/Tripoli",
  "Namibia Standard Time": "Africa/Windhoek",
  "Arabic Standard Time": "Asia/Baghdad",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arab Standard Time": "Asia/Riyadh",
  "Belarus Standard Time": "Europe/Minsk",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "Astrakhan Standard Time": "Europe/Astrakhan",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Russia Time Zone 3": "Europe/Samara",
  "Mauritius Standard Time": "Indian/Mauritius",
  "Saratov Standard Time": "Europe/Saratov",
  "Georgian Standard Time": "Asia/Tbilisi",
  "Volgograd Standard Time": "Europe/Volgograd",
  "Caucasus Standard Time": "Asia/Yerevan",
  "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent",
  "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
  "Pakistan Standard Time": "Asia/Karachi",
  "Qyzylorda Standard Time": "Asia/Qyzylorda",
  "India Standard Time": "Asia/Kolkata",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Central Asia Standard Time": "Asia/Bishkek",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Omsk Standard Time": "Asia/Omsk",
  "Myanmar Standard Time": "Asia/Yangon",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Altai Standard Time": "Asia/Barnaul",
  "W. Mongolia Standard Time": "Asia/Hovd",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "N. Central Asia Standard Time": "Asia/Novosibirsk",
  "Tomsk Standard Time": "Asia/Tomsk",
  "China Standard Time": "Asia/Shanghai",
  "North Asia East Standard Time": "Asia/Irkutsk",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "Aus Central W. Standard Time": "Australia/Eucla",
  "Transbaikal Standard Time": "Asia/Chita",
  "Tokyo Standard Time": "Asia/Tokyo",
  "North Korea Standard Time": "Asia/Pyongyang",
  "Korea Standard Time": "Asia/Seoul",
  "Yakutsk Standard Time": "Asia/Yakutsk",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "West Pacific Standard Time": "Pacific/Port_Moresby",
  "Tasmania Standard Time": "Australia/Hobart",
  "Vladivostok Standard Time": "Asia/Vladivostok",
  "Lord Howe Standard Time": "Australia/Lord_Howe",
  "Bougainville Standard Time": "Pacific/Bougainville",
  "Russia Time Zone 10": "Asia/Srednekolymsk",
  "Magadan Standard Time": "Asia/Magadan",
  "Norfolk Standard Time": "Pacific/Norfolk",
  "Sakhalin Standard Time": "Asia/Sakhalin",
  "Central Pacific Standard Time": "Pacific/Guadalcanal",
  "Russia Time Zone 11": "Asia/Kamchatka",
  "New Zealand Standard Time": "Pacific/Auckland",
  "UTC+12": "Etc/GMT-12",
  "Fiji Standard Time": "Pacific/Fiji",
  "Chatham Islands Standard Time": "Pacific/Chatham",
  "UTC+13": "Etc/GMT-13",
  "Tonga Standard Time": "Pacific/Tongatapu",
  "Samoa Standard Time": "Pacific/Apia",
  "Line Islands Standard Time": "Pacific/Kiritimati",
};

/** Look up the canonical IANA id for a Windows time-zone display name. */
export function windowsToIana(name: string): string | undefined {
  return WINDOWS_TO_IANA[name];
}

/**
 * Reverse index (IANA id -> Windows display name), built once at module load.
 * Because the mapping is lossy, the first Windows name encountered for a given
 * IANA id wins (in the territory="001" set the relation is effectively 1:1).
 */
const IANA_TO_WINDOWS: Record<string, string> = (() => {
  const reverse: Record<string, string> = {};
  for (const [windowsName, iana] of Object.entries(WINDOWS_TO_IANA)) {
    if (!(iana in reverse)) {
      reverse[iana] = windowsName;
    }
  }
  return reverse;
})();

/**
 * Reverse lookup: the (first) Windows display name whose territory="001" IANA id
 * equals `iana`. Returns undefined if there is no representative Windows zone.
 */
export function ianaToWindows(iana: string): string | undefined {
  return IANA_TO_WINDOWS[iana];
}

/** True if `zone` is accepted by the runtime as an IANA time-zone id. */
function isValidIana(zone: string): boolean {
  try {
    // Throws RangeError for an unknown / malformed time zone.
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The host's local IANA zone, used as the last-resort fallback. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

/**
 * Resolve an arbitrary time-zone string (IANA id, Windows display name, or a
 * bare Windows name) to a valid IANA id. Never throws; always returns a usable
 * IANA id.
 *
 * Resolution order:
 *   1. If `zone` already looks like a valid IANA id, return it as-is.
 *   2. If `zone` is a known Windows display name, return its mapped IANA id.
 *   3. python-o365 heuristic: some sources pass a bare name without the trailing
 *      " Standard Time" (e.g. "W. Europe"); retry with that suffix appended.
 *   4. Fall back to the host's local zone.
 */
export function toIana(zone: string | null | undefined): string {
  if (zone == null) {
    return localZone();
  }

  const trimmed = zone.trim();
  if (trimmed === "") {
    return localZone();
  }

  // 1) Already a valid IANA id (this also accepts Intl aliases such as "UTC").
  if (isValidIana(trimmed)) {
    return trimmed;
  }

  // 2) Known Windows display name.
  const mapped = windowsToIana(trimmed);
  if (mapped && isValidIana(mapped)) {
    return mapped;
  }

  // 3) Bare Windows name missing the conventional " Standard Time" suffix.
  const mappedStd = windowsToIana(`${trimmed} Standard Time`);
  if (mappedStd && isValidIana(mappedStd)) {
    return mappedStd;
  }

  // 4) Give up and use the host's local zone.
  return localZone();
}
