// src/pages/SettingsPage.jsx
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Bell, Building2, CalendarDays, DatabaseBackup, Download, FileText, Globe2, MonitorCog, PackageCheck,
  HelpCircle, History, ListChecks, Mail, Plus, ReceiptText, RotateCcw, Save, Send, Settings, ShieldCheck, Store, Trash2, Upload, UserCog
  , TrendingDown as TrendingDownIcon
} from 'lucide-react'
import { api } from '../lib/api'
import { getCompanyName, getLogoUrl } from '../lib/brand'
import { applyVisualIdentity, getVisualIdentity } from '../lib/visualIdentity'
import { LANGUAGES, useI18n } from '../lib/i18n'
import { useAuth } from '../lib/AuthContext'
import { useConfirm } from '../components/ui/ConfirmDialog'
import './SettingsPage.css'

const TABS = [
  { id: 'user', labelKey: 'settings.tab.user', icon: UserCog },
  { id: 'app', labelKey: 'settings.tab.app', icon: MonitorCog },
  { id: 'identity', labelKey: 'settings.tab.identity', icon: Bell },
  { id: 'company', labelKey: 'settings.tab.company', icon: Store },
  { id: 'documents', labelKey: 'settings.tab.documents', icon: FileText },
  { id: 'finance', labelKey: 'settings.tab.finance', icon: ReceiptText },
  { id: 'catalog', label: 'Referentiels', icon: ListChecks },
  { id: 'email', labelKey: 'settings.tab.email', icon: Mail },
  { id: 'backup', labelKey: 'settings.tab.backup', icon: DatabaseBackup },
  { id: 'audit', labelKey: 'settings.tab.audit', icon: History },
  { id: 'system', label: 'Systeme', icon: MonitorCog },
]

const ROUTES = [
  ['/dashboard', 'nav.dashboard'],
  ['/pos', 'nav.pos'],
  ['/sales', 'nav.sales'],
  ['/products', 'nav.products'],
  ['/stock', 'nav.stock'],
  ['/reports', 'nav.reports'],
]

const WEEK_DAYS = [
  ['1', 'days.monday'],
  ['2', 'days.tuesday'],
  ['3', 'days.wednesday'],
  ['4', 'days.thursday'],
  ['5', 'days.friday'],
  ['6', 'days.saturday'],
  ['7', 'days.sunday'],
]

const HELP = {
  full_name: { fr: "Nom affiche dans l'application et sur votre profil.", ar: 'الاسم الذي يظهر داخل التطبيق وفي ملفك الشخصي.' },
  profile_email: { fr: 'Adresse email liee a votre compte utilisateur.', ar: 'البريد الإلكتروني المرتبط بحساب المستخدم.' },
  profile_password: { fr: 'Laissez ce champ vide si vous ne souhaitez pas changer le mot de passe.', ar: 'اترك هذا الحقل فارغا إذا كنت لا تريد تغيير كلمة المرور.' },
  user_language: { fr: "Change immediatement la langue et le sens d'affichage de votre interface.", ar: 'يغيّر لغة واتجاه واجهتك مباشرة.' },
  user_default_page: { fr: 'Page preferee apres connexion quand elle est disponible pour votre role.', ar: 'الصفحة المفضلة بعد تسجيل الدخول إذا كانت متاحة لصلاحياتك.' },
  user_date_format: { fr: 'Format utilise pour afficher les dates dans votre espace.', ar: 'الصيغة المستخدمة لعرض التواريخ في حسابك.' },
  user_compact_mode: { fr: 'Reduit les espacements des tableaux pour afficher plus de lignes.', ar: 'يقلل المسافات في الجداول لعرض عدد أكبر من الأسطر.' },
  user_notifications: { fr: "Active les notifications internes quand une action importante se produit.", ar: 'يفعّل إشعارات داخلية عند حدوث عمليات مهمة.' },
  user_sidebar_default_collapsed: { fr: 'Ouvre le menu lateral en mode reduit par defaut.', ar: 'يفتح القائمة الجانبية بشكل مصغر افتراضيا.' },
  app_name: { fr: "Nom commercial affiche pour l'application.", ar: 'اسم التطبيق التجاري الذي يظهر في الواجهة.' },
  app_language: { fr: "Langue globale proposee par defaut. Elle reste synchronisee avec la langue utilisateur ici.", ar: 'اللغة العامة الافتراضية. حاليا تتم مزامنتها مع لغة المستخدم.' },
  default_route: { fr: "Page de demarrage globale quand aucune preference utilisateur n'est definie.", ar: 'صفحة البداية العامة إذا لم تكن هناك صفحة مفضلة للمستخدم.' },
  timezone: { fr: 'Fuseau horaire utilise pour les rapports et planifications. Pour le Maroc: Africa/Casablanca.', ar: 'المنطقة الزمنية للتقارير والجدولة. في المغرب: Africa/Casablanca.' },
  date_format: { fr: 'Format global des dates dans les documents et rapports.', ar: 'الصيغة العامة للتواريخ في الوثائق والتقارير.' },
  time_format: { fr: "Choisit l'affichage horaire sur 24h ou 12h.", ar: 'يحدد عرض الوقت بنظام 24 ساعة أو 12 ساعة.' },
  compact_tables: { fr: 'Preference globale pour rendre les tableaux plus denses.', ar: 'خيار عام لجعل الجداول أكثر كثافة.' },
  show_low_stock_alerts: { fr: 'Affiche les alertes quand un produit atteint le seuil de stock faible.', ar: 'يعرض تنبيهات عندما يصل المنتج إلى عتبة انخفاض المخزون.' },
  name: { fr: 'Nom commercial imprime sur factures, tickets et rapports.', ar: 'الاسم التجاري المطبوع على الفواتير والتذاكر والتقارير.' },
  legal_name: { fr: 'Raison sociale legale de la societe.', ar: 'الاسم القانوني للشركة.' },
  store_name: { fr: 'Nom du point de vente ou magasin si different du nom commercial.', ar: 'اسم نقطة البيع أو المتجر إذا كان مختلفا عن الاسم التجاري.' },
  store_type: { fr: 'Activite principale: commerce, service, distribution, etc.', ar: 'النشاط الرئيسي: تجارة، خدمات، توزيع، إلخ.' },
  logo_url: { fr: 'Chemin ou URL du logo utilise sur les documents.', ar: 'مسار أو رابط الشعار المستخدم في الوثائق.' },
  brand_primary_color: { fr: "Couleur principale de l'interface: boutons, liens actifs et actions importantes.", ar: 'اللون الرئيسي للواجهة والأزرار والعناصر المهمة.' },
  brand_secondary_color: { fr: 'Couleur secondaire utilisee dans les accents, les graphiques et les documents.', ar: 'اللون الثانوي للهوية والوثائق.' },
  brand_success_color: { fr: 'Couleur des confirmations, paiements et etats positifs.', ar: 'لون التأكيدات والدفع والحالات الإيجابية.' },
  brand_document_color: { fr: 'Couleur forte utilisee dans les en-tetes des factures et bons.', ar: 'اللون الرئيسي لرؤوس الفواتير والوثائق.' },
  brand_print_logo_size: { fr: 'Taille du logo imprime sur les factures en pixels.', ar: 'حجم الشعار المطبوع على الفواتير بالبكسل.' },
  address: { fr: 'Adresse complete affichee sur les documents.', ar: 'العنوان الكامل الذي يظهر على الوثائق.' },
  city: { fr: 'Ville de la societe ou du magasin.', ar: 'مدينة الشركة أو المتجر.' },
  postal_code: { fr: 'Code postal utilise dans les coordonnees.', ar: 'الرمز البريدي ضمن معلومات التواصل.' },
  country: { fr: 'Pays de reference pour les documents.', ar: 'البلد المرجعي للوثائق.' },
  phone: { fr: 'Numero fixe affiche sur les documents.', ar: 'رقم الهاتف الثابت الذي يظهر في الوثائق.' },
  mobile: { fr: 'Numero mobile affiche dans les coordonnees.', ar: 'رقم الهاتف المحمول ضمن معلومات التواصل.' },
  email: { fr: 'Email public de la societe.', ar: 'البريد الإلكتروني الرسمي للشركة.' },
  website: { fr: 'Site web affiche dans les informations societe.', ar: 'الموقع الإلكتروني الذي يظهر ضمن معلومات الشركة.' },
  ice: { fr: 'Identifiant Commun de l’Entreprise au Maroc. Ne pas traduire sur les documents.', ar: 'المعرّف الموحد للمقاولة في المغرب. يبقى ICE كما هو في الوثائق.' },
  if_number: { fr: 'Identifiant Fiscal marocain. Ne pas traduire IF.', ar: 'المعرّف الضريبي المغربي. يبقى IF كما هو.' },
  rc: { fr: 'Registre de Commerce. Ne pas traduire RC.', ar: 'السجل التجاري. يبقى RC كما هو.' },
  tax_id: { fr: 'Autre identifiant fiscal si necessaire.', ar: 'معرّف ضريبي إضافي عند الحاجة.' },
  invoice_prefix: { fr: 'Prefixe utilise pour generer les numeros de factures.', ar: 'البادئة المستخدمة لتوليد أرقام الفواتير.' },
  quote_prefix: { fr: 'Prefixe utilise pour les devis.', ar: 'البادئة المستخدمة لعروض السعر.' },
  delivery_prefix: { fr: 'Prefixe utilise pour les bons de livraison.', ar: 'البادئة المستخدمة لسندات التسليم.' },
  po_prefix: { fr: 'Prefixe utilise pour les commandes fournisseurs.', ar: 'البادئة المستخدمة لطلبات الشراء من الموردين.' },
  receipt_footer: { fr: 'Message imprime en bas des tickets POS.', ar: 'رسالة تطبع أسفل تذاكر POS.' },
  invoice_notes: { fr: 'Notes par defaut a afficher sur les factures.', ar: 'ملاحظات افتراضية تظهر في الفواتير.' },
  quote_notes: { fr: 'Notes par defaut a afficher sur les devis.', ar: 'ملاحظات افتراضية تظهر في عروض السعر.' },
  sale_terms: { fr: 'Conditions commerciales visibles pour les ventes.', ar: 'الشروط التجارية الخاصة بالمبيعات.' },
  purchase_terms: { fr: 'Conditions commerciales visibles pour les achats.', ar: 'الشروط التجارية الخاصة بالمشتريات.' },
  currency: { fr: 'Devise de travail. Pour le Maroc utilisez MAD ou DH.', ar: 'عملة العمل. في المغرب استعمل MAD أو DH للدرهم المغربي.' },
  tva_rate: { fr: 'Taux TVA applique par defaut aux nouveaux produits et documents.', ar: 'معدل TVA الافتراضي للمنتجات والوثائق الجديدة.' },
  tva_enabled: { fr: 'Active la TVA par defaut dans les nouveaux documents.', ar: 'يفعّل TVA افتراضيا في الوثائق الجديدة.' },
  fiscal_year_start: { fr: 'Debut de l’exercice fiscal au format MM-JJ, par exemple 01-01.', ar: 'بداية السنة المالية بصيغة MM-JJ مثل 01-01.' },
  minimum_margin: { fr: 'Marge minimale souhaitee pour surveiller la rentabilite.', ar: 'الهامش الأدنى المطلوب لمراقبة الربحية.' },
  default_min_stock: { fr: 'Stock minimum propose par defaut lors de la creation de produits.', ar: 'الحد الأدنى للمخزون المقترح عند إنشاء المنتجات.' },
  low_stock_threshold: { fr: 'Seuil utilise pour declencher les alertes de stock faible.', ar: 'العتبة التي تطلق تنبيهات انخفاض المخزون.' },
  report_email_enabled: { fr: 'Autorise l’envoi de rapports par email.', ar: 'يسمح بإرسال التقارير عبر Email.' },
  report_email_recipients: { fr: 'Emails principaux separes par des virgules.', ar: 'عناوين Email الرئيسية مفصولة بفواصل.' },
  report_email_cc: { fr: 'Destinataires en copie visible.', ar: 'مستلمون في نسخة ظاهرة CC.' },
  report_email_bcc: { fr: 'Destinataires en copie cachee.', ar: 'مستلمون في نسخة مخفية BCC.' },
  report_email_reply_to: { fr: 'Adresse de reponse affichee au destinataire.', ar: 'عنوان الرد الذي يظهر للمستلم.' },
  report_email_subject_prefix: { fr: 'Debut du sujet des emails de rapport.', ar: 'بداية عنوان رسائل التقارير.' },
  report_email_include_profit: { fr: 'Ajoute les indicateurs de profit et pertes au rapport.', ar: 'يضيف مؤشرات الأرباح والخسائر للتقرير.' },
  report_email_include_sales_by_category: { fr: 'Ajoute les ventes regroupees par categorie.', ar: 'يضيف المبيعات مجمعة حسب الفئة.' },
  report_email_include_stock_value: { fr: 'Ajoute la valeur du stock au rapport.', ar: 'يضيف قيمة المخزون للتقرير.' },
  report_email_include_cash: { fr: 'Ajoute les informations de caisse au rapport.', ar: 'يضيف معلومات الصندوق للتقرير.' },
  report_email_include_expenses: { fr: 'Ajoute les depenses au rapport.', ar: 'يضيف المصاريف للتقرير.' },
  report_email_include_purchases: { fr: 'Ajoute les achats au rapport.', ar: 'يضيف المشتريات للتقرير.' },
  smtp_host: { fr: 'Serveur SMTP utilise pour envoyer les emails.', ar: 'خادم SMTP المستخدم لإرسال Email.' },
  smtp_port: { fr: 'Port SMTP. 587 pour STARTTLS, 465 pour SSL/TLS en general.', ar: 'منفذ SMTP. غالبا 587 مع STARTTLS و465 مع SSL/TLS.' },
  smtp_security: { fr: 'Mode de securite utilise par le serveur SMTP.', ar: 'وضع الأمان المستخدم من خادم SMTP.' },
  smtp_username: { fr: 'Identifiant du compte SMTP.', ar: 'اسم مستخدم حساب SMTP.' },
  smtp_password: { fr: 'Mot de passe SMTP ou App password selon le fournisseur.', ar: 'كلمة مرور SMTP أو App password حسب المزود.' },
  smtp_from_email: { fr: 'Adresse email qui envoie les rapports.', ar: 'عنوان Email الذي يرسل التقارير.' },
  smtp_from_name: { fr: 'Nom affiche comme expediteur.', ar: 'الاسم الذي يظهر كمرسل.' },
  smtp_timeout_seconds: { fr: 'Delai maximum avant d’abandonner une tentative SMTP.', ar: 'أقصى مدة قبل إلغاء محاولة SMTP.' },
  report_schedule_frequency: { fr: 'Frequence de generation du rapport planifie.', ar: 'تكرار إنشاء التقرير المجدول.' },
  report_schedule_time: { fr: 'Heure locale d’envoi du rapport.', ar: 'الوقت المحلي لإرسال التقرير.' },
  report_schedule_day_of_week: { fr: 'Jour utilise quand la frequence est hebdomadaire.', ar: 'اليوم المستخدم عند اختيار التكرار الأسبوعي.' },
  report_schedule_day_of_month: { fr: 'Jour utilise pour les rapports mensuels ou annuels.', ar: 'اليوم المستخدم للتقارير الشهرية أو السنوية.' },
  report_schedule_month: { fr: 'Mois utilise quand la frequence est annuelle.', ar: 'الشهر المستخدم عند اختيار التكرار السنوي.' },
  report_schedule_timezone: { fr: 'Fuseau horaire de la planification.', ar: 'المنطقة الزمنية الخاصة بالجدولة.' },
  report_schedule_last_sent_at: { fr: 'Date du dernier envoi automatique ou manuel.', ar: 'تاريخ آخر إرسال تلقائي أو يدوي.' },
  report_period: { fr: 'Periode couverte par le rapport manuel.', ar: 'الفترة التي يغطيها التقرير اليدوي.' },
  report_start_date: { fr: 'Date de debut utilisee uniquement en periode personnalisee.', ar: 'تاريخ البداية ويستخدم فقط عند اختيار فترة مخصصة.' },
  report_end_date: { fr: 'Date de fin utilisee uniquement en periode personnalisee.', ar: 'تاريخ النهاية ويستخدم فقط عند اختيار فترة مخصصة.' },
}

export default function SettingsPage() {
  const { user, updateProfile, changePassword } = useAuth()
  const { language, setLanguage, t } = useI18n()
  const confirm = useConfirm()
  const location = useLocation()
  const navigate = useNavigate()
  const initialTab = new URLSearchParams(location.search).get('tab') || 'user'
  const [activeTab, setActiveTab] = useState(initialTab)
  const [form, setForm] = useState({})
  const [categories, setCategories] = useState([])
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' })
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '' })
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [sendingReport, setSendingReport] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [backups, setBackups] = useState({ items: [], database_path: '', backup_dir: '', max_backups: 30 })
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [auditLogs, setAuditLogs] = useState([])
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [systemHealth, setSystemHealth] = useState(null)
  const [loadingSystem, setLoadingSystem] = useState(false)
  const [reportRequest, setReportRequest] = useState({
    period_type: 'daily',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
  })

  const listFromSetting = (key, fallback = []) => String(form[key] || fallback.join(','))
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  const setListSetting = (key, values) => setValue(key, values.map(v => String(v).trim()).filter(Boolean).join(','))

  const addListValue = (key, value) => {
    const cleaned = String(value || '').trim()
    if (!cleaned) return
    const values = listFromSetting(key)
    if (!values.some(item => item.toLowerCase() === cleaned.toLowerCase())) setListSetting(key, [...values, cleaned])
  }

  const removeListValue = (key, value) => setListSetting(key, listFromSetting(key).filter(item => item !== value))

  const switchTab = (id) => {
    setActiveTab(id)
    navigate(`/settings?tab=${id}`, { replace: true })
  }

  useEffect(() => {
    let mounted = true
    api.get('/settings')
      .then(r => {
        if (!mounted) return
        const data = {
          ...r.data,
          user_language: r.data.user_language || r.data.app_language || language,
          app_language: r.data.app_language || 'fr',
          currency: r.data.currency || 'MAD',
          price_tax_mode: r.data.price_tax_mode || 'exclusive',
          rounding_scope: r.data.rounding_scope || 'line',
          rounding_mode: 'half_up',
          tax_rates: r.data.tax_rates || '0,7,10,14,20',
        }
        setForm(data)
        setLanguage(data.user_language)
      })
      .catch(e => toast.error(e.response?.data?.detail || t('common.loadingError')))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name || '',
      email: user?.email || '',
    })
  }, [user])

  useEffect(() => {
    if (!form || Object.keys(form).length === 0) return
    applyVisualIdentity(form)
  }, [
    form.brand_primary_color,
    form.brand_secondary_color,
    form.brand_success_color,
    form.brand_document_color,
    form.brand_print_logo_size,
  ])

  const completion = useMemo(() => {
    const keys = ['name', 'address', 'city', 'phone', 'email', 'ice', 'currency', 'invoice_prefix']
    const filled = keys.filter(key => String(form[key] ?? '').trim()).length
    return Math.round((filled / keys.length) * 100)
  }, [form])

  const setValue = (key, value) => {
    const nextValue = key === 'currency' ? String(value || '').toUpperCase() : value
    setForm(prev => {
      if (key === 'user_language' || key === 'app_language') {
        return { ...prev, user_language: nextValue, app_language: nextValue }
      }
      return { ...prev, [key]: nextValue }
    })
    if (key === 'user_language' || key === 'app_language') setLanguage(nextValue)
  }
  const F = key => ({ value: form[key] ?? '', onChange: e => setValue(key, e.target.value) })
  const FP = key => ({ value: profileForm[key] ?? '', onChange: e => setProfileForm(prev => ({ ...prev, [key]: e.target.value })) })
  const FN = key => ({ value: form[key] ?? 0, onChange: e => setValue(key, Number(e.target.value) || 0) })
  const FB = key => ({ checked: Boolean(form[key]), onChange: e => setValue(key, e.target.checked) })

  const languageOptions = Object.entries(LANGUAGES).map(([value, meta]) => (
    <option key={value} value={value}>{meta.nativeLabel}</option>
  ))

  const routeOptions = ROUTES.map(([value, labelKey]) => (
    <option key={value} value={value}>{t(labelKey)}</option>
  ))

  const help = (key) => HELP[key]?.[language] || HELP[key]?.fr || ''

  const loadBackups = async () => {
    setLoadingBackups(true)
    try {
      const { data } = await api.get('/backups')
      setBackups(data || { items: [] })
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Impossible de charger les sauvegardes')
    } finally {
      setLoadingBackups(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'backup') loadBackups()
  }, [activeTab])

  const loadCategories = async () => {
    try {
      const { data } = await api.get('/categories')
      setCategories(data || [])
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Impossible de charger les categories')
    }
  }

  useEffect(() => {
    if (activeTab === 'catalog') loadCategories()
  }, [activeTab])

  const createCategory = async () => {
    if (!categoryForm.name.trim()) return toast.error('Nom categorie obligatoire')
    try {
      await api.post('/categories', categoryForm)
      toast.success('Categorie creee')
      setCategoryForm({ name: '', description: '' })
      loadCategories()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Creation categorie impossible')
    }
  }

  const deleteCategory = async (category) => {
    const ok = await confirm({
      title: 'Supprimer categorie',
      message: `Supprimer "${category.name}" ? Verifiez qu'aucun produit ne depend de cette categorie.`,
      confirmText: 'Supprimer',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/categories/${category.id}`)
      toast.success('Categorie supprimee')
      loadCategories()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Suppression impossible')
    }
  }

  const loadAuditLogs = async () => {
    setLoadingAudit(true)
    try {
      const { data } = await api.get('/audit', { params: { limit: 150 } })
      setAuditLogs(data || [])
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Impossible de charger le journal')
    } finally {
      setLoadingAudit(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'audit') loadAuditLogs()
  }, [activeTab])

  const loadSystemHealth = async () => {
    setLoadingSystem(true)
    try {
      const { data } = await api.get('/system/health')
      setSystemHealth(data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Impossible de charger la sante systeme')
    } finally {
      setLoadingSystem(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'system') loadSystemHealth()
  }, [activeTab])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { ...form, currency: (form.currency || 'MAD').trim().toUpperCase() }
      const { data } = await api.put('/settings', payload)
      setForm(data)
      applyVisualIdentity(data)
      setLanguage(data.user_language || data.app_language || language)
      toast.success(t('common.saved'))
    } catch (e) {
      toast.error(e.response?.data?.detail || t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      await updateProfile(profileForm)
      toast.success(t('common.profileUpdated'))
    } catch (e) {
      toast.error(e.response?.data?.detail || t('common.profileUpdateError'))
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) return toast.error('La confirmation du mot de passe ne correspond pas')
    setSavingProfile(true)
    try {
      await changePassword(passwordForm.current_password, passwordForm.new_password)
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      toast.success('Mot de passe modifie. Reconnexion requise.')
      navigate('/login', { replace: true })
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Modification du mot de passe impossible')
    } finally {
      setSavingProfile(false)
    }
  }

  const sendTestEmail = async () => {
    setTestingEmail(true)
    try {
      const { data } = await api.put('/settings', form)
      setForm(data)
      await api.post('/reports/email/test', { recipient: form.report_email_recipients || form.smtp_from_email })
      toast.success(t('settings.testEmailSent'))
    } catch (e) {
      toast.error(e.response?.data?.detail || t('settings.testEmailError'))
    } finally {
      setTestingEmail(false)
    }
  }

  const sendReportNow = async () => {
    setSendingReport(true)
    try {
      const saved = await api.put('/settings', form)
      setForm(saved.data)
      await api.post('/reports/email/send', {
        ...reportRequest,
        recipients: form.report_email_recipients,
        include_profit: form.report_email_include_profit,
        include_sales_by_category: form.report_email_include_sales_by_category,
        include_stock_value: form.report_email_include_stock_value,
        include_cash: form.report_email_include_cash,
        include_expenses: form.report_email_include_expenses,
        include_purchases: form.report_email_include_purchases,
      })
      toast.success(t('settings.reportSent'))
    } catch (e) {
      toast.error(e.response?.data?.detail || t('settings.reportError'))
    } finally {
      setSendingReport(false)
    }
  }

  const createBackup = async () => {
    setBackupBusy(true)
    try {
      await api.post('/backups')
      await loadBackups()
      toast.success('Sauvegarde creee')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur de sauvegarde')
    } finally {
      setBackupBusy(false)
    }
  }

  const createEncryptedBackup = async () => {
    if (!backupPassphrase || backupPassphrase.length < 8) return toast.error('Passphrase obligatoire: 8 caracteres minimum')
    setBackupBusy(true)
    try {
      await api.post('/backups/encrypted', { passphrase: backupPassphrase })
      setBackupPassphrase('')
      await loadBackups()
      toast.success('Sauvegarde chiffree creee')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur de sauvegarde chiffree')
    } finally {
      setBackupBusy(false)
    }
  }

  const downloadBackup = async (name) => {
    try {
      const { data } = await api.get(`/backups/${encodeURIComponent(name)}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Telechargement impossible')
    }
  }

  const deleteBackup = async (name) => {
    const ok = await confirm({
      title: 'Supprimer sauvegarde',
      message: `Supprimer la sauvegarde ${name} ?`,
      confirmText: 'Supprimer',
      tone: 'danger',
    })
    if (!ok) return
    setBackupBusy(true)
    try {
      await api.delete(`/backups/${encodeURIComponent(name)}`)
      await loadBackups()
      toast.success('Sauvegarde supprimee')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Suppression impossible')
    } finally {
      setBackupBusy(false)
    }
  }

  const restoreBackup = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const ok = await confirm({
      title: 'Restaurer sauvegarde',
      message: 'Restaurer cette sauvegarde ? Une sauvegarde de securite sera creee avant remplacement.',
      confirmText: 'Restaurer',
      tone: 'warning',
    })
    if (!ok) return
    setBackupBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      await api.post('/backups/restore', body, { headers: { 'Content-Type': 'multipart/form-data' } })
      await loadBackups()
      toast.success('Sauvegarde restauree. Rechargez la page pour voir toutes les donnees.')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Restauration impossible')
    } finally {
      setBackupBusy(false)
    }
  }

  const restoreEncryptedBackup = async (name) => {
    const passphrase = window.prompt('Passphrase de dechiffrement')
    if (!passphrase) return
    const ok = await confirm({
      title: 'Restaurer sauvegarde chiffree',
      message: `Restaurer ${name} ? Une sauvegarde de securite sera creee avant remplacement.`,
      confirmText: 'Restaurer',
      tone: 'warning',
    })
    if (!ok) return
    setBackupBusy(true)
    try {
      await api.post('/backups/restore-encrypted', { name, passphrase })
      await loadBackups()
      toast.success('Sauvegarde chiffree restauree. Rechargez la page pour voir toutes les donnees.')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Restauration chiffree impossible')
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div className="page-content settings-page">
      <div className="page-header settings-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
          {saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Save size={16} />}
          {t('common.save')}
        </button>
      </div>

      <div className="settings-shell">
        <aside className="settings-nav">
          <div className="settings-score">
            <span>{t('settings.configuration')}</span>
            <strong>{completion}%</strong>
            <div><i style={{ width: `${completion}%` }} /></div>
          </div>
          {TABS.map(({ id, labelKey, label, icon: Icon }) => (
            <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => switchTab(id)}>
              <Icon size={17} />
              <span>{label || t(labelKey)}</span>
            </button>
          ))}
        </aside>

        <section className="settings-panel">
          {loading ? (
            <div className="settings-loading"><span className="spinner" /></div>
          ) : (
            <>
              {activeTab === 'user' && (
                <div className="settings-grid">
                  <SettingsCard icon={UserCog} title={t('settings.profileTitle')} hint={t('settings.profileHint')}>
                    <ReadOnly label={t('common.username')} value={user?.username} />
                    <Field label={t('common.fullName')} help={help('full_name')}><input {...FP('full_name')} placeholder={t('common.fullName')} /></Field>
                    <Field label={t('common.email')} help={help('profile_email')}><input {...FP('email')} type="email" placeholder="email@exemple.com" /></Field>
                    <ReadOnly label={t('common.role')} value={user?.role_name || t('common.user')} />
                    <button className="btn btn-primary" onClick={handleSaveProfile} disabled={savingProfile}>
                      {savingProfile ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Save size={16} />}
                      {t('settings.updateProfile')}
                    </button>
                  </SettingsCard>
                  <SettingsCard icon={ShieldCheck} title="Changer le mot de passe" hint="Le mot de passe actuel est requis et toutes les sessions seront revoquees.">
                    <Field label="Mot de passe actuel"><input type="password" autoComplete="current-password" value={passwordForm.current_password} onChange={e => setPasswordForm(prev => ({ ...prev, current_password: e.target.value }))} /></Field>
                    <Field label="Nouveau mot de passe"><input type="password" autoComplete="new-password" value={passwordForm.new_password} onChange={e => setPasswordForm(prev => ({ ...prev, new_password: e.target.value }))} /></Field>
                    <Field label="Confirmer le nouveau mot de passe"><input type="password" autoComplete="new-password" value={passwordForm.confirm_password} onChange={e => setPasswordForm(prev => ({ ...prev, confirm_password: e.target.value }))} /></Field>
                    <button className="btn btn-secondary" onClick={handleChangePassword} disabled={savingProfile || !passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password}>Changer et fermer les sessions</button>
                  </SettingsCard>
                  <SettingsCard icon={Bell} title={t('settings.preferencesTitle')} hint={t('settings.preferencesHint')}>
                    <Field label={t('settings.language')} help={help('user_language')}><select {...F('user_language')}>{languageOptions}</select></Field>
                    <Field label={t('settings.defaultPage')} help={help('user_default_page')}><select {...F('user_default_page')}>{routeOptions}</select></Field>
                    <Field label={t('settings.dateFormat')} help={help('user_date_format')}><select {...F('user_date_format')}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></Field>
                    <Toggle label={t('settings.compactTablesMode')} help={help('user_compact_mode')} {...FB('user_compact_mode')} />
                    <Toggle label={t('settings.notifications')} help={help('user_notifications')} {...FB('user_notifications')} />
                    <Toggle label={t('settings.sidebarCollapsed')} help={help('user_sidebar_default_collapsed')} {...FB('user_sidebar_default_collapsed')} />
                  </SettingsCard>
                  <SettingsCard icon={ShieldCheck} title={t('settings.securityTitle')} hint={t('settings.securityHint')}>
                    <div className="settings-note">{t('settings.securityNote')}</div>
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'app' && (
                <div className="settings-grid">
                  <SettingsCard icon={Settings} title={t('settings.appTitle')} hint={t('settings.appHint')}>
                    <Field label={t('settings.appName')} help={help('app_name')}><input {...F('app_name')} placeholder="ProERP" /></Field>
                    <Field label={t('settings.defaultLanguage')} help={help('app_language')}><select {...F('app_language')}>{languageOptions}</select></Field>
                    <Field label={t('settings.startPage')} help={help('default_route')}><select {...F('default_route')}>{routeOptions}</select></Field>
                    <Field label={t('settings.timezone')} help={help('timezone')}><input {...F('timezone')} placeholder="Africa/Casablanca" /></Field>
                  </SettingsCard>
                  <SettingsCard icon={Globe2} title={t('settings.displayTitle')} hint={t('settings.displayHint')}>
                    <Field label={t('settings.dateFormat')} help={help('date_format')}><select {...F('date_format')}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></Field>
                    <Field label={t('settings.timeFormat')} help={help('time_format')}><select {...F('time_format')}><option value="24h">{t('settings.24h')}</option><option value="12h">{t('settings.12h')}</option></select></Field>
                    <Toggle label={t('settings.compactTables')} help={help('compact_tables')} {...FB('compact_tables')} />
                    <Toggle label={t('settings.lowStockAlerts')} help={help('show_low_stock_alerts')} {...FB('show_low_stock_alerts')} />
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'identity' && (
                <div className="settings-grid">
                  <SettingsCard icon={Bell} title="Identite visuelle" hint="Logo, couleurs de marque et rendu des documents.">
                    <Field label={t('settings.logoUrl')} help={help('logo_url')}>
                      <input {...F('logo_url')} placeholder="/brand/proerp-logo.svg ou https://..." />
                    </Field>
                    <div className="settings-two">
                      <Field label="Couleur principale" help={help('brand_primary_color')}>
                        <ColorField value={form.brand_primary_color || '#2563EB'} onChange={value => setValue('brand_primary_color', value)} />
                      </Field>
                      <Field label="Couleur secondaire" help={help('brand_secondary_color')}>
                        <ColorField value={form.brand_secondary_color || '#0891B2'} onChange={value => setValue('brand_secondary_color', value)} />
                      </Field>
                    </div>
                    <div className="settings-two">
                      <Field label="Couleur succes" help={help('brand_success_color')}>
                        <ColorField value={form.brand_success_color || '#16A34A'} onChange={value => setValue('brand_success_color', value)} />
                      </Field>
                      <Field label="Couleur documents" help={help('brand_document_color')}>
                        <ColorField value={form.brand_document_color || '#111827'} onChange={value => setValue('brand_document_color', value)} />
                      </Field>
                    </div>
                    <Field label="Taille logo facture" help={help('brand_print_logo_size')} hint="Entre 28 et 96 px.">
                      <input type="number" min="28" max="96" {...FN('brand_print_logo_size')} />
                    </Field>
                    <button className="btn btn-secondary" onClick={() => {
                      setForm(prev => ({
                        ...prev,
                        logo_url: '/brand/proerp-logo.svg',
                        brand_primary_color: '#2563EB',
                        brand_secondary_color: '#0891B2',
                        brand_success_color: '#16A34A',
                        brand_document_color: '#111827',
                        brand_print_logo_size: 42,
                      }))
                    }}>Reinitialiser identite</button>
                  </SettingsCard>
                  <SettingsCard icon={MonitorCog} title="Apercu direct" hint="Controle rapide du rendu application et facture.">
                    <IdentityPreview settings={form} />
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'company' && (
                <div className="settings-grid">
                  <SettingsCard icon={Building2} title={t('settings.companyTitle')} hint={t('settings.companyHint')}>
                    <Field label={t('settings.tradeName')} help={help('name')}><input {...F('name')} placeholder="Ma Societe SARL" /></Field>
                    <Field label={t('settings.legalName')} help={help('legal_name')}><input {...F('legal_name')} /></Field>
                    <Field label={t('settings.storeName')} help={help('store_name')}><input {...F('store_name')} /></Field>
                    <Field label={t('settings.activityType')} help={help('store_type')}><input {...F('store_type')} placeholder="Commerce, service, distribution..." /></Field>
                  </SettingsCard>
                  <SettingsCard icon={Globe2} title={t('settings.contactTitle')} hint={t('settings.contactHint')}>
                    <Field label={t('settings.address')} help={help('address')}><textarea {...F('address')} rows={3} /></Field>
                    <div className="settings-two">
                      <Field label={t('settings.city')} help={help('city')}><input {...F('city')} /></Field>
                      <Field label={t('settings.postalCode')} help={help('postal_code')}><input {...F('postal_code')} /></Field>
                    </div>
                    <Field label={t('settings.country')} help={help('country')}><input {...F('country')} /></Field>
                    <div className="settings-two">
                      <Field label={t('settings.phone')} help={help('phone')}><input {...F('phone')} /></Field>
                      <Field label={t('settings.mobile')} help={help('mobile')}><input {...F('mobile')} /></Field>
                    </div>
                    <Field label={t('common.email')} help={help('email')}><input {...F('email')} type="email" /></Field>
                    <Field label={t('settings.website')} help={help('website')}><input {...F('website')} /></Field>
                  </SettingsCard>
                  <SettingsCard icon={ShieldCheck} title={t('settings.legalTitle')} hint={t('settings.legalHint')}>
                    <Field label="ICE" help={help('ice')}><input {...F('ice')} /></Field>
                    <Field label="IF" help={help('if_number')}><input {...F('if_number')} /></Field>
                    <Field label="RC" help={help('rc')}><input {...F('rc')} /></Field>
                    <Field label="Tax ID" help={help('tax_id')}><input {...F('tax_id')} /></Field>
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'documents' && (
                <div className="settings-grid">
                  <SettingsCard icon={FileText} title={t('settings.numberingTitle')} hint={t('settings.numberingHint')}>
                    <div className="settings-two">
                      <Field label={t('settings.invoicePrefix')} help={help('invoice_prefix')}><input {...F('invoice_prefix')} placeholder="FAC" /></Field>
                      <Field label={t('settings.quotePrefix')} help={help('quote_prefix')}><input {...F('quote_prefix')} placeholder="DEV" /></Field>
                    </div>
                    <div className="settings-two">
                      <Field label={t('settings.deliveryPrefix')} help={help('delivery_prefix')}><input {...F('delivery_prefix')} placeholder="BL" /></Field>
                      <Field label={t('settings.poPrefix')} help={help('po_prefix')}><input {...F('po_prefix')} placeholder="BC" /></Field>
                    </div>
                    <div className="settings-two">
                      <Field label="Préfixe avoir" hint="Utilisé uniquement pour les nouveaux avoirs."><input {...F('credit_note_prefix')} placeholder="AV" /></Field>
                      <Field label="Préfixe réception achat" hint="Utilisé uniquement pour les nouveaux bons de réception."><input {...F('purchase_receipt_prefix')} placeholder="BR" /></Field>
                    </div>
                    <div className="settings-note">
                      Changer un préfixe ne modifie aucun ancien numéro et ne remet pas le compteur annuel à zéro.
                    </div>
                  </SettingsCard>
                  <SettingsCard icon={ReceiptText} title={t('settings.documentMessagesTitle')} hint={t('settings.documentMessagesHint')}>
                    <Field label={t('settings.receiptFooter')} help={help('receipt_footer')}><textarea {...F('receipt_footer')} rows={2} /></Field>
                    <Field label={t('settings.invoiceNotes')} help={help('invoice_notes')}><textarea {...F('invoice_notes')} rows={3} /></Field>
                    <Field label={t('settings.quoteNotes')} help={help('quote_notes')}><textarea {...F('quote_notes')} rows={3} /></Field>
                  </SettingsCard>
                  <SettingsCard icon={CalendarDays} title={t('settings.termsTitle')} hint={t('settings.termsHint')}>
                    <Field label={t('settings.saleTerms')} help={help('sale_terms')}><textarea {...F('sale_terms')} rows={3} /></Field>
                    <Field label={t('settings.purchaseTerms')} help={help('purchase_terms')}><textarea {...F('purchase_terms')} rows={3} /></Field>
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'finance' && (
                <div className="settings-grid">
                  <SettingsCard icon={ReceiptText} title={t('settings.taxTitle')} hint={t('settings.taxHint')}>
                    <Field label={t('settings.currency')} hint={t('settings.currencyHelp')} help={help('currency')}><input {...F('currency')} placeholder="MAD" /></Field>
                    <Field label="Mode des prix" hint="Définit si les prix saisis sont hors taxe ou toutes taxes comprises.">
                      <select {...F('price_tax_mode')}>
                        <option value="exclusive">Hors taxe (HT)</option>
                        <option value="inclusive">Toutes taxes comprises (TTC)</option>
                      </select>
                    </Field>
                    <Field label="Portée de l'arrondi" hint="L'arrondi document répartit les centimes résiduels entre les lignes.">
                      <select {...F('rounding_scope')}>
                        <option value="line">Chaque ligne</option>
                        <option value="document">Document complet</option>
                      </select>
                    </Field>
                    <Field label="Taux TVA autorisés" hint="Liste séparée par des virgules, utilisée pour valider produits et documents."><input {...F('tax_rates')} placeholder="0,7,10,14,20" /></Field>
                    <div className="settings-note">Arrondi monétaire: commercial, au centime, ROUND_HALF_UP. Les totaux finaux sont toujours calculés par le serveur.</div>
                    <Field label={t('settings.vatRate')} help={help('tva_rate')}><input type="number" min="0" max="100" {...FN('tva_rate')} /></Field>
                    <Toggle label={t('settings.vatEnabled')} help={help('tva_enabled')} {...FB('tva_enabled')} />
                    <Field label={t('settings.fiscalYearStart')} help={help('fiscal_year_start')}><input {...F('fiscal_year_start')} placeholder="01-01" /></Field>
                  </SettingsCard>
                  <SettingsCard icon={Store} title={t('settings.stockMarginTitle')} hint={t('settings.stockMarginHint')}>
                    <Field label={t('settings.minimumMargin')} help={help('minimum_margin')}><input type="number" min="0" {...FN('minimum_margin')} /></Field>
                    <Field label={t('settings.defaultMinStock')} help={help('default_min_stock')}><input type="number" min="0" {...FN('default_min_stock')} /></Field>
                    <Field label={t('settings.lowStockThreshold')} help={help('low_stock_threshold')}><input type="number" min="0" {...FN('low_stock_threshold')} /></Field>
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'catalog' && (
                <div className="settings-grid">
                  <SettingsCard icon={ListChecks} title="Categories produits" hint="Familles utilisees dans la creation, le filtre et les rapports produits.">
                    <div className="settings-two">
                      <Field label="Nom categorie"><input value={categoryForm.name} onChange={e => setCategoryForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Accessoires" /></Field>
                      <Field label="Description"><input value={categoryForm.description} onChange={e => setCategoryForm(f => ({ ...f, description: e.target.value }))} placeholder="Optionnel" /></Field>
                    </div>
                    <button className="btn btn-primary" onClick={createCategory}><Plus size={16} /> Ajouter categorie</button>
                    <div className="settings-chip-list">
                      {categories.map(category => (
                        <span key={category.id} className="settings-chip">
                          {category.name}
                          <button onClick={() => deleteCategory(category)} title="Supprimer"><Trash2 size={13} /></button>
                        </span>
                      ))}
                      {categories.length === 0 && <div className="settings-note">Aucune categorie creee.</div>}
                    </div>
                  </SettingsCard>

                  <SettingsCard icon={PackageCheck} title="Unites produits" hint="Unites proposees lors de la creation des produits et services.">
                    <EditableList
                      values={listFromSetting('product_units', ['pcs', 'kg', 'g', 'l', 'ml'])}
                      placeholder="Ajouter unite: carton, palette..."
                      onAdd={value => addListValue('product_units', value)}
                      onRemove={value => removeListValue('product_units', value)}
                    />
                  </SettingsCard>

                  <SettingsCard icon={ReceiptText} title="Modes de paiement" hint="Valeurs utilisees dans ventes, achats, credits et caisse.">
                    <EditableList
                      values={listFromSetting('payment_modes', ['Espece', 'Carte', 'Virement', 'Cheque', 'Autre'])}
                      placeholder="Ajouter mode..."
                      onAdd={value => addListValue('payment_modes', value)}
                      onRemove={value => removeListValue('payment_modes', value)}
                    />
                  </SettingsCard>

                  <SettingsCard icon={TrendingDownIcon} title="Categories depenses" hint="Categories proposees dans le module depenses.">
                    <EditableList
                      values={listFromSetting('expense_categories', ['Loyer', 'Salaires', 'Fournitures', 'Autre'])}
                      placeholder="Ajouter categorie depense..."
                      onAdd={value => addListValue('expense_categories', value)}
                      onRemove={value => removeListValue('expense_categories', value)}
                    />
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'email' && (
                <div className="settings-grid">
                  <SettingsCard icon={Mail} title={t('settings.emailContentTitle')} hint={t('settings.emailContentHint')}>
                    <Toggle label={t('settings.enableEmailReports')} help={help('report_email_enabled')} {...FB('report_email_enabled')} />
                    <Field label={t('settings.primaryRecipients')} help={help('report_email_recipients')}><input {...F('report_email_recipients')} placeholder="admin@exemple.com, finance@exemple.com" /></Field>
                    <Field label="CC" help={help('report_email_cc')}><input {...F('report_email_cc')} placeholder="optionnel" /></Field>
                    <Field label="BCC" help={help('report_email_bcc')}><input {...F('report_email_bcc')} placeholder="optionnel" /></Field>
                    <Field label="Reply-To" help={help('report_email_reply_to')}><input {...F('report_email_reply_to')} placeholder="support@exemple.com" /></Field>
                    <Field label={t('settings.subjectPrefix')} help={help('report_email_subject_prefix')}><input {...F('report_email_subject_prefix')} placeholder="Rapport ProERP" /></Field>
                    <div className="settings-check-grid">
                      <Toggle label={t('settings.profitLoss')} help={help('report_email_include_profit')} {...FB('report_email_include_profit')} />
                      <Toggle label={t('settings.salesByCategory')} help={help('report_email_include_sales_by_category')} {...FB('report_email_include_sales_by_category')} />
                      <Toggle label={t('settings.stockValue')} help={help('report_email_include_stock_value')} {...FB('report_email_include_stock_value')} />
                      <Toggle label={t('nav.cash')} help={help('report_email_include_cash')} {...FB('report_email_include_cash')} />
                      <Toggle label={t('nav.expenses')} help={help('report_email_include_expenses')} {...FB('report_email_include_expenses')} />
                      <Toggle label={t('nav.purchases')} help={help('report_email_include_purchases')} {...FB('report_email_include_purchases')} />
                    </div>
                  </SettingsCard>

                  <SettingsCard icon={Settings} title="SMTP" hint={t('settings.smtpHint')}>
                    <Field label="SMTP host" help={help('smtp_host')}><input {...F('smtp_host')} placeholder="smtp.gmail.com" /></Field>
                    <div className="settings-two">
                      <Field label="Port" help={help('smtp_port')}><input type="number" min="1" {...FN('smtp_port')} /></Field>
                      <Field label="Securite" help={help('smtp_security')}><select {...F('smtp_security')}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">Aucune</option></select></Field>
                    </div>
                    <Field label={t('settings.smtpUser')} help={help('smtp_username')}><input {...F('smtp_username')} autoComplete="off" /></Field>
                    <div className="settings-note">
                      <strong>{form.smtp_password_configured ? 'Mot de passe SMTP configure' : 'Mot de passe SMTP non configure'}</strong>
                      <span>La valeur est protegee cote serveur via la variable SMTP_PASSWORD et n'est jamais renvoyee au navigateur.</span>
                    </div>
                    <Field label={t('settings.fromEmail')} help={help('smtp_from_email')}><input {...F('smtp_from_email')} placeholder="noreply@exemple.com" /></Field>
                    <Field label={t('settings.fromName')} help={help('smtp_from_name')}><input {...F('smtp_from_name')} placeholder="ProERP" /></Field>
                    <Field label={t('settings.timeoutSeconds')} help={help('smtp_timeout_seconds')}><input type="number" min="5" {...FN('smtp_timeout_seconds')} /></Field>
                    <button className="btn btn-secondary" onClick={sendTestEmail} disabled={testingEmail || saving}>
                      {testingEmail ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Mail size={16} />}
                      {t('settings.testSmtp')}
                    </button>
                  </SettingsCard>

                  <SettingsCard icon={CalendarDays} title={t('settings.scheduleTitle')} hint={t('settings.scheduleHint')}>
                    <Field label={t('settings.frequency')} help={help('report_schedule_frequency')}><select {...F('report_schedule_frequency')}><option value="daily">{t('settings.daily')}</option><option value="weekly">{t('settings.weekly')}</option><option value="monthly">{t('settings.monthly')}</option><option value="yearly">{t('settings.yearly')}</option></select></Field>
                    <Field label={t('settings.sendTime')} help={help('report_schedule_time')}><input type="time" {...F('report_schedule_time')} /></Field>
                    <Field label={t('settings.weekDay')} help={help('report_schedule_day_of_week')}><select {...FN('report_schedule_day_of_week')}>{WEEK_DAYS.map(([v, key]) => <option key={v} value={v}>{t(key)}</option>)}</select></Field>
                    <div className="settings-two">
                      <Field label={t('settings.monthDay')} help={help('report_schedule_day_of_month')}><input type="number" min="1" max="31" {...FN('report_schedule_day_of_month')} /></Field>
                      <Field label={t('settings.yearMonth')} help={help('report_schedule_month')}><input type="number" min="1" max="12" {...FN('report_schedule_month')} /></Field>
                    </div>
                    <Field label={t('settings.timezone')} help={help('report_schedule_timezone')}><input {...F('report_schedule_timezone')} placeholder="Africa/Casablanca" /></Field>
                    <ReadOnly label={t('settings.lastSent')} help={help('report_schedule_last_sent_at')} value={form.report_schedule_last_sent_at || t('common.never')} />
                    <div className="settings-note">{t('settings.scheduleNote')}</div>
                  </SettingsCard>

                  <SettingsCard icon={Send} title={t('settings.sendNowTitle')} hint={t('settings.sendNowHint')}>
                    <Field label={t('settings.period')} help={help('report_period')}><select value={reportRequest.period_type} onChange={e => setReportRequest(r => ({ ...r, period_type: e.target.value }))}><option value="daily">{t('settings.today')}</option><option value="weekly">{t('settings.thisWeek')}</option><option value="monthly">{t('settings.thisMonth')}</option><option value="yearly">{t('settings.thisYear')}</option><option value="custom">{t('settings.custom')}</option></select></Field>
                    <div className="settings-two">
                      <Field label={t('settings.startDate')} help={help('report_start_date')}><input type="date" value={reportRequest.start_date} onChange={e => setReportRequest(r => ({ ...r, start_date: e.target.value }))} disabled={reportRequest.period_type !== 'custom'} /></Field>
                      <Field label={t('settings.endDate')} help={help('report_end_date')}><input type="date" value={reportRequest.end_date} onChange={e => setReportRequest(r => ({ ...r, end_date: e.target.value }))} disabled={reportRequest.period_type !== 'custom'} /></Field>
                    </div>
                    <button className="btn btn-primary" onClick={sendReportNow} disabled={sendingReport || saving}>
                      {sendingReport ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Send size={16} />}
                      {t('settings.sendReport')}
                    </button>
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'backup' && (
                <div className="settings-grid">
                  <SettingsCard icon={DatabaseBackup} title="Sauvegarde locale" hint="Creez une copie complete de la base, des parametres et des images.">
                    <div className="settings-note">
                      <strong>Attention: archive non chiffree</strong>
                      <span>La sauvegarde ZIP locale contient les donnees ERP. Utilisez la sauvegarde chiffree pour tout transfert ou stockage externe.</span>
                    </div>
                    <div className="settings-backup-actions">
                      <button className="btn btn-primary" onClick={createBackup} disabled={backupBusy}>
                        {backupBusy ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <DatabaseBackup size={16} />}
                        Creer une sauvegarde
                      </button>
                      <label className="btn btn-secondary settings-upload-btn">
                        <Upload size={16} />
                        Restaurer
                        <input type="file" accept=".zip,application/zip" onChange={restoreBackup} disabled={backupBusy} />
                      </label>
                      <button className="btn btn-secondary" onClick={loadBackups} disabled={loadingBackups || backupBusy}>
                        <RotateCcw size={16} />
                        Actualiser
                      </button>
                    </div>
                    <div className="settings-encrypted-backup">
                      <div>
                        <strong>Sauvegarde chiffree PFE</strong>
                        <span>Archive .erpenc protegee par passphrase, adaptee au plan Disaster Recovery.</span>
                      </div>
                      <input
                        type="password"
                        value={backupPassphrase}
                        onChange={e => setBackupPassphrase(e.target.value)}
                        placeholder="Passphrase 8+ caracteres"
                        disabled={backupBusy}
                      />
                      <button className="btn btn-secondary" onClick={createEncryptedBackup} disabled={backupBusy || backupPassphrase.length < 8}>
                        <DatabaseBackup size={16} />
                        Creer chiffree
                      </button>
                    </div>
                    <div className="settings-note">
                      Une sauvegarde automatique est creee au demarrage du serveur s'il n'existe pas encore de sauvegarde pour la journee.
                    </div>
                    <ReadOnly label="Base de donnees" value={backups.database_path} />
                    <ReadOnly label="Dossier sauvegardes" value={backups.backup_dir} />
                  </SettingsCard>

                  <SettingsCard icon={FileText} title="Historique des sauvegardes" hint={`Conservation automatique des ${backups.max_backups || 30} dernieres sauvegardes.`}>
                    {loadingBackups ? (
                      <div className="settings-loading-inline"><span className="spinner" /></div>
                    ) : backups.items?.length ? (
                      <div className="settings-backup-list">
                        {backups.items.map(item => (
                          <div className="settings-backup-row" key={item.name}>
                            <div>
                              <strong>{item.name} {item.encrypted ? <span className="settings-backup-secure">chiffree</span> : null}</strong>
                              <span>{new Date(item.created_at).toLocaleString('fr-MA')} - {(item.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                            <div className="settings-backup-row-actions">
                              {item.encrypted && (
                                <button className="btn btn-secondary btn-sm btn-icon" onClick={() => restoreEncryptedBackup(item.name)} title="Restaurer chiffree" disabled={backupBusy}>
                                  <Upload size={15} />
                                </button>
                              )}
                              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => downloadBackup(item.name)} title="Telecharger">
                                <Download size={15} />
                              </button>
                              <button className="btn btn-danger btn-sm btn-icon" onClick={() => deleteBackup(item.name)} title="Supprimer" disabled={backupBusy}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-note">Aucune sauvegarde pour le moment.</div>
                    )}
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'audit' && (
                <div className="settings-grid">
                  <SettingsCard icon={History} title="Journal d'audit" hint="Trace des actions importantes: ventes, achats, stock, produits, sauvegardes et parametres.">
                    <button className="btn btn-secondary" onClick={loadAuditLogs} disabled={loadingAudit}>
                      <RotateCcw size={16} />
                      Actualiser
                    </button>
                    {loadingAudit ? (
                      <div className="settings-loading-inline"><span className="spinner" /></div>
                    ) : auditLogs.length ? (
                      <div className="settings-audit-list">
                        {auditLogs.map(log => (
                          <div className="settings-audit-row" key={log.id}>
                            <span className={`settings-audit-action action-${log.action}`}>{log.action}</span>
                            <div>
                              <strong>{log.summary || `${log.entity} #${log.entity_id}`}</strong>
                              <small>{log.entity} {log.entity_id ? `#${log.entity_id}` : ''} - {log.created_by_name || 'Systeme'} - {new Date(log.created_at).toLocaleString('fr-MA')}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-note">Aucune action enregistree pour le moment.</div>
                    )}
                  </SettingsCard>
                </div>
              )}

              {activeTab === 'system' && (
                <div className="settings-grid">
                  <SettingsCard icon={MonitorCog} title="Sante systeme" hint="Controle rapide de la base locale, des volumes et des sauvegardes.">
                    <button className="btn btn-secondary" onClick={loadSystemHealth} disabled={loadingSystem}>
                      <RotateCcw size={16} />
                      Actualiser
                    </button>
                    {loadingSystem ? (
                      <div className="settings-loading-inline"><span className="spinner" /></div>
                    ) : systemHealth ? (
                      <>
                        <div className="system-health-grid">
                          <div><span>Statut</span><strong className="text-success">{systemHealth.status}</strong></div>
                          <div><span>Taille DB</span><strong>{systemHealth.database_size_mb} MB</strong></div>
                          <div><span>Sauvegardes</span><strong>{systemHealth.backup_count}</strong></div>
                        </div>
                        <ReadOnly label="Base de donnees" value={systemHealth.database_path} />
                      </>
                    ) : (
                      <div className="settings-note">Aucune information systeme chargee.</div>
                    )}
                  </SettingsCard>

                  <SettingsCard icon={DatabaseBackup} title="Volumes de donnees" hint="Nombre d'enregistrements par table importante.">
                    {systemHealth?.tables ? (
                      <div className="system-table-list">
                        {Object.entries(systemHealth.tables).map(([name, count]) => (
                          <div key={name}>
                            <span>{name}</span>
                            <strong>{count ?? '-'}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-note">Actualisez pour charger les volumes.</div>
                    )}
                  </SettingsCard>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function ColorField({ value, onChange }) {
  const safeValue = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || '') ? value : '#2563EB'
  return (
    <div className="settings-color-field">
      <input type="color" value={safeValue} onChange={e => onChange(e.target.value.toUpperCase())} aria-label="Color picker" />
      <input value={value || ''} onChange={e => onChange(e.target.value.toUpperCase())} placeholder="#2563EB" />
    </div>
  )
}

function EditableList({ values, placeholder, onAdd, onRemove }) {
  const [value, setValue] = useState('')
  const submit = () => {
    onAdd(value)
    setValue('')
  }
  return (
    <div className="settings-editable-list">
      <div className="settings-list-add">
        <input value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }} />
        <button className="btn btn-primary btn-sm" onClick={submit}><Plus size={14} /> Ajouter</button>
      </div>
      <div className="settings-chip-list">
        {values.map(item => (
          <span key={item} className="settings-chip">
            {item}
            <button onClick={() => onRemove(item)} title="Supprimer"><Trash2 size={13} /></button>
          </span>
        ))}
      </div>
    </div>
  )
}

function IdentityPreview({ settings }) {
  const identity = getVisualIdentity(settings)
  const logoUrl = getLogoUrl(settings)
  return (
    <div className="identity-preview" style={{
      '--preview-primary': identity.primary,
      '--preview-secondary': identity.secondary,
      '--preview-success': identity.success,
      '--preview-document': identity.document,
      '--preview-logo-size': `${identity.logoSize}px`,
    }}>
      <div className="identity-preview-app">
        <div className="identity-preview-brand">
          <img src={logoUrl} alt="" />
          <div>
            <strong>{getCompanyName(settings)}</strong>
            <span>Interface ProERP</span>
          </div>
        </div>
        <div className="identity-preview-actions">
          <button type="button">Action principale</button>
          <span>Valide</span>
        </div>
      </div>
      <div className="identity-preview-document">
        <header>
          <div>
            <img src={logoUrl} alt="" />
            <strong>{getCompanyName(settings)}</strong>
          </div>
          <aside>
            <h4>FACTURE</h4>
            <span>FAC-2026-00001</span>
          </aside>
        </header>
        <div className="identity-preview-lines">
          <span />
          <span />
          <span />
        </div>
        <footer>Total TTC</footer>
      </div>
    </div>
  )
}

function SettingsCard({ icon: Icon, title, hint, children }) {
  return (
    <div className="settings-card">
      <div className="settings-card-head">
        <span><Icon size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </div>
      <div className="settings-card-body">{children}</div>
    </div>
  )
}

function HelpTip({ text }) {
  if (!text) return null
  return (
    <span className="settings-help" tabIndex={0} aria-label={text}>
      <HelpCircle size={14} />
      <span role="tooltip">{text}</span>
    </span>
  )
}

function Field({ label, hint, help, children }) {
  return (
    <div className="form-group">
      <label className="form-label">
        <span>{label}</span>
        <HelpTip text={help} />
      </label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

function ReadOnly({ label, help, value }) {
  return <Field label={label} help={help}><input value={value || ''} readOnly /></Field>
}

function Toggle({ label, help, checked, onChange }) {
  return (
    <label className="settings-toggle">
      <span className="settings-toggle-label">
        <span>{label}</span>
        <HelpTip text={help} />
      </span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <i />
    </label>
  )
}
