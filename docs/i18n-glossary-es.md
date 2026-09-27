# MAGE ID — US-construction Spanish glossary (es)

Status: REVIEWED DRAFT. The terms below are sourced; the items marked **[confirm]**
still need a bilingual construction person to confirm them before Phase 1 ships.

Companion to [`docs/I18N.md`](./I18N.md).

- Every Spanish catalog entry must follow this glossary. `scripts/validate-i18n.ts`
  lints for the forbidden forms (§6).
- The AI reply-language rule is given a condensed copy of §3 (I18N.md §7).

Sources:

- OSHA and Oregon OSHA English–Spanish dictionaries; OSHA 3071-SP.
- CSLB Spanish mechanics' lien guide; TDI workers' comp (Spanish); Texas Law Help
  "Contratar a un contratista"; NYC DOB Spanish permit and CO guides.
- Procore Spanish glossary and product; CPWR, WA Construction Center and Builders
  Mutual Spanish toolbox talks.
- Microsoft es-US and es-MX style guides; Mexican trade sources (IDC Online,
  CAPUFE manual).
- The app's own enums (`types/index.ts`) and field screens.

---

## 1. Dialect and voice (the tú / usted decision)

**Locale:** tag `es` (formatting as es-US, §7). Write **neutral Latin American
Spanish that leans Mexican**, which is who is actually on US jobsites.

- **Never** use Spain forms: *vosotros*, *hormigón*, *fontanero*, *ordenador*,
  *móvil*, *vale*, *pulse*.
- **Never** use *coger*. Microsoft's es-US guide flags it as offensive in Latin
  America.
- **Write** *concreto*, *plomero/plomería*, *celular*, *computadora*, *toque*.
- Keep slang out of the UI (*jale, chamba, troca, lonche*). Search, voice and AI
  must still **understand** it (§5).

| Audience | Voice | Why |
|---|---|---|
| **In-app UI, for everyone** (foreman, crew lead, owner, office) | **tú**, but most strings have **no pronoun at all**: infinitives and imperatives such as *Guardar*, *Marcar entrada*, *Enviar plan* | Microsoft's es-US and es-MX software guides both recommend *tú* and prefer the impersonal form over repeating *tú*. Tú strings are shorter (tab bar), fit the plain voice in `docs/VOICE.md`, and everyday US and Mexican apps use tú with a 50-year-old foreman without offence. |
| **Anything sent outside the account**: a sub's lineup text, sub portal, homeowner portal, emails, estimates, invoices, CO approval requests | **usted** | The recipient is another company or a paying client, not a user of the tool. US public-sector Spanish aimed at the same people (TDI, CSLB, Texas Law Help) uses usted throughout. |
| **Contracts, lien waivers, legal notices** | **Third person with defined terms**: *el Propietario*, *el Contratista*, *el Subcontratista*. Usted in notices. | The Spanish is a **translation**, never the controlling statutory text (I18N.md §9). A human legal translator only. |
| **AI answers** | tú in the app; **usted** whenever the AI drafts something to be sent | Stated in the relay rule. |

Enforced by the validator: tú forms in `outbound.*`, `email.*` and `portal.*` keys
fail, and usted forms in in-app keys fail.

---

## 2. Collisions: places where one Spanish word would mean two things

Pick a different word for each meaning. These were verified against the sources.

| English (app meaning) | USE | DON'T USE | Why |
|---|---|---|---|
| **Crew** | **cuadrilla** | ~~equipo~~ | *equipo* is also equipment, and the app has both. Procore es uses *Cuadrilla*. |
| Equipment | equipo / maquinaria y equipo | | |
| **Estimate** | **estimado** (UI); *presupuesto* or *cotización* in homeowner documents | ~~estimación~~ | In Mexican construction, an *estimación de obra* is the periodic progress-billing request, i.e. the **pay app**. Procore's Spanish product gets this wrong; don't copy it. |
| Budget | presupuesto | | In the UI, *presupuesto* is reserved for budget because estimate uses *estimado*. |
| Pay app / progress billing | **solicitud de pago** (tooltip: "En México: estimación") | ~~aplicación~~ | A "pay application" is not an app. |
| **Retainage** | **retención** | | Keep *retención* for retainage only. |
| **Lien waiver** | **liberación de gravamen** | ~~renuncia al derecho de retención~~ | CSLB's own Spanish. It avoids clashing with *retención*. |
| **Punch item / punch list** | **pendiente / Pendientes (punch list)** | | |
| Status "pending" (CO, waiver, invite) | **En espera** / **Por aprobar** | ~~Pendiente~~ | *pendiente* already means a punch item. |
| **Markup** | **recargo** (% de recargo) | ~~sobreprecio~~ | *sobreprecio* reads as overcharging. |
| Backcharge | **cargo al subcontratista** | ~~recargo~~ | Procore uses *recargo* for both meanings; we don't. |
| Material delivery | **entrega de material** | | |
| Handover / closeout | **entrega de la obra / cierre** | | |
| Submittal | **submittal** | ~~entrega~~ | |
| Account-owner role (`owner`) | **Titular de la cuenta** | ~~Propietario~~ | *Propietario* is the property owner. |
| Property owner (client) | **Propietario** (formal) / *dueño* (field) | | |
| **Schedule** (feature) | **Cronograma** | ~~Programa~~ | *programa* is also a software program. *Programa de obra* is fine inside contracts. |
| **Daily report** | **Reporte diario** (UI); *Informe diario de obra* (PDF title) | ~~bitácora~~ | In Mexico, a *bitácora de obra* is a **legally binding** site log. Calling our report that claims a legal status it doesn't have. |
| Deposit (upfront) | **anticipo** | ~~depósito~~ in contracts | *depósito* reads as a bank deposit. |

**Reviewer changes from the research draft:**

- **UI name for the daily report:** *Reporte diario*, not *informe*. *Reporte* is
  the US and Mexican field word; *informe* stays for the formal PDF title.
- **UI verbs:** *Agregar*, not *Añadir* (the Mexican and US norm, and the es-MX
  guide's choice), and *Eliminar* for delete (see §4).

---

## 3. Glossary

Columns: **English** as the app uses it → **Field / crew term** (what they say;
accept as input) → **Formal / UI term** (what we write) → notes.

### 3.1 People and places

| English | Field term | Formal / UI term | Notes |
|---|---|---|---|
| Job / project | la obra, el proyecto | **Proyecto** (record), **obra** (site) | Lists say *Proyectos*; the site is *en la obra*. |
| Jobsite | la obra | sitio de la obra / sitio de trabajo | OSHA uses *sitio de trabajo*. |
| General contractor (GC) | el contratista, el general | **Contratista general** | In CA lien text use CSLB's *contratista principal*. |
| Subcontractor / sub | el sub | **Subcontratista** | |
| Owner (client) | el dueño | **Propietario** | |
| Homeowner | el dueño de la casa, el cliente | **propietario de la vivienda** | |
| Owner's rep / lender / architect | | representante del propietario / prestamista / arquitecto | |
| Foreman | el foreman, mayordomo, encargado | **Capataz** | Accept *mayordomo* as input only; outside northern Mexico and Texas it means butler. |
| Crew lead | jefe de cuadrilla | **Líder de cuadrilla** | |
| Crew | la cuadrilla | **Cuadrilla** | See §2. |
| Superintendent | el super | **Superintendente** | |
| Laborer / helper | trabajador / ayudante | **Trabajador(a) / Ayudante** | Avoid *peón*, which can read as demeaning. |
| Worker / employee / employer | trabajador / el patrón | empleado / **empleador** | |
| Supplier / vendor | | **Proveedor** | |
| Inspector | el inspector | **Inspector(a)** | |
| Building department | la ciudad, el condado | **departamento de construcción** | Agency names stay in English: "Department of Buildings (DOB)" (as in NYC DOB's own Spanish guide). |

### 3.2 Money and office

| English | Field term | Formal / UI term | Notes |
|---|---|---|---|
| Estimate | el estimado | **Estimado** (UI); *presupuesto / cotización* (homeowner) | Never *estimación* (§2). |
| Quote / Quick Quote | cotización | **Cotización** | |
| Bid (sub's price) | la cotización, el bid | **Oferta** | Bidding process = *licitación*; bid package = *paquete de licitación*; bid leveling = *comparación de ofertas*. |
| Proposal | | **Propuesta** | |
| Contract | | **Contrato** | Fixed = *precio fijo* (MX *precio alzado*); cost-plus = *costo más honorarios*; GMP = *precio máximo garantizado (GMP)*; open book = *a libro abierto*. |
| T&M | por administración | **tiempo y materiales (T&M)** | |
| Change order | el change order, un cambio | **Orden de cambio (change order)** | Statuses: *borrador / enviada / en revisión / aprobada / rechazada / revisada / anulada*. |
| Change event | | **Evento de cambio** | Not Procore's *evento extraordinario*. |
| Invoice | | **Factura** | Statuses: *borrador / enviada / pago parcial / pagada / vencida*. |
| Payment terms | | *a 30 días* (net 30); *pagadero al recibir* | Methods: *cheque, transferencia ACH, tarjeta de crédito, efectivo*. |
| Pay app / AIA G702–G703 | la estimación (MX) | **Solicitud de pago (AIA G702)** / **Hoja de continuación (AIA G703)** | Keep the form numbers. Never translate AIA's copyrighted form text. |
| Progress billing | | **facturación por avance** | |
| Schedule of values | catálogo de conceptos (MX) | **desglose de valores (SOV)** | Mention *catálogo de conceptos* in help text. |
| Retainage | lo retenido | **Retención** | MX public works: *fondo de garantía*. |
| Lien | | **gravamen** | CSLB: *gravamen de constructor*. |
| Lien waiver | | **Liberación de gravamen** | *condicional / incondicional*; *por pago parcial / por pago final*; e.g. *Liberación condicional por pago final*. Preliminary notice = *notificación preliminar*. |
| Deposit | el depósito, anticipo | **Anticipo** | |
| Markup | el markup | **Recargo** | |
| Margin / profit / overhead | margen / ganancia | **margen / utilidad / gastos generales** | MX: *indirectos*. |
| Labor / materials / equipment | | **mano de obra / materiales / maquinaria y equipo** | |
| Allowance / selections | | **monto asignado / selecciones** | |
| Contingency | imprevistos | **Contingencia** (office), *imprevistos* (homeowner) | |
| Job costing / WIP / cash flow | | **costos de la obra / reporte de obras en proceso (WIP) / flujo de efectivo** | |
| Commitment / subcontract / PO | | **compromiso / subcontrato / orden de compra** | |
| Buyout | | **contratación de subs y compras (buyout)** | |
| Backcharge | backcharge | **cargo al subcontratista** | |
| Lender draw | | **desembolso** | |
| Prequal | | **precalificación** | |
| Insurance / COI | aseguranza (input only) | **seguro / certificado de seguro (COI)** | Statuses: *vigente / por vencer / vencido*. |
| Workers' comp | el workers' comp | **seguro de compensación para trabajadores** | TDI's exact phrase. |
| General liability | | **seguro de responsabilidad civil general** | |

### 3.3 Schedule and documents

| English | Field term | Formal / UI term | Notes |
|---|---|---|---|
| Schedule | el schedule, el calendario | **Cronograma** | The day view is *calendario*. |
| Critical path / float / baseline / milestone / task | | **ruta crítica / holgura / línea base / hito / tarea** | |
| Dependencies FS/SS/FF/SF | | **fin-comienzo / comienzo-comienzo / fin-fin / comienzo-fin** | Abbreviations FC/CC/FF/CF **[confirm]** against Spanish MS Project before shipping. |
| Look-ahead | lo que viene | **Programa de 3 semanas** | |
| Delay / weather delay | | **retraso / retraso por clima** | |
| Tomorrow's lineup | el plan de mañana | **Plan de mañana** | SMS to a sub (usted): *"Plan para mañana — {obra}"*. |
| Drawings / sheet / specs | los planos | **planos / hoja / especificaciones** | |
| RFI | RFI | **Solicitud de información (RFI)** | |
| Submittal | el submittal | **Submittal** (entrega para aprobación) | |
| Daily report | el reporte | **Reporte diario** (UI), *Informe diario de obra* (PDF) | Labels: *número de trabajadores, horas trabajadas, materiales recibidos, avance del trabajo, "No hubo actividad en la obra hoy"*. Weather = *Clima*. |
| Photo / photo walk | | **Foto / Recorrido de fotos** | |
| Punch list / item | los pendientes | **Lista de pendientes / Pendiente** | Statuses: *abierto / en proceso / listo para revisión / cerrado*. |
| Inspection | | **Inspección** | Results: *programada / aprobada / no aprobada / cancelada*. |
| Permit | | **Permiso** (de construcción) | *eléctrico, plomería, mecánico, demolición, nivelación, incendios, ocupación, inspección especial, trabajos en caliente, corte de servicios, fuera de horario*. |
| Certificate of occupancy | | **Certificado de ocupación** (provisional = temporary) | NYC DOB's Spanish. |
| Substantial completion | | **terminación sustancial** | |
| Closeout / binder | | **cierre de obra / carpeta de cierre** | MX: *entrega-recepción*. |
| Warranty / warranty walk | | **garantía / recorrido de garantía** | |
| OAC meeting | junta | **reunión OAC** | *reunión* is the neutral word. |
| Takeoff | el takeoff | **Cuantificación (takeoff)** | MX: *números generadores*. |
| Scope / scope gap | | **alcance / faltante de alcance** | |
| Work order | | **orden de trabajo** | |
| Field ticket / T&M ticket | | **Boleta de trabajo (T&M)** | |
| Delivery | la entrega | **Entrega de material** | Supplier = *proveedor*; received by = *recibido por*; promised date = *fecha prometida*; what was wrong = *qué llegó mal*; delivery ticket = *remisión*. |

### 3.4 Time clock

| English | Field term | Formal / UI term | Notes |
|---|---|---|---|
| Clock in / out | checar / ponchar | **Marcar entrada / Marcar salida** | Accept *checar* and *ponchar* as input. |
| Time card / timesheet | hoja de horas | **Tarjeta de horas** | |
| Overtime | el overtime, tiempo extra | **Horas extra** (short: *H. extra*) | Never "OT". |
| Break / lunch / shift | descanso / comida | **Descanso / Comida / Turno** | |
| Payroll / rates / prevailing wage / per diem | | **nómina / tarifas de mano de obra / salario prevaleciente / viáticos** | |

### 3.5 Safety

| English | Field term | Formal / UI term | Notes |
|---|---|---|---|
| JHA | el JHA | **Análisis de riesgos del trabajo (JHA)** | OSHA 3071-SP. |
| Hazard / control | peligro, riesgo | **peligro / medida de control** | |
| Toolbox talk | la plática de seguridad | **Charla de seguridad** | Presenter = *presentador*; attendees = *asistentes*. |
| PPE | | **EPP (equipo de protección personal)** | Not Oregon's *equipo protectivo personal*. |
| Hard hat / harness / fall protection | | **casco / arnés / protección contra caídas** | |
| Scaffold / ladder / trench | | **andamio / escalera / zanja** | |
| Competent person | | **persona competente** | |
| Lockout/tagout | | **bloqueo y etiquetado** | |
| Incident / injury / near miss | | **incidente / lesión / casi accidente** | Accept *cuasi accidente*. |
| First aid / days away / restricted duty | | **primeros auxilios / días de ausencia del trabajo / trabajo restringido** | |
| Fatality / lost consciousness | | **fallecimiento / pérdida del conocimiento** | |
| Corrective action / investigating | | **acción correctiva / en investigación** | |
| OSHA 300 log | | **registro OSHA 300** | |

### 3.6 Trades (`TradeKey`)

| Key | UI |
|---|---|
| general | General |
| concrete | Concreto |
| framing | Framing (estructura) |
| electrical | Electricidad |
| plumbing | Plomería |
| hvac | HVAC (aire y calefacción) |
| roofing | Techos (roofing) |
| steel | Acero / estructura metálica |
| demo | Demolición |
| landscaping | Jardinería |
| finish | Acabados |
| closeout | Cierre |
| (UI only) drywall | Drywall (tablaroca) |

---

## 4. Common UI words (`common.*`)

| English | Spanish |
|---|---|
| Save / Cancel / Done / Next / Back | Guardar / Cancelar / Listo / Siguiente / Atrás |
| Add / Edit / Delete / Remove | **Agregar** / Editar / **Eliminar** / Quitar |
| Send / Share / Approve / Reject / Sign | Enviar / Compartir / Aprobar / Rechazar / Firmar |
| Search / Filter / Sort | Buscar / Filtrar / Ordenar |
| Take photo / Upload / Download | Tomar foto / Subir / Descargar |
| Retry / Undo / Close / Open | Reintentar / Deshacer / Cerrar / Abrir |
| Today / Tomorrow / Yesterday | Hoy / Mañana / Ayer |
| Offline — saved on this phone, will sync | Sin conexión — guardado en este teléfono, se sincroniza después |
| Could not save. Check your connection and try again. | No se pudo guardar. Revisa tu conexión e inténtalo de nuevo. |
| AI draft — check before sending | Borrador de IA — revísalo antes de enviar |
| Translated from English by AI | Traducido del inglés por IA |
| SIMULATED WEATHER — NOT A FORECAST | CLIMA SIMULADO — NO ES UN PRONÓSTICO |

Tab and sidebar labels (10 characters or fewer, **[confirm]** against the pseudo-locale
at phone width):

| English | Spanish |
|---|---|
| Home | Inicio |
| Your Projects | Tus obras |
| Summary | Resumen |
| Discover | Descubrir |
| Settings | Ajustes |
| Field | Campo |
| Schedule | Cronograma |
| Money | Dinero |

---

## 5. Input-only synonyms (search, voice, AI must accept; never displayed)

- *checar, ponchar* (clock in/out)
- *aseguranza* (insurance)
- *el foreman, mayordomo* (foreman)
- *el change order*
- *el overtime, tiempo extra*
- *lonche, troca*
- *yarda* (yard, which is also a unit)
- *tablaroca, sheetrock* (drywall)
- *el super, el sub, el JHA*
- *junta* (meeting)
- *plática* (toolbox talk)
- *estimación*, which maps to **pay app**, not estimate
- *bitácora*, which maps to daily report (display stays *Reporte diario*)

Anglicisms crews really use (UI: Spanish first, English in parentheses the first
time it appears on a screen): change order, punch list, submittal, RFI, takeoff,
foreman, overtime, framing, drywall, roofing. Keep acronyms as they are: RFI, JHA,
OSHA, COI, AIA G702/G703, 1099, WIP, T&M, OAC, EPP.

---

## 6. Forbidden in es catalog text (the validator lints for these)

- *vosotros*, and the *-áis / -éis* verb endings
- *hormigón*, *fontanero / fontanería*, *ordenador*, *móvil*, *vale*, *coger*,
  *pulse / pulsa*
- *estimación* (except `money.payApp.*` help text)
- *bitácora* (except as an input synonym)
- *equipo* in a `*.crew.*` key
- *peón*
- *sobreprecio*
- *OT* as an abbreviation for overtime
- numeric dates (`d/m` or `m/d`) in Spanish strings

---

## 7. Formatting (verified on the RN 0.81 Hermes binary and Node ICU)

| Thing | Rule | Example |
|---|---|---|
| Money | Identical to English (the es-US convention). Never es-MX (`USD 1,234.50`) or es-ES (`1.234,50 US$`). | `$1,234,567.50`, `-$1.50` |
| Numbers | Period decimal, comma thousands | `12,500.5` |
| Dates | **Month names only; never numeric.** Built from our own tables so iOS and the web match. | `27 sept`, `27 sept 2026`, `dom 27 sept`, `domingo, 27 de septiembre de 2026` |
| Time | lowercase *a.m.* / *p.m.* | `3:05 p.m.` |
| Weekdays | lowercase | `lunes`, short `lun` |
| Months | lowercase | `septiembre`, short `sept` |
| Relative | | `hace 5 min`, `hace 2 h`, `ayer`, `hace 3 días` |
| Training | *capacitación*, not *formación* | Microsoft es-US guide |

---

## 8. Open items for the human reviewer

1. **Dependency abbreviations.** Confirm FC/CC/FF/CF.
2. **Tab labels.** Confirm they fit at phone width (pseudo-locale pass first).
3. ***Estimado* vs *cotización*.** Confirm *estimado* reads naturally to a Texas or
   California office manager for "Estimate" (our pick because *presupuesto* is
   taken by budget).
4. **The owner role.** Confirm *Titular de la cuenta* vs *Administrador*.
5. **Legal text.** Every Phase 3 (legal) string goes to a **paid legal translator**,
   not this glossary alone.
6. **Short money.** `formatMoneyShortL` prints `$12K` / `$1.2M` in Spanish too (same as
   English). Confirm a Spanish-speaking office reads K/M correctly; the alternative is
   `$12 mil` / `$1.2 millones` (longer; one line in `i18n/format.ts`).
7. **Sidebar sections and a few nav rows** (seed catalog `i18n/catalog/es/nav.ts`):
   *PLANEACIÓN*, *MI TRABAJO*, *Bandeja* (Inbox), *Control de horas* (Time Tracking),
   *Ofertas* (the "MAGE ID Bids" tab, brand dropped to fit 10 characters).
