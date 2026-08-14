// Brand identity — centralised so the public name is a one-line change.
//
// "Mentible" is the LEAD CANDIDATE, still PROVISIONAL pending trademark/domain
// clearance (see docs/adr/ADR-006). Do not hardcode the name elsewhere; import
// from here. app.json slug + android.package intentionally still read
// "studybuddy-q" and are ratified only once the name is legally cleared; the
// deep-link `scheme` was switched to "mentible" (no installed app used the old
// scheme — Google sign-in only ships in a not-yet-built full APK).
export const BRAND_NAME = "Mentible";

// Lead tagline candidate (ADR-006 / branding doc §4b): the double meaning is
// "author the material yourself" + "author yourself".
export const BRAND_TAGLINE = "Author Yourself";

// App author / maintainer — surfaced on the About screen.
export const BRAND_AUTHOR = "Sivakumar Mambakkam [Siva]";
export const BRAND_CONTACT = "siva.mambakkam@kaundinyalabs.com";
