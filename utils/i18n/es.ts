// Spanish — translations of every key in en.ts. When a key is missing
// here, t() falls back to English and logs a warning in dev.
//
// Translation source: in-house team review, May 2026. Construction-
// industry vocabulary chosen for US-Spanish-speaking field crews
// (predominantly Mexican / Central American Spanish — "obra" for
// jobsite, "cuadrilla" for crew, "supervisor" for super).
//
// Open issues for translator review:
//   - "Approvals" → "Aprobaciones" reads correctly but might prefer
//     "Pendientes de aprobación" depending on regional preference.
//   - WH-347 is a US federal form name; we don't translate it.

const es: Record<string, string> = {
  // ── Common ──
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.done': 'Listo',
  'common.back': 'Atrás',
  'common.continue': 'Continuar',
  'common.delete': 'Eliminar',
  'common.confirm': 'Confirmar',
  'common.search': 'Buscar',
  'common.loading': 'Cargando…',
  'common.retry': 'Reintentar',

  // ── Login ──
  'login.title': 'Inicia sesión en MAGE ID',
  'login.email': 'Correo electrónico',
  'login.password': 'Contraseña',
  'login.signInBtn': 'Iniciar sesión',
  'login.magicLinkBtn': 'Envíame un enlace de inicio de sesión',
  'login.createAccount': 'Crear cuenta',
  'login.forgotPassword': '¿Olvidaste tu contraseña?',

  // ── Time tracking ──
  'time.title': 'Control de horas',
  'time.onSite': 'En obra',
  'time.hoursToday': '{hours} horas hoy',
  'time.clockIn': 'Registrar entrada',
  'time.clockOut': 'Registrar salida',
  'time.startBreak': 'Iniciar descanso',
  'time.resume': 'Reanudar',
  'time.exportCsv': 'Exportar CSV',
  'time.exportWh347': 'WH-347',
  'time.geofence.onSite': 'En el sitio',
  'time.geofence.checking': 'Verificando tu ubicación…',
  'time.geofence.unavailable': 'GPS no disponible',
  'time.addCrew': 'Agregar trabajador',
  'time.noCrewYet': 'Aún no hay cuadrilla',
  'time.allClockedIn': 'Todos los trabajadores están registrados',

  // ── Settings ──
  'settings.title': 'Ajustes',
  'settings.language': 'Idioma',
  'settings.languageSub': 'El idioma de los menús, botones y etiquetas en esta app. El idioma del portal del propietario se configura por proyecto.',
  'settings.security': 'Seguridad de la cuenta',
  'settings.securitySub': 'Contraseña, autenticación de dos factores, desbloqueo biométrico',
  'settings.notifications': 'Notificaciones',
  'settings.signOut': 'Cerrar sesión',

  // ── Approvals ──
  'approvals.title': 'Aprobaciones',
  'approvals.empty': 'Nada pendiente para ti',
  'approvals.emptyMsg': 'Todas las órdenes de cambio están firmadas, las RFI están respondidas, y los paquetes de licitación están adjudicados.',
  'approvals.approve': 'Aprobar',
  'approvals.reject': 'Rechazar',
};

export default es;
