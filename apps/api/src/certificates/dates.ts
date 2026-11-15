/** The issue date as printed on the certificate and in its email (Cairo time). */
export const dateEn = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
// Latin digits: Arabic-Indic digits inside a right-to-left line would need full bidi.
export const dateAr = (d: Date) => d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
