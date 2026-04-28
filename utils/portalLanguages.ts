// portalLanguages — six-language support for the homeowner portal.
//
// Two surfaces this drives:
//
//  1. AI homeowner-summary generation. The prompt to Gemini is augmented
//     with a "WRITE IN: <language full name>" instruction so the daily
//     summary lands in the homeowner's language directly — no
//     post-processing translation step.
//
//  2. Static portal UI strings (section titles, CTAs, helpers). The
//     portal HTML reads `data.uiStrings` and substitutes labels at
//     render time so the homeowner sees their language immediately.
//
// Languages picked for the actual demographics of US residential
// construction (homeowner + labor): English, Spanish, Brazilian
// Portuguese, Mandarin Chinese, Vietnamese, French (Canadian / LA).
// Adding more is a 4-line drop-in here + the matching translation
// dictionary in `PORTAL_UI_STRINGS`.

import type { PortalLanguage } from '@/types';

export interface LanguageMeta {
  code: PortalLanguage;
  /** Display name in English (for the GC's language picker). */
  englishName: string;
  /** Endonym (the language's name in itself, for the homeowner). */
  endonym: string;
  /** Two-letter flag emoji. */
  flag: string;
  /** Full name we feed into the AI prompt. */
  promptName: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', englishName: 'English',     endonym: 'English',    flag: '🇺🇸', promptName: 'English' },
  { code: 'es', englishName: 'Spanish',     endonym: 'Español',    flag: '🇪🇸', promptName: 'Spanish (neutral Latin American)' },
  { code: 'pt', englishName: 'Portuguese',  endonym: 'Português',  flag: '🇧🇷', promptName: 'Brazilian Portuguese' },
  { code: 'zh', englishName: 'Mandarin',    endonym: '中文',        flag: '🇨🇳', promptName: 'Simplified Mandarin Chinese' },
  { code: 'vi', englishName: 'Vietnamese',  endonym: 'Tiếng Việt', flag: '🇻🇳', promptName: 'Vietnamese' },
  { code: 'fr', englishName: 'French',      endonym: 'Français',   flag: '🇫🇷', promptName: 'French' },
];

const LANGUAGE_BY_CODE: Record<PortalLanguage, LanguageMeta> = LANGUAGES.reduce(
  (acc, l) => { acc[l.code] = l; return acc; },
  {} as Record<PortalLanguage, LanguageMeta>,
);

export function getLanguageMeta(code: PortalLanguage | undefined | null): LanguageMeta {
  if (!code) return LANGUAGE_BY_CODE.en;
  return LANGUAGE_BY_CODE[code] ?? LANGUAGE_BY_CODE.en;
}

// ─── Static portal UI strings ───────────────────────────────────────
//
// These are rendered by the static homeowner portal. We translate only
// the most-visible labels — the "structural" UI. The homeowner-facing
// CONTENT (daily summary, contract title, selection brief) is generated
// in the right language by AI or written by the GC, so we don't try to
// auto-translate user-input fields. That avoids "Pickle Project" turning
// into "Proyecto Encurtido".

export interface PortalUIStrings {
  // Hero / latest update
  latestUpdateEyebrow: string;          // "Latest update from {company}"
  // Section titles
  contractSectionTitle: string;
  contractSectionSubtitleSign: string;
  contractSectionSubtitleSigned: string;
  selectionsSectionTitle: string;
  selectionsSectionSubtitle: string;
  closeoutSectionTitle: string;
  closeoutSectionSubtitle: string;
  invoicesSectionTitle: string;
  invoicesSectionSubtitle: string;
  paymentAppsTitle: string;
  scheduleSectionTitle: string;
  scheduleSectionSubtitle: string;
  changeOrdersTitle: string;
  changeOrdersSubtitle: string;
  changeOrdersSubtitleApprove: string;
  photosSectionTitle: string;
  photosSectionSubtitle: string;
  dailyReportsTitle: string;
  dailyReportsSubtitle: string;
  punchListTitle: string;
  punchListSubtitle: string;
  rfisTitle: string;
  documentsTitle: string;
  messagesTitle: string;
  messagesSubtitle: string;
  openBookGmpTitle: string;
  openBookOpenTitle: string;
  openBookGmpSubtitle: string;
  openBookOpenSubtitle: string;
  // Selections card
  selectionsAllowance: string;          // "ALLOWANCE"
  selectionsPickOne: string;
  selectionsChosen: string;
  selectionsOverBudget: string;
  selectionsTapToChoose: string;
  selectionsYourPick: string;
  selectionsTierBudget: string;
  selectionsTierOnTarget: string;
  selectionsTierPremium: string;
  // Contract card
  contractStatusSigned: string;
  contractTitleLabel: string;
  contractValueLabel: string;
  contractSignedDisclaimer: string;
  contractSignerExplainer: string;
  contractSignNamePlaceholder: string;
  contractSignButton: string;
  contractFinePrint: string;
  // Closeout
  closeoutPrint: string;
  closeoutDelivered: string;
  closeoutFinalized: string;
  closeoutFinishesTitle: string;
  closeoutWarrantiesTitle: string;
  closeoutMaintenanceTitle: string;
  closeoutContactsTitle: string;
  closeoutEmergencyTitle: string;
  closeoutNoteEyebrow: string;
  // Stats / generic
  empty: string;                        // "No data shared yet."
  payNow: string;
}

const en: PortalUIStrings = {
  latestUpdateEyebrow: 'Latest update from {company}',
  contractSectionTitle: 'Construction Agreement',
  contractSectionSubtitleSign: 'Review the contract and sign to make it binding.',
  contractSectionSubtitleSigned: 'Signed by both parties on file.',
  selectionsSectionTitle: 'Selections & Allowances',
  selectionsSectionSubtitle: 'Pick from AI-curated options within your allowance.',
  closeoutSectionTitle: 'Closeout Binder',
  closeoutSectionSubtitle: 'Everything you need to maintain, troubleshoot, and improve this build. Tap Print to save a PDF.',
  invoicesSectionTitle: 'Invoices',
  invoicesSectionSubtitle: 'Click any invoice to view line items and pay online',
  paymentAppsTitle: 'Pay Applications',
  scheduleSectionTitle: 'Schedule',
  scheduleSectionSubtitle: 'Live progress against the construction schedule',
  changeOrdersTitle: 'Change Orders',
  changeOrdersSubtitle: 'Approved and pending changes to the original contract',
  changeOrdersSubtitleApprove: 'Tap Approve / Decline to authorize a change order',
  photosSectionTitle: 'Site Photos',
  photosSectionSubtitle: 'Tap any photo to view full screen',
  dailyReportsTitle: 'Daily Field Reports',
  dailyReportsSubtitle: 'Daily site narrative — weather, manpower and work performed',
  punchListTitle: 'Punch List',
  punchListSubtitle: 'Open items remaining before close-out',
  rfisTitle: 'Requests for Information',
  documentsTitle: 'Documents',
  messagesTitle: 'Messages',
  messagesSubtitle: 'Talk directly with your contractor — replies show up in their app instantly',
  openBookGmpTitle: 'Open Book — GMP',
  openBookOpenTitle: 'Open Book',
  openBookGmpSubtitle: 'Real cost vs. GMP cap. We share every dollar with you — by design.',
  openBookOpenSubtitle: 'Open book. Every dollar tracked from budget through commitment to pay-out.',
  selectionsAllowance: 'ALLOWANCE',
  selectionsPickOne: 'PICK ONE',
  selectionsChosen: 'CHOSEN',
  selectionsOverBudget: 'OVER BUDGET',
  selectionsTapToChoose: 'Tap to choose',
  selectionsYourPick: '✓ Your pick',
  selectionsTierBudget: 'BUDGET',
  selectionsTierOnTarget: 'ON TARGET',
  selectionsTierPremium: 'PREMIUM',
  contractStatusSigned: 'Signed by both parties',
  contractTitleLabel: 'Title',
  contractValueLabel: 'Contract value',
  contractSignedDisclaimer: 'This is your binding agreement. Keep it for your records.',
  contractSignerExplainer: 'Your contractor has signed and sent this agreement. Review the full scope, payment schedule, and warranty in the app, then enter your full legal name below to counter-sign and make it binding.',
  contractSignNamePlaceholder: 'Type your full legal name',
  contractSignButton: 'Sign & make binding',
  contractFinePrint: 'By typing your name and tapping Sign, you accept the agreement as legally binding. The signed PDF will be available in this portal and emailed to you.',
  closeoutPrint: '🖨️ Print / Save as PDF',
  closeoutDelivered: 'DELIVERED',
  closeoutFinalized: 'FINALIZED',
  closeoutFinishesTitle: 'Finishes & fixtures installed',
  closeoutWarrantiesTitle: 'Warranties on file',
  closeoutMaintenanceTitle: 'Maintenance schedule',
  closeoutContactsTitle: 'Trade contacts',
  closeoutEmergencyTitle: 'If something breaks during the warranty period',
  closeoutNoteEyebrow: 'A NOTE FROM YOUR CONTRACTOR',
  empty: 'No data shared yet.',
  payNow: 'Pay Now',
};

const es: PortalUIStrings = {
  latestUpdateEyebrow: 'Última actualización de {company}',
  contractSectionTitle: 'Contrato de Construcción',
  contractSectionSubtitleSign: 'Revise el contrato y fírmelo para hacerlo vinculante.',
  contractSectionSubtitleSigned: 'Firmado por ambas partes.',
  selectionsSectionTitle: 'Selecciones y Asignaciones',
  selectionsSectionSubtitle: 'Elija entre opciones curadas por IA dentro de su presupuesto.',
  closeoutSectionTitle: 'Carpeta de Cierre',
  closeoutSectionSubtitle: 'Todo lo que necesita para mantener y mejorar su obra. Pulse Imprimir para guardar un PDF.',
  invoicesSectionTitle: 'Facturas',
  invoicesSectionSubtitle: 'Haga clic en cualquier factura para ver los detalles y pagar en línea',
  paymentAppsTitle: 'Solicitudes de Pago',
  scheduleSectionTitle: 'Cronograma',
  scheduleSectionSubtitle: 'Progreso en vivo del cronograma de construcción',
  changeOrdersTitle: 'Órdenes de Cambio',
  changeOrdersSubtitle: 'Cambios aprobados y pendientes al contrato original',
  changeOrdersSubtitleApprove: 'Pulse Aprobar / Rechazar para autorizar una orden de cambio',
  photosSectionTitle: 'Fotos de la Obra',
  photosSectionSubtitle: 'Pulse cualquier foto para verla en pantalla completa',
  dailyReportsTitle: 'Reportes Diarios de Campo',
  dailyReportsSubtitle: 'Narrativa diaria — clima, personal y trabajo realizado',
  punchListTitle: 'Lista de Pendientes',
  punchListSubtitle: 'Elementos abiertos antes del cierre',
  rfisTitle: 'Solicitudes de Información',
  documentsTitle: 'Documentos',
  messagesTitle: 'Mensajes',
  messagesSubtitle: 'Hable directamente con su contratista — sus respuestas aparecen al instante en su app',
  openBookGmpTitle: 'Libro Abierto — Precio Máximo Garantizado',
  openBookOpenTitle: 'Libro Abierto',
  openBookGmpSubtitle: 'Costo real frente al máximo garantizado. Compartimos cada dólar con usted.',
  openBookOpenSubtitle: 'Libro abierto. Cada dólar rastreado del presupuesto al desembolso.',
  selectionsAllowance: 'ASIGNACIÓN',
  selectionsPickOne: 'ELIJA UNO',
  selectionsChosen: 'ELEGIDO',
  selectionsOverBudget: 'SOBRE PRESUPUESTO',
  selectionsTapToChoose: 'Pulse para elegir',
  selectionsYourPick: '✓ Su selección',
  selectionsTierBudget: 'ECONÓMICO',
  selectionsTierOnTarget: 'EN OBJETIVO',
  selectionsTierPremium: 'PREMIUM',
  contractStatusSigned: 'Firmado por ambas partes',
  contractTitleLabel: 'Título',
  contractValueLabel: 'Valor del contrato',
  contractSignedDisclaimer: 'Este es su acuerdo vinculante. Consérvelo para sus registros.',
  contractSignerExplainer: 'Su contratista ha firmado y enviado este acuerdo. Revise el alcance completo, el cronograma de pagos y la garantía en la app, luego escriba su nombre legal completo abajo para firmar y hacerlo vinculante.',
  contractSignNamePlaceholder: 'Escriba su nombre legal completo',
  contractSignButton: 'Firmar y hacer vinculante',
  contractFinePrint: 'Al escribir su nombre y pulsar Firmar, acepta el acuerdo como legalmente vinculante. El PDF firmado estará disponible en este portal y le será enviado por correo.',
  closeoutPrint: '🖨️ Imprimir / Guardar PDF',
  closeoutDelivered: 'ENTREGADO',
  closeoutFinalized: 'FINALIZADO',
  closeoutFinishesTitle: 'Acabados y accesorios instalados',
  closeoutWarrantiesTitle: 'Garantías en archivo',
  closeoutMaintenanceTitle: 'Programa de mantenimiento',
  closeoutContactsTitle: 'Contactos de los oficios',
  closeoutEmergencyTitle: 'Si algo falla durante el período de garantía',
  closeoutNoteEyebrow: 'UNA NOTA DE SU CONTRATISTA',
  empty: 'Aún no se ha compartido información.',
  payNow: 'Pagar Ahora',
};

const pt: PortalUIStrings = {
  latestUpdateEyebrow: 'Atualização mais recente de {company}',
  contractSectionTitle: 'Contrato de Construção',
  contractSectionSubtitleSign: 'Revise o contrato e assine para torná-lo vinculante.',
  contractSectionSubtitleSigned: 'Assinado por ambas as partes.',
  selectionsSectionTitle: 'Seleções e Verbas',
  selectionsSectionSubtitle: 'Escolha entre opções curadas por IA dentro da sua verba.',
  closeoutSectionTitle: 'Pasta de Encerramento',
  closeoutSectionSubtitle: 'Tudo o que você precisa para manter e melhorar a obra. Toque em Imprimir para salvar um PDF.',
  invoicesSectionTitle: 'Faturas',
  invoicesSectionSubtitle: 'Toque em qualquer fatura para ver os detalhes e pagar online',
  paymentAppsTitle: 'Pedidos de Pagamento',
  scheduleSectionTitle: 'Cronograma',
  scheduleSectionSubtitle: 'Progresso em tempo real do cronograma da obra',
  changeOrdersTitle: 'Ordens de Alteração',
  changeOrdersSubtitle: 'Alterações aprovadas e pendentes ao contrato original',
  changeOrdersSubtitleApprove: 'Toque em Aprovar / Recusar para autorizar uma alteração',
  photosSectionTitle: 'Fotos da Obra',
  photosSectionSubtitle: 'Toque em qualquer foto para vê-la em tela cheia',
  dailyReportsTitle: 'Relatórios Diários de Obra',
  dailyReportsSubtitle: 'Narrativa diária — clima, pessoal e trabalho realizado',
  punchListTitle: 'Lista de Pendências',
  punchListSubtitle: 'Itens em aberto antes da entrega',
  rfisTitle: 'Pedidos de Informação',
  documentsTitle: 'Documentos',
  messagesTitle: 'Mensagens',
  messagesSubtitle: 'Fale diretamente com seu construtor — as respostas aparecem instantaneamente no app dele',
  openBookGmpTitle: 'Livro Aberto — Preço Máximo Garantido',
  openBookOpenTitle: 'Livro Aberto',
  openBookGmpSubtitle: 'Custo real versus o teto garantido. Compartilhamos cada centavo com você.',
  openBookOpenSubtitle: 'Livro aberto. Cada centavo rastreado do orçamento até o pagamento.',
  selectionsAllowance: 'VERBA',
  selectionsPickOne: 'ESCOLHA UM',
  selectionsChosen: 'ESCOLHIDO',
  selectionsOverBudget: 'ACIMA DA VERBA',
  selectionsTapToChoose: 'Toque para escolher',
  selectionsYourPick: '✓ Sua escolha',
  selectionsTierBudget: 'ECONÔMICO',
  selectionsTierOnTarget: 'NO ALVO',
  selectionsTierPremium: 'PREMIUM',
  contractStatusSigned: 'Assinado por ambas as partes',
  contractTitleLabel: 'Título',
  contractValueLabel: 'Valor do contrato',
  contractSignedDisclaimer: 'Este é o seu acordo vinculante. Guarde-o para os seus registros.',
  contractSignerExplainer: 'Seu construtor assinou e enviou este acordo. Revise o escopo completo, o cronograma de pagamentos e a garantia no app, depois digite seu nome legal completo abaixo para contra-assinar e tornar vinculante.',
  contractSignNamePlaceholder: 'Digite seu nome legal completo',
  contractSignButton: 'Assinar e tornar vinculante',
  contractFinePrint: 'Ao digitar seu nome e tocar em Assinar, você aceita o acordo como legalmente vinculante. O PDF assinado ficará disponível neste portal e será enviado por e-mail.',
  closeoutPrint: '🖨️ Imprimir / Salvar PDF',
  closeoutDelivered: 'ENTREGUE',
  closeoutFinalized: 'FINALIZADO',
  closeoutFinishesTitle: 'Acabamentos e louças instaladas',
  closeoutWarrantiesTitle: 'Garantias arquivadas',
  closeoutMaintenanceTitle: 'Programa de manutenção',
  closeoutContactsTitle: 'Contatos dos profissionais',
  closeoutEmergencyTitle: 'Se algo quebrar durante o período de garantia',
  closeoutNoteEyebrow: 'UMA NOTA DO SEU CONSTRUTOR',
  empty: 'Nada compartilhado ainda.',
  payNow: 'Pagar Agora',
};

const zh: PortalUIStrings = {
  latestUpdateEyebrow: '来自 {company} 的最新进展',
  contractSectionTitle: '施工合同',
  contractSectionSubtitleSign: '审阅合同并签字以生效。',
  contractSectionSubtitleSigned: '双方均已签署。',
  selectionsSectionTitle: '材料选择与配额',
  selectionsSectionSubtitle: '从AI精选的方案中选择,在您的预算之内。',
  closeoutSectionTitle: '竣工资料夹',
  closeoutSectionSubtitle: '维护、保修、改造所需的全部资料。点击"打印"保存为PDF。',
  invoicesSectionTitle: '发票',
  invoicesSectionSubtitle: '点击任意发票查看明细并在线付款',
  paymentAppsTitle: '付款申请',
  scheduleSectionTitle: '施工进度',
  scheduleSectionSubtitle: '施工计划的实时进度',
  changeOrdersTitle: '变更单',
  changeOrdersSubtitle: '原合同已批准和待批准的变更',
  changeOrdersSubtitleApprove: '点击"批准 / 拒绝"以授权变更单',
  photosSectionTitle: '现场照片',
  photosSectionSubtitle: '点击任意照片查看大图',
  dailyReportsTitle: '每日施工日志',
  dailyReportsSubtitle: '每日现场记录 — 天气、人力、完成工作',
  punchListTitle: '收尾清单',
  punchListSubtitle: '竣工前的待办项目',
  rfisTitle: '信息征询单',
  documentsTitle: '文件',
  messagesTitle: '消息',
  messagesSubtitle: '直接与您的承包商沟通 — 回复会即时出现在他们的应用中',
  openBookGmpTitle: '透明账本 — 最高保证价',
  openBookOpenTitle: '透明账本',
  openBookGmpSubtitle: '实际成本对比最高保证价。我们对您坦诚每一分钱。',
  openBookOpenSubtitle: '透明账本。每一分钱从预算到承诺再到支付都有记录。',
  selectionsAllowance: '配额',
  selectionsPickOne: '请选择',
  selectionsChosen: '已选',
  selectionsOverBudget: '超出预算',
  selectionsTapToChoose: '点击选择',
  selectionsYourPick: '✓ 已选',
  selectionsTierBudget: '经济',
  selectionsTierOnTarget: '符合预算',
  selectionsTierPremium: '高端',
  contractStatusSigned: '双方均已签署',
  contractTitleLabel: '标题',
  contractValueLabel: '合同金额',
  contractSignedDisclaimer: '这是您的具有法律约束力的协议。请妥善保管。',
  contractSignerExplainer: '您的承包商已签署并发送此协议。请在应用中查看完整范围、付款计划和保修条款,然后在下方输入您的法定姓名以进行会签并使其生效。',
  contractSignNamePlaceholder: '输入您的法定全名',
  contractSignButton: '签字使其生效',
  contractFinePrint: '输入姓名并点击"签字"即表示您接受此协议具有法律约束力。已签署的PDF将在本门户中提供,并发送至您的邮箱。',
  closeoutPrint: '🖨️ 打印 / 保存为PDF',
  closeoutDelivered: '已交付',
  closeoutFinalized: '已定稿',
  closeoutFinishesTitle: '已安装的饰面与器具',
  closeoutWarrantiesTitle: '保修信息',
  closeoutMaintenanceTitle: '维护计划',
  closeoutContactsTitle: '工种联系人',
  closeoutEmergencyTitle: '保修期内出现问题时',
  closeoutNoteEyebrow: '来自承包商的留言',
  empty: '尚未分享任何内容。',
  payNow: '立即付款',
};

const vi: PortalUIStrings = {
  latestUpdateEyebrow: 'Cập nhật mới nhất từ {company}',
  contractSectionTitle: 'Hợp Đồng Xây Dựng',
  contractSectionSubtitleSign: 'Xem lại hợp đồng và ký để có hiệu lực.',
  contractSectionSubtitleSigned: 'Đã được cả hai bên ký.',
  selectionsSectionTitle: 'Lựa Chọn & Hạn Mức',
  selectionsSectionSubtitle: 'Chọn từ các tùy chọn được AI sắp xếp trong hạn mức của bạn.',
  closeoutSectionTitle: 'Hồ Sơ Bàn Giao',
  closeoutSectionSubtitle: 'Mọi thứ bạn cần để bảo trì và cải thiện công trình. Bấm In để lưu PDF.',
  invoicesSectionTitle: 'Hóa Đơn',
  invoicesSectionSubtitle: 'Bấm vào bất kỳ hóa đơn nào để xem chi tiết và thanh toán trực tuyến',
  paymentAppsTitle: 'Yêu Cầu Thanh Toán',
  scheduleSectionTitle: 'Tiến Độ',
  scheduleSectionSubtitle: 'Tiến độ thi công theo thời gian thực',
  changeOrdersTitle: 'Lệnh Thay Đổi',
  changeOrdersSubtitle: 'Các thay đổi đã duyệt và đang chờ với hợp đồng gốc',
  changeOrdersSubtitleApprove: 'Bấm Duyệt / Từ chối để cho phép lệnh thay đổi',
  photosSectionTitle: 'Ảnh Công Trường',
  photosSectionSubtitle: 'Bấm vào ảnh để xem toàn màn hình',
  dailyReportsTitle: 'Báo Cáo Hàng Ngày',
  dailyReportsSubtitle: 'Tường thuật hàng ngày — thời tiết, nhân lực, công việc đã làm',
  punchListTitle: 'Danh Sách Chỉnh Sửa',
  punchListSubtitle: 'Các mục còn dang dở trước khi bàn giao',
  rfisTitle: 'Yêu Cầu Thông Tin',
  documentsTitle: 'Tài Liệu',
  messagesTitle: 'Tin Nhắn',
  messagesSubtitle: 'Trao đổi trực tiếp với nhà thầu — phản hồi xuất hiện ngay trong ứng dụng của họ',
  openBookGmpTitle: 'Sổ Công Khai — Giá Tối Đa Bảo Đảm',
  openBookOpenTitle: 'Sổ Công Khai',
  openBookGmpSubtitle: 'Chi phí thực so với mức giới hạn. Chúng tôi chia sẻ từng đồng với bạn.',
  openBookOpenSubtitle: 'Sổ công khai. Mọi đồng tiền được theo dõi từ ngân sách đến thanh toán.',
  selectionsAllowance: 'HẠN MỨC',
  selectionsPickOne: 'CHỌN MỘT',
  selectionsChosen: 'ĐÃ CHỌN',
  selectionsOverBudget: 'VƯỢT NGÂN SÁCH',
  selectionsTapToChoose: 'Bấm để chọn',
  selectionsYourPick: '✓ Lựa chọn của bạn',
  selectionsTierBudget: 'TIẾT KIỆM',
  selectionsTierOnTarget: 'ĐÚNG MỨC',
  selectionsTierPremium: 'CAO CẤP',
  contractStatusSigned: 'Đã được cả hai bên ký',
  contractTitleLabel: 'Tiêu đề',
  contractValueLabel: 'Giá trị hợp đồng',
  contractSignedDisclaimer: 'Đây là thỏa thuận ràng buộc của bạn. Hãy lưu giữ cho hồ sơ.',
  contractSignerExplainer: 'Nhà thầu đã ký và gửi thỏa thuận này. Xem lại toàn bộ phạm vi, lịch thanh toán và bảo hành trong ứng dụng, sau đó nhập tên đầy đủ hợp pháp của bạn bên dưới để đối ký và làm hợp đồng có hiệu lực.',
  contractSignNamePlaceholder: 'Nhập tên đầy đủ hợp pháp',
  contractSignButton: 'Ký và xác nhận',
  contractFinePrint: 'Bằng cách nhập tên và bấm Ký, bạn chấp nhận thỏa thuận có giá trị pháp lý. Bản PDF đã ký sẽ có trong cổng này và được gửi qua email.',
  closeoutPrint: '🖨️ In / Lưu PDF',
  closeoutDelivered: 'ĐÃ GIAO',
  closeoutFinalized: 'ĐÃ HOÀN TẤT',
  closeoutFinishesTitle: 'Vật liệu hoàn thiện đã lắp đặt',
  closeoutWarrantiesTitle: 'Bảo hành đã lưu',
  closeoutMaintenanceTitle: 'Lịch bảo trì',
  closeoutContactsTitle: 'Danh bạ thợ',
  closeoutEmergencyTitle: 'Nếu có sự cố trong thời gian bảo hành',
  closeoutNoteEyebrow: 'LỜI NHẮN TỪ NHÀ THẦU',
  empty: 'Chưa có nội dung được chia sẻ.',
  payNow: 'Thanh Toán Ngay',
};

const fr: PortalUIStrings = {
  latestUpdateEyebrow: 'Dernière mise à jour de {company}',
  contractSectionTitle: 'Contrat de Construction',
  contractSectionSubtitleSign: 'Examinez le contrat et signez pour le rendre exécutoire.',
  contractSectionSubtitleSigned: 'Signé par les deux parties.',
  selectionsSectionTitle: 'Choix et Allocations',
  selectionsSectionSubtitle: 'Choisissez parmi des options sélectionnées par IA dans votre allocation.',
  closeoutSectionTitle: 'Cahier de Clôture',
  closeoutSectionSubtitle: 'Tout ce dont vous avez besoin pour entretenir et améliorer la construction. Touchez Imprimer pour sauvegarder un PDF.',
  invoicesSectionTitle: 'Factures',
  invoicesSectionSubtitle: 'Touchez n\'importe quelle facture pour voir les détails et payer en ligne',
  paymentAppsTitle: 'Demandes de Paiement',
  scheduleSectionTitle: 'Calendrier',
  scheduleSectionSubtitle: 'Avancement en direct du calendrier de construction',
  changeOrdersTitle: 'Avenants',
  changeOrdersSubtitle: 'Modifications approuvées et en attente du contrat original',
  changeOrdersSubtitleApprove: 'Touchez Approuver / Refuser pour autoriser un avenant',
  photosSectionTitle: 'Photos du Chantier',
  photosSectionSubtitle: 'Touchez une photo pour la voir en plein écran',
  dailyReportsTitle: 'Rapports Quotidiens de Chantier',
  dailyReportsSubtitle: 'Récit quotidien — météo, main-d\'œuvre et travaux effectués',
  punchListTitle: 'Liste des Retouches',
  punchListSubtitle: 'Éléments restants avant la livraison',
  rfisTitle: 'Demandes d\'Information',
  documentsTitle: 'Documents',
  messagesTitle: 'Messages',
  messagesSubtitle: 'Parlez directement avec votre entrepreneur — les réponses apparaissent instantanément dans son application',
  openBookGmpTitle: 'Livre Ouvert — Prix Maximum Garanti',
  openBookOpenTitle: 'Livre Ouvert',
  openBookGmpSubtitle: 'Coût réel par rapport au plafond garanti. Nous partageons chaque dollar avec vous.',
  openBookOpenSubtitle: 'Livre ouvert. Chaque dollar suivi du budget jusqu\'au paiement.',
  selectionsAllowance: 'ALLOCATION',
  selectionsPickOne: 'CHOISISSEZ-EN UN',
  selectionsChosen: 'CHOISI',
  selectionsOverBudget: 'HORS BUDGET',
  selectionsTapToChoose: 'Touchez pour choisir',
  selectionsYourPick: '✓ Votre choix',
  selectionsTierBudget: 'ÉCONOMIQUE',
  selectionsTierOnTarget: 'CIBLE',
  selectionsTierPremium: 'HAUT DE GAMME',
  contractStatusSigned: 'Signé par les deux parties',
  contractTitleLabel: 'Titre',
  contractValueLabel: 'Valeur du contrat',
  contractSignedDisclaimer: 'Voici votre contrat exécutoire. Conservez-le pour vos dossiers.',
  contractSignerExplainer: 'Votre entrepreneur a signé et envoyé cet accord. Examinez l\'étendue complète, le calendrier de paiement et la garantie dans l\'application, puis saisissez votre nom légal complet ci-dessous pour contresigner et le rendre exécutoire.',
  contractSignNamePlaceholder: 'Saisissez votre nom légal complet',
  contractSignButton: 'Signer et rendre exécutoire',
  contractFinePrint: 'En saisissant votre nom et en touchant Signer, vous acceptez l\'accord comme juridiquement contraignant. Le PDF signé sera disponible dans ce portail et envoyé par e-mail.',
  closeoutPrint: '🖨️ Imprimer / Enregistrer PDF',
  closeoutDelivered: 'LIVRÉ',
  closeoutFinalized: 'FINALISÉ',
  closeoutFinishesTitle: 'Finitions et accessoires installés',
  closeoutWarrantiesTitle: 'Garanties au dossier',
  closeoutMaintenanceTitle: 'Calendrier d\'entretien',
  closeoutContactsTitle: 'Contacts des corps de métier',
  closeoutEmergencyTitle: 'Si quelque chose se brise pendant la période de garantie',
  closeoutNoteEyebrow: 'UN MOT DE VOTRE ENTREPRENEUR',
  empty: 'Rien n\'a encore été partagé.',
  payNow: 'Payer Maintenant',
};

export const PORTAL_UI_STRINGS: Record<PortalLanguage, PortalUIStrings> = {
  en, es, pt, zh, vi, fr,
};

export function getUIStrings(code: PortalLanguage | undefined | null): PortalUIStrings {
  if (!code) return en;
  return PORTAL_UI_STRINGS[code] ?? en;
}
