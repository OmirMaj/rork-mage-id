// utils/proofPack/docCopy.ts — every word the Proof of Work Package DOCUMENT prints.
//
// The package is handed to someone outside the app (an owner, a bank, a surety,
// a factoring company), so it is printed in ONE language the contractor picks
// on the review screen (docs/I18N.md: a PDF has a per-document language).
// English and Spanish live side by side here so the two can never drift in
// what they claim; scripts/validate-proof-pack.ts reads BOTH tables.
//
// WHAT THIS DOCUMENT MAY SAY. It says what MAGE ID holds and how each record is
// kept. It never says the work was done, done well, or done to any standard.
// So neither table may use: verified, certified, guaranteed, audit, attested,
// "proof" as a claim (the title is a name and is the only place the word
// appears), and no promise about a bank, a lender, a surety or an insurer
// ("bank-ready", "lender-approved", "gets you paid faster"). The Spanish forms
// are banned the same way. The validator holds both lists.
//
// WORDING (docs/VOICE.md): a key ending in `Label` is a name in Title Case
// (Spanish labels are sentence case, which is correct Spanish). Everything
// else is one or more whole sentences. No em dashes, no "and" sign, no "e.g.",
// no arrows. "AIA-style", never the bare name.
//
// The Spanish is a DRAFT written by the build lane. No bilingual construction
// person has read it. Trade words to check first: retención (retainage),
// renuncia de gravamen (lien waiver), lista de pendientes (punch list), orden
// de cambio (change order), huella (fingerprint), partida (line).
//
// Pure: no React, no i18n runtime, no clock.
import type {
  PhotoPlaceSource,
  ProofLineLink,
  ProofOpenItem,
  ProofPeriodStartSource,
  ProofReason,
  ProofStrength,
  ProofItemKind,
  ProofSourceName,
  ProofWeatherSource,
} from '@/utils/proofPack/core';

export type ProofDocLang = 'en' | 'es';

export interface ProofDocCopy {
  titleLabel: string;
  eyebrowLabel: string;
  /** The two sentences the first page must carry, word for word. */
  whatThisIs: string;
  whatThisIsNot: string;
  labelMeaning: string;
  projectLabel: string;
  locationLabel: string;
  periodLabel: string;
  payDocumentLabel: string;
  madeOnLabel: string;
  madeOnPhoneClock: string;
  payAppName: (n: number) => string;
  invoiceName: (n: number) => string;
  periodRange: (from: string, to: string) => string;
  periodOpen: (to: string) => string;
  periodStart: Record<ProofPeriodStartSource, string>;

  billedHeadingLabel: string;
  billedSource: string;
  payAppRows: {
    originalContractSum: string; netChangeByCO: string; contractSumToDate: string;
    workThisPeriod: string; storedMaterial: string; totalCompletedAndStored: string; retainage: string;
    totalEarnedLessRetainage: string; lessPreviousCertificates: string; currentPaymentDue: string;
    balanceToFinish: string;
  };
  invoiceRows: { subtotal: string; tax: string; totalDue: string; amountPaid: string; retention: string; progress: string };
  payAppStyleNote: string;

  countsHeadingLabel: string;
  strengthLabel: Record<ProofStrength, string>;
  strengthRule: Record<ProofStrength, string>;
  reason: Record<ProofReason, string>;
  leftOutLine: (n: number) => string;
  nothingLeftOut: string;
  kindLabel: Record<ProofItemKind, string>;

  linesHeadingLabel: string;
  linesIntro: string;
  linesInvoiceIntro: string;
  lineColsLabel: { item: string; description: string; scheduled: string; thisPeriod: string; stored: string; records: string };
  lineLink: Record<ProofLineLink, string>;
  attachedCount: (n: number) => string;

  reportsHeadingLabel: string;
  reportsEmpty: string;
  reportStatus: { sent: string; draft: string };
  crewLine: (headcount: number, hours: number) => string;
  crewNone: string;
  weatherSource: Record<ProofWeatherSource, string>;
  weatherReadAt: (when: string) => string;
  workPerformedLabel: string;
  issuesLabel: string;
  materialsLabel: string;
  firstSaved: (when: string) => string;
  lastChanged: (when: string) => string;
  changedLater: string;
  reportPhotos: (n: number) => string;

  photosHeadingLabel: string;
  photosEmpty: string;
  photosIntro: string;
  photoTime: (when: string) => string;
  photoPlace: Record<PhotoPlaceSource, string>;
  photoAccuracy: (m: number) => string;
  photoNotUploaded: string;
  photoNotShown: string;
  photosListed: (n: number) => string;

  changeOrdersHeadingLabel: string;
  changeOrdersEmpty: string;
  changeOrderName: (n: number) => string;
  signedBy: (who: string) => string;
  signatureRecordTime: (when: string) => string;
  recordFingerprintStarts: (prefix: string) => string;

  punchHeadingLabel: string;
  punchEmpty: string;
  punchSealLine: (count: number, when: string) => string;
  punchSealSigner: (name: string, role: string) => string;
  punchSealFingerprint: (hash: string) => string;
  punchOpened: (day: string) => string;
  punchClosed: (day: string) => string;
  punchAfterPhoto: string;
  inspectionResult: { passed: string; failed: string };
  inspectionLine: (name: string, result: string) => string;
  ticketName: (n: number) => string;
  ticketCrew: (workers: number, hours: number) => string;
  ticketSigned: (who: string, when: string) => string;

  waiversHeadingLabel: string;
  waiversEmpty: string;
  waiversNotChecked: string;
  waiverThrough: (day: string) => string;
  waiverAmount: (money: string) => string;
  waiverSignedAt: (when: string) => string;
  waiverGapsHeadingLabel: string;
  waiverGapLine: (sub: string, day: string) => string;

  openHeadingLabel: string;
  openIntro: string;
  openItem: (item: ProofOpenItem) => string;
  sourceName: Record<ProofSourceName, string>;

  checkHeadingLabel: string;
  fingerprintLabel: string;
  checkCodeLabel: string;
  fingerprintCovers: string;
  fingerprintOnFile: (when: string) => string;
  fingerprintNotOnFile: string;
  howToCheck: string;
  fileFingerprintNote: string;

  notOnFile: string;
  dayUnknown: string;
  footer: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const EN: ProofDocCopy = {
  titleLabel: 'Proof of Work Package',
  eyebrowLabel: 'Record for One Pay Period',
  whatThisIs: 'This is a record of what MAGE ID holds for this pay period.',
  whatThisIsNot: 'It is not an inspection, an appraisal or a certification of the work.',
  labelMeaning: 'Each record below carries a label that says how the record is kept. A label describes the record. It says nothing about the quality of the work.',
  projectLabel: 'Project',
  locationLabel: 'Location',
  periodLabel: 'Pay Period',
  payDocumentLabel: 'Pay Document',
  madeOnLabel: 'Made On',
  madeOnPhoneClock: 'This is the time on the phone or computer that made the package.',
  payAppName: (n) => `AIA-style pay application number ${n}`,
  invoiceName: (n) => `Invoice number ${n}`,
  periodRange: (from, to) => `${from} to ${to}`,
  periodOpen: (to) => `Up to ${to}`,
  periodStart: {
    pay_app_period_from: 'The first and last day are the pay application’s own period dates.',
    day_after_prior_pay_app: 'The pay application states only a last day. The first day used here is the day after the prior pay application’s last day.',
    day_after_prior_invoice: 'An invoice has no billing period. The period used here runs from the day after the prior invoice to this invoice’s date.',
    open: 'No earlier pay document is on file, so the period has no first day. Records up to the last day are included.',
  },

  billedHeadingLabel: 'What Was Billed',
  billedSource: 'These figures are copied from the saved pay document. Nothing here is recalculated.',
  payAppRows: {
    originalContractSum: 'Original Contract Sum',
    netChangeByCO: 'Net Change by Change Orders',
    contractSumToDate: 'Contract Sum to Date',
    workThisPeriod: 'Work Completed This Period',
    storedMaterial: 'Materials Presently Stored',
    totalCompletedAndStored: 'Total Completed and Stored to Date',
    retainage: 'Retainage',
    totalEarnedLessRetainage: 'Total Earned Less Retainage',
    lessPreviousCertificates: 'Less Previous Certificates for Payment',
    currentPaymentDue: 'Current Payment Due',
    balanceToFinish: 'Balance to Finish, Including Retainage',
  },
  invoiceRows: {
    subtotal: 'Subtotal', tax: 'Tax', totalDue: 'Total Due', amountPaid: 'Amount Paid',
    retention: 'Retention Held', progress: 'Progress Billed',
  },
  payAppStyleNote: 'The pay application is an AIA-style draft made in MAGE ID. It is not a form published by The American Institute of Architects.',

  countsHeadingLabel: 'Records in This Package',
  strengthLabel: { sealed: 'Sealed', signed: 'Signed', locked: 'Locked', recorded: 'Recorded', stated: 'Stated' },
  strengthRule: {
    sealed: 'The server set the time, stored a fingerprint of the record, and the database refuses every later change.',
    signed: 'A named person signed, the server set the signing time, and the database keeps the signature as it was signed.',
    locked: 'The database refuses changes to the content of the record after a set point. No server-timed signature and no fingerprint is kept.',
    recorded: 'Saved in the app with a time from the phone’s clock. The account that made it can change it later, and no history of changes is kept.',
    stated: 'Typed in by the contractor, with nothing else behind it.',
  },
  reason: {
    punch_seal_record: 'The sealed final punch record. The server set the time and keeps the fingerprint shown.',
    punch_item_in_seal: 'Listed in the sealed final punch record.',
    co_client_signed: 'A signature record for this change order is on MAGE ID’s server. The server set its time and the database keeps it as it was signed. The record does not show whose device was used.',
    co_signed_not_confirmed: 'The change order’s own history says the client signed. The signature record on the server was not found or not read for this package.',
    waiver_sub_signed: 'Signed by the subcontractor on the signing page. The server set the time. The amount and dates on the waiver are not locked, and no fingerprint of the waiver is kept.',
    pay_app_pay_link: 'A pay link was made for this pay application. From that point the database refuses changes to its figures.',
    invoice_pay_link: 'A pay link was made for this invoice. An invoice can still be changed after it is saved, and no fingerprint is kept.',
    field_ticket_signed: 'Signed on the phone. The signing time is the phone’s clock. The database keeps the signed description, hours and quantities as signed.',
    pay_app_saved: 'Saved in the app. No pay link was made, so its figures are not locked.',
    invoice_saved: 'Saved in the app. An invoice can be changed after it is saved, and no fingerprint is kept.',
    daily_report: 'Filed in the app. A sent report is locked in the app only, and the same account can send it again. The only trace of a change is the last-changed time.',
    photo_phone: 'The time is the phone’s clock when the photo was added. A photo picked from the library carries the time it was picked.',
    punch_item_open: 'Saved in the app. It is not part of a sealed final punch record.',
    co_portal_no_signature: 'Approved in the client portal. No drawn signature is on file for this decision.',
    co_marked_approved: 'Marked approved by the contractor. No client signature is on file.',
    waiver_paper: 'Recorded by the contractor from a paper original. The app holds no signature from the subcontractor.',
    waiver_received: 'Marked received by the contractor. The app holds no signature.',
    inspection_typed: 'The result was typed on the permit by the contractor. The app holds no record from the inspector.',
  },
  leftOutLine: (n) => `${plural(n, 'item was', 'items were')} left out by the contractor.`,
  nothingLeftOut: 'The contractor left nothing out.',
  kindLabel: {
    daily_report: 'Daily Reports', photo: 'Photos', change_order: 'Change Orders', punch_seal: 'Sealed Final Punch',
    punch_item: 'Punch Items', inspection: 'Inspection Results', lien_waiver: 'Lien Waivers', field_ticket: 'Signed Field Tickets',
  },

  linesHeadingLabel: 'Schedule of Values Lines Billed This Period',
  linesIntro: 'A record attaches to a line only when the line and the record name the same schedule task, or when the line is a change order. MAGE ID does not match by date or by place, because a line has no date and no place.',
  linesInvoiceIntro: 'An invoice line carries no link to a schedule task, so no record can be attached to a single line. The records for the period are listed in the sections that follow.',
  lineColsLabel: { item: 'Item', description: 'Description', scheduled: 'Scheduled Value', thisPeriod: 'This Period', stored: 'Stored', records: 'Records Attached' },
  lineLink: {
    by_task: 'Attached through the schedule task this line names.',
    by_change_order: 'This line is a change order. Its approval record is attached.',
    no_task: 'No record is attached. This line names no schedule task.',
    task_no_records: 'No record is attached. No record in this period names this line’s schedule task.',
    not_linkable: 'No record can be attached to an invoice line.',
  },
  attachedCount: (n) => plural(n, 'record', 'records'),

  reportsHeadingLabel: 'Daily Reports in the Period',
  reportsEmpty: 'No daily report is on file for this period.',
  reportStatus: { sent: 'Sent', draft: 'Draft' },
  crewLine: (headcount, hours) => `${plural(headcount, 'person', 'people')} on site, ${hours} crew hours.`,
  crewNone: 'No crew count was entered.',
  weatherSource: {
    openweather: 'Weather read from OpenWeather by the app.',
    typed: 'Weather typed in by the contractor.',
    not_stated: 'No weather was entered.',
  },
  weatherReadAt: (when) => `Read at ${when}.`,
  workPerformedLabel: 'Work Performed',
  issuesLabel: 'Issues and Delays',
  materialsLabel: 'Materials Delivered',
  firstSaved: (when) => `First saved ${when}, by the phone’s clock.`,
  lastChanged: (when) => `Last changed ${when}.`,
  changedLater: 'This report was changed after the day it covers.',
  reportPhotos: (n) => `${plural(n, 'photo', 'photos')} on this report.`,

  photosHeadingLabel: 'Photos in the Period',
  photosEmpty: 'No photo is on file for this period.',
  photosIntro: 'Every photo’s time comes from the phone’s clock, and its place, when it has one, from the phone’s GPS. The server keeps no time of its own for a photo and no fingerprint of the file.',
  photoTime: (when) => `Phone clock: ${when}`,
  photoPlace: {
    phone_gps: 'Place from the phone’s GPS',
    typed: 'Place typed in',
    none: 'No place recorded',
  },
  photoAccuracy: (m) => `within about ${m} meters`,
  photoNotUploaded: 'This photo is on a phone only and could not be printed.',
  photoNotShown: 'The image could not be loaded for this copy.',
  photosListed: (n) => `${plural(n, 'more photo is', 'more photos are')} listed without an image.`,

  changeOrdersHeadingLabel: 'Change Orders Approved in or Before the Period',
  changeOrdersEmpty: 'No approved change order is on file up to the last day of this period.',
  changeOrderName: (n) => `Change order number ${n}`,
  signedBy: (who) => `Signer: ${who}`,
  signatureRecordTime: (when) => `Signature record time: ${when}, by the server’s clock.`,
  recordFingerprintStarts: (prefix) => `The signed record’s fingerprint starts ${prefix}.`,

  punchHeadingLabel: 'Punch, Inspection and Field Ticket Records',
  punchEmpty: 'No punch item, inspection result or signed field ticket is on file for this period.',
  punchSealLine: (count, when) => `Final punch of ${plural(count, 'item', 'items')}, sealed ${when} by the server’s clock.`,
  punchSealSigner: (name, role) => `Signer: ${name} (${role})`,
  punchSealFingerprint: (hash) => `Fingerprint: ${hash}`,
  punchOpened: (day) => `Opened ${day}.`,
  punchClosed: (day) => `Closed ${day}.`,
  punchAfterPhoto: 'An after photo is on file.',
  inspectionResult: { passed: 'Passed', failed: 'Failed' },
  inspectionLine: (name, result) => `${name}: ${result}`,
  ticketName: (n) => `Field ticket number ${n}`,
  ticketCrew: (workers, hours) => `${plural(workers, 'worker', 'workers')}, ${hours} hours.`,
  ticketSigned: (who, when) => `Signer: ${who}. Signed ${when}, by the phone’s clock.`,

  waiversHeadingLabel: 'Lien Waivers on File',
  waiversEmpty: 'No lien waiver with a through date in this period is on file.',
  waiversNotChecked: 'Lien waivers could not be read when this package was made, so this section was not checked.',
  waiverThrough: (day) => `Through ${day}.`,
  waiverAmount: (money) => `Amount on the waiver: ${money}.`,
  waiverSignedAt: (when) => `Signed ${when}.`,
  waiverGapsHeadingLabel: 'Requested and Not Signed',
  waiverGapLine: (sub, day) => `${sub}, through ${day}.`,

  openHeadingLabel: 'Open Items',
  openIntro: 'These are things a reader may ask about that MAGE ID does not hold or did not check.',
  openItem: (i) => {
    const n = i.n ?? 0;
    const of = i.of ?? 0;
    switch (i.code) {
      case 'period_start_open': return 'The pay period has no first day on file.';
      case 'invoice_has_no_period': return 'An invoice states no billing period. The period in this package is worked out from invoice dates.';
      case 'pay_not_locked': return 'The pay document is not locked. It can still be changed in the app.';
      case 'lines_without_records': return `${n} of ${plural(of, 'billed line has', 'billed lines have')} no record attached.`;
      case 'days_without_report': return `${n} of ${plural(of, 'day', 'days')} in the period have no daily report.`;
      case 'photos_without_place': return `${n} of ${plural(of, 'photo has', 'photos have')} no place from the phone’s GPS.`;
      case 'photos_not_uploaded': return `${n} of ${plural(of, 'photo is', 'photos are')} on a phone only.`;
      case 'reports_changed_later': return `${plural(n, 'daily report was', 'daily reports were')} changed after the day covered.`;
      case 'change_orders_not_signed': return `${n} of ${plural(of, 'approved change order has', 'approved change orders have')} no client signature on file.`;
      case 'no_change_orders': return 'The pay application shows a net change by change orders, and no approved change order is on file for it.';
      case 'no_lien_waivers': return 'No lien waiver with a through date in this period is on file.';
      case 'waivers_requested_unsigned': return `${plural(n, 'lien waiver was', 'lien waivers were')} asked for and not signed.`;
      case 'waiver_coverage_not_checked': return 'MAGE ID did not check whether every subcontractor and supplier paid in this period gave a waiver.';
      case 'no_inspection_signoff': return 'MAGE ID holds no sign-off from a building inspector, an architect or a third-party inspector.';
      case 'photo_files_not_fingerprinted': return 'Photo files are not fingerprinted. The package fingerprint covers each photo’s record, not the image.';
      case 'no_punch_seal': return 'No sealed final punch record is on file for this project.';
      case 'signer_identity_not_checked': return 'A Signed record shows that a signature was recorded on the contractor’s MAGE ID account. MAGE ID does not check the identity of the person who signed.';
      case 'source_not_loaded': return `${i.source ? EN.sourceName[i.source] : 'A source'} could not be read when this package was made, so that part was not checked.`;
      case 'items_left_out': return `${plural(n, 'item was', 'items were')} left out by the contractor.`;
      default: return '';
    }
  },
  sourceName: { photos: 'Photos', daily_reports: 'Daily reports', lien_waivers: 'Lien waivers', punch_seal: 'The sealed final punch record', change_order_signatures: 'Change order signature records' },

  checkHeadingLabel: 'How to Check This Document',
  fingerprintLabel: 'Fingerprint',
  checkCodeLabel: 'Check Code',
  fingerprintCovers: 'The fingerprint is a SHA-256 value worked out from every figure, date, label and count in this package. If any of them changes, the fingerprint changes. It does not cover the photo files or the layout of this file.',
  fingerprintOnFile: (when) => `MAGE ID’s server put this fingerprint on file on ${when}. That time is the server’s clock, and the record cannot be changed afterwards.`,
  fingerprintNotOnFile: 'No fingerprint is on file for this copy. It cannot be checked later.',
  howToCheck: 'To check this copy, ask the contractor to open this package in MAGE ID. The app works the fingerprint out again and compares it with the one on file. The check code and the fingerprint on their screen should equal the ones printed here.',
  fileFingerprintNote: 'When the package is made in the phone app, MAGE ID also puts a fingerprint of the file itself on file. The contractor can check a copy of the file against it in the app.',

  notOnFile: 'Not on file',
  dayUnknown: 'No date',
  footer: 'Made with MAGE ID. This package lists records. It is not an inspection, an appraisal or a certification of the work.',
};

const plES = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const ES: ProofDocCopy = {
  titleLabel: 'Paquete de respaldo de obra',
  eyebrowLabel: 'Registro de un periodo de pago',
  whatThisIs: 'Este es un registro de lo que MAGE ID guarda de este periodo de pago.',
  whatThisIsNot: 'No es una inspección, un avalúo ni una certificación de la obra.',
  labelMeaning: 'Cada registro lleva una etiqueta que dice cómo se guarda. La etiqueta describe el registro. No dice nada sobre la calidad de la obra.',
  projectLabel: 'Proyecto',
  locationLabel: 'Ubicación',
  periodLabel: 'Periodo de pago',
  payDocumentLabel: 'Documento de pago',
  madeOnLabel: 'Hecho el',
  madeOnPhoneClock: 'Esta es la hora del teléfono o la computadora que hizo el paquete.',
  payAppName: (n) => `Solicitud de pago estilo AIA número ${n}`,
  invoiceName: (n) => `Factura número ${n}`,
  periodRange: (from, to) => `${from} a ${to}`,
  periodOpen: (to) => `Hasta ${to}`,
  periodStart: {
    pay_app_period_from: 'El primer y el último día son las fechas del periodo de la propia solicitud de pago.',
    day_after_prior_pay_app: 'La solicitud de pago solo indica un último día. El primer día usado aquí es el día siguiente al último día de la solicitud anterior.',
    day_after_prior_invoice: 'Una factura no tiene periodo de cobro. El periodo usado aquí va del día siguiente a la factura anterior a la fecha de esta factura.',
    open: 'No hay un documento de pago anterior, así que el periodo no tiene primer día. Se incluyen los registros hasta el último día.',
  },

  billedHeadingLabel: 'Lo que se cobró',
  billedSource: 'Estas cifras se copian del documento de pago guardado. Aquí no se recalcula nada.',
  payAppRows: {
    originalContractSum: 'Monto original del contrato',
    netChangeByCO: 'Cambio neto por órdenes de cambio',
    contractSumToDate: 'Monto del contrato a la fecha',
    workThisPeriod: 'Trabajo completado en este periodo',
    storedMaterial: 'Materiales almacenados',
    totalCompletedAndStored: 'Total completado y almacenado a la fecha',
    retainage: 'Retención',
    totalEarnedLessRetainage: 'Total ganado menos retención',
    lessPreviousCertificates: 'Menos constancias de pago anteriores',
    currentPaymentDue: 'Pago actual a cobrar',
    balanceToFinish: 'Saldo por terminar, con retención',
  },
  invoiceRows: {
    subtotal: 'Subtotal', tax: 'Impuesto', totalDue: 'Total a pagar', amountPaid: 'Monto pagado',
    retention: 'Retención', progress: 'Avance cobrado',
  },
  payAppStyleNote: 'La solicitud de pago es un borrador estilo AIA hecho en MAGE ID. No es un formulario publicado por The American Institute of Architects.',

  countsHeadingLabel: 'Registros en este paquete',
  strengthLabel: { sealed: 'Sellado', signed: 'Firmado', locked: 'Bloqueado', recorded: 'Registrado', stated: 'Declarado' },
  strengthRule: {
    sealed: 'El servidor puso la hora, guardó una huella del registro y la base de datos rechaza todo cambio posterior.',
    signed: 'Una persona con nombre firmó, el servidor puso la hora de la firma y la base de datos conserva la firma tal como se firmó.',
    locked: 'La base de datos rechaza cambios al contenido del registro a partir de cierto punto. No se guarda firma con hora del servidor ni huella.',
    recorded: 'Guardado en la app con la hora del reloj del teléfono. La cuenta que lo hizo puede cambiarlo después y no se guarda historial de cambios.',
    stated: 'Escrito por el contratista, sin nada más que lo respalde.',
  },
  reason: {
    punch_seal_record: 'El registro sellado de la lista final de pendientes. El servidor puso la hora y guarda la huella que se muestra.',
    punch_item_in_seal: 'Incluido en el registro sellado de la lista final de pendientes.',
    co_client_signed: 'Hay un registro de firma de esta orden de cambio en el servidor de MAGE ID. El servidor puso la hora y la base de datos lo conserva tal como se firmó. El registro no muestra de quién era el dispositivo.',
    co_signed_not_confirmed: 'El historial de la orden de cambio dice que el cliente firmó. El registro de firma en el servidor no se encontró o no se leyó para este paquete.',
    waiver_sub_signed: 'Firmada por el subcontratista en la página de firma. El servidor puso la hora. El monto y las fechas de la renuncia no están bloqueados y no se guarda huella de la renuncia.',
    pay_app_pay_link: 'Se creó un enlace de pago para esta solicitud. Desde ese momento la base de datos rechaza cambios a sus cifras.',
    invoice_pay_link: 'Se creó un enlace de pago para esta factura. Una factura todavía puede cambiarse después de guardarla y no se guarda huella.',
    field_ticket_signed: 'Firmado en el teléfono. La hora de la firma es la del reloj del teléfono. La base de datos conserva la descripción, las horas y las cantidades tal como se firmaron.',
    pay_app_saved: 'Guardada en la app. No se creó enlace de pago, así que sus cifras no están bloqueadas.',
    invoice_saved: 'Guardada en la app. Una factura puede cambiarse después de guardarla y no se guarda huella.',
    daily_report: 'Presentado en la app. Un reporte enviado se bloquea solo en la app y la misma cuenta puede enviarlo otra vez. El único rastro de un cambio es la hora del último cambio.',
    photo_phone: 'La hora es la del reloj del teléfono cuando se agregó la foto. Una foto elegida de la galería lleva la hora en que se eligió.',
    punch_item_open: 'Guardado en la app. No forma parte de un registro sellado de la lista final de pendientes.',
    co_portal_no_signature: 'Aprobada en el portal del cliente. No hay firma dibujada de esta decisión.',
    co_marked_approved: 'Marcada como aprobada por el contratista. No hay firma del cliente.',
    waiver_paper: 'Anotada por el contratista a partir de un original en papel. La app no guarda firma del subcontratista.',
    waiver_received: 'Marcada como recibida por el contratista. La app no guarda firma.',
    inspection_typed: 'El contratista escribió el resultado en el permiso. La app no guarda ningún registro del inspector.',
  },
  leftOutLine: (n) => (n === 1 ? 'El contratista dejó fuera 1 registro.' : `El contratista dejó fuera ${n} registros.`),
  nothingLeftOut: 'El contratista no dejó nada fuera.',
  kindLabel: {
    daily_report: 'Reportes diarios', photo: 'Fotos', change_order: 'Órdenes de cambio', punch_seal: 'Lista final de pendientes sellada',
    punch_item: 'Pendientes', inspection: 'Resultados de inspección', lien_waiver: 'Renuncias de gravamen', field_ticket: 'Boletas de campo firmadas',
  },

  linesHeadingLabel: 'Partidas cobradas en este periodo',
  linesIntro: 'Un registro se une a una partida solo cuando la partida y el registro nombran la misma tarea del cronograma, o cuando la partida es una orden de cambio. MAGE ID no une por fecha ni por lugar, porque una partida no tiene fecha ni lugar.',
  linesInvoiceIntro: 'Un renglón de factura no lleva vínculo con una tarea del cronograma, así que ningún registro puede unirse a un solo renglón. Los registros del periodo aparecen en las secciones que siguen.',
  lineColsLabel: { item: 'Partida', description: 'Descripción', scheduled: 'Valor programado', thisPeriod: 'Este periodo', stored: 'Almacenado', records: 'Registros unidos' },
  lineLink: {
    by_task: 'Unidos por la tarea del cronograma que nombra esta partida.',
    by_change_order: 'Esta partida es una orden de cambio. Se une su registro de aprobación.',
    no_task: 'Ningún registro unido. Esta partida no nombra una tarea del cronograma.',
    task_no_records: 'Ningún registro unido. Ningún registro de este periodo nombra la tarea de esta partida.',
    not_linkable: 'Ningún registro puede unirse a un renglón de factura.',
  },
  attachedCount: (n) => plES(n, 'registro', 'registros'),

  reportsHeadingLabel: 'Reportes diarios del periodo',
  reportsEmpty: 'No hay reportes diarios de este periodo.',
  reportStatus: { sent: 'Enviado', draft: 'Borrador' },
  crewLine: (headcount, hours) => `${plES(headcount, 'persona', 'personas')} en la obra, ${hours} horas de cuadrilla.`,
  crewNone: 'No se anotó el número de personas.',
  weatherSource: {
    openweather: 'Clima leído de OpenWeather por la app.',
    typed: 'Clima escrito por el contratista.',
    not_stated: 'No se anotó el clima.',
  },
  weatherReadAt: (when) => `Leído a las ${when}.`,
  workPerformedLabel: 'Trabajo realizado',
  issuesLabel: 'Problemas y retrasos',
  materialsLabel: 'Materiales entregados',
  firstSaved: (when) => `Guardado por primera vez el ${when}, según el reloj del teléfono.`,
  lastChanged: (when) => `Último cambio el ${when}.`,
  changedLater: 'Este reporte se cambió después del día que cubre.',
  reportPhotos: (n) => `${plES(n, 'foto', 'fotos')} en este reporte.`,

  photosHeadingLabel: 'Fotos del periodo',
  photosEmpty: 'No hay fotos de este periodo.',
  photosIntro: 'La hora de cada foto viene del reloj del teléfono y su lugar, cuando lo tiene, del GPS del teléfono. El servidor no guarda una hora propia para una foto ni una huella del archivo.',
  photoTime: (when) => `Reloj del teléfono: ${when}`,
  photoPlace: {
    phone_gps: 'Lugar tomado del GPS del teléfono',
    typed: 'Lugar escrito a mano',
    none: 'Sin lugar anotado',
  },
  photoAccuracy: (m) => `con unos ${m} metros de margen`,
  photoNotUploaded: 'Esta foto está solo en un teléfono y no se pudo imprimir.',
  photoNotShown: 'La imagen no se pudo cargar para esta copia.',
  photosListed: (n) => (n === 1 ? '1 foto más aparece sin imagen.' : `${n} fotos más aparecen sin imagen.`),

  changeOrdersHeadingLabel: 'Órdenes de cambio aprobadas en el periodo o antes',
  changeOrdersEmpty: 'No hay órdenes de cambio aprobadas hasta el último día de este periodo.',
  changeOrderName: (n) => `Orden de cambio número ${n}`,
  signedBy: (who) => `Firmante: ${who}`,
  signatureRecordTime: (when) => `Hora del registro de firma: ${when}, según el reloj del servidor.`,
  recordFingerprintStarts: (prefix) => `La huella del registro firmado empieza con ${prefix}.`,

  punchHeadingLabel: 'Pendientes, inspecciones y boletas de campo',
  punchEmpty: 'No hay pendientes, resultados de inspección ni boletas de campo firmadas de este periodo.',
  punchSealLine: (count, when) => `Lista final de ${plES(count, 'pendiente', 'pendientes')}, sellada el ${when} según el reloj del servidor.`,
  punchSealSigner: (name, role) => `Firmante: ${name} (${role})`,
  punchSealFingerprint: (hash) => `Huella: ${hash}`,
  punchOpened: (day) => `Abierto el ${day}.`,
  punchClosed: (day) => `Cerrado el ${day}.`,
  punchAfterPhoto: 'Hay una foto de después.',
  inspectionResult: { passed: 'Aprobada', failed: 'No aprobada' },
  inspectionLine: (name, result) => `${name}: ${result}`,
  ticketName: (n) => `Boleta de campo número ${n}`,
  ticketCrew: (workers, hours) => `${plES(workers, 'trabajador', 'trabajadores')}, ${hours} horas.`,
  ticketSigned: (who, when) => `Firmante: ${who}. Firmada el ${when}, según el reloj del teléfono.`,

  waiversHeadingLabel: 'Renuncias de gravamen en archivo',
  waiversEmpty: 'No hay renuncias de gravamen con fecha de corte en este periodo.',
  waiversNotChecked: 'Las renuncias de gravamen no se pudieron leer al hacer este paquete, así que esta sección no se revisó.',
  waiverThrough: (day) => `Hasta el ${day}.`,
  waiverAmount: (money) => `Monto en la renuncia: ${money}.`,
  waiverSignedAt: (when) => `Firmada el ${when}.`,
  waiverGapsHeadingLabel: 'Pedidas y sin firmar',
  waiverGapLine: (sub, day) => `${sub}, hasta el ${day}.`,

  openHeadingLabel: 'Puntos abiertos',
  openIntro: 'Estas son cosas que un lector puede preguntar y que MAGE ID no guarda o no revisó.',
  openItem: (i) => {
    const n = i.n ?? 0;
    const of = i.of ?? 0;
    switch (i.code) {
      case 'period_start_open': return 'El periodo de pago no tiene primer día en archivo.';
      case 'invoice_has_no_period': return 'Una factura no indica periodo de cobro. El periodo de este paquete se calcula con las fechas de las facturas.';
      case 'pay_not_locked': return 'El documento de pago no está bloqueado. Todavía puede cambiarse en la app.';
      case 'lines_without_records': return `${n} de ${plES(of, 'partida cobrada no tiene', 'partidas cobradas no tienen')} registros unidos.`;
      case 'days_without_report': return `${n} de ${plES(of, 'día', 'días')} del periodo no tienen reporte diario.`;
      case 'photos_without_place': return `${n} de ${plES(of, 'foto no tiene', 'fotos no tienen')} lugar del GPS del teléfono.`;
      case 'photos_not_uploaded': return `${n} de ${plES(of, 'foto está', 'fotos están')} solo en un teléfono.`;
      case 'reports_changed_later': return n === 1 ? '1 reporte diario se cambió después del día que cubre.' : `${n} reportes diarios se cambiaron después del día que cubren.`;
      case 'change_orders_not_signed': return `${n} de ${plES(of, 'orden de cambio aprobada no tiene', 'órdenes de cambio aprobadas no tienen')} firma del cliente.`;
      case 'no_change_orders': return 'La solicitud de pago muestra un cambio neto por órdenes de cambio y no hay una orden de cambio aprobada que lo respalde.';
      case 'no_lien_waivers': return 'No hay renuncias de gravamen con fecha de corte en este periodo.';
      case 'waivers_requested_unsigned': return n === 1 ? '1 renuncia de gravamen se pidió y no se firmó.' : `${n} renuncias de gravamen se pidieron y no se firmaron.`;
      case 'waiver_coverage_not_checked': return 'MAGE ID no revisó si cada subcontratista y proveedor pagado en este periodo entregó una renuncia.';
      case 'no_inspection_signoff': return 'MAGE ID no guarda una aprobación de un inspector de obras, un arquitecto ni un inspector externo.';
      case 'photo_files_not_fingerprinted': return 'Los archivos de las fotos no llevan huella. La huella del paquete cubre el registro de cada foto, no la imagen.';
      case 'no_punch_seal': return 'No hay un registro sellado de la lista final de pendientes para este proyecto.';
      case 'signer_identity_not_checked': return 'Un registro Firmado muestra que se guardó una firma en la cuenta de MAGE ID del contratista. MAGE ID no revisa la identidad de la persona que firmó.';
      case 'source_not_loaded': return `${i.source ? ES.sourceName[i.source] : 'Una fuente'} no se pudo leer al hacer este paquete, así que esa parte no se revisó.`;
      case 'items_left_out': return n === 1 ? 'El contratista dejó fuera 1 registro.' : `El contratista dejó fuera ${n} registros.`;
      default: return '';
    }
  },
  sourceName: { photos: 'Las fotos', daily_reports: 'Los reportes diarios', lien_waivers: 'Las renuncias de gravamen', punch_seal: 'El registro sellado de la lista final de pendientes', change_order_signatures: 'Los registros de firma de órdenes de cambio' },

  checkHeadingLabel: 'Cómo revisar este documento',
  fingerprintLabel: 'Huella',
  checkCodeLabel: 'Código de revisión',
  fingerprintCovers: 'La huella es un valor SHA-256 calculado con cada cifra, fecha, etiqueta y conteo de este paquete. Si alguno cambia, la huella cambia. No cubre los archivos de las fotos ni el diseño de este archivo.',
  fingerprintOnFile: (when) => `El servidor de MAGE ID archivó esta huella el ${when}. Esa hora es la del reloj del servidor y el registro no puede cambiarse después.`,
  fingerprintNotOnFile: 'No hay una huella archivada para esta copia. No se podrá revisar después.',
  howToCheck: 'Para revisar esta copia, pide al contratista que abra este paquete en MAGE ID. La app calcula la huella otra vez y la compara con la archivada. El código de revisión y la huella en su pantalla deben ser iguales a los impresos aquí.',
  fileFingerprintNote: 'Cuando el paquete se hace en la app del teléfono, MAGE ID también archiva una huella del archivo. El contratista puede revisar una copia del archivo contra ella en la app.',

  notOnFile: 'No consta',
  dayUnknown: 'Sin fecha',
  footer: 'Hecho con MAGE ID. Este paquete enumera registros. No es una inspección, un avalúo ni una certificación de la obra.',
};

export const PROOF_DOC_COPY: Record<ProofDocLang, ProofDocCopy> = { en: EN, es: ES };

export function proofDocCopy(lang: ProofDocLang): ProofDocCopy {
  return PROOF_DOC_COPY[lang] ?? EN;
}
