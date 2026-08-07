# School Research Assistant

وحدة معزولة لإدارة البحوث المدرسية داخل ERP. الخاصية معطلة افتراضياً ولا تغيّر سلوك الوحدات الحالية.

## Activation

أضف إلى `backend/.env`:

```env
RESEARCH_MODULE_ENABLED=true
RESEARCH_AI_PROVIDER=mock
RESEARCH_MAX_PAGES=20
RESEARCH_MAX_IMAGES=10
RESEARCH_STORAGE_PATH=
```

ثم أعد تشغيل backend. المزود `mock` محلي ولا يجري أي طلب مدفوع. لا يوجد مزود خارجي مفعّل في النسخة الأولى.

## Migration

من مجلد `backend` وبعد تفعيل البيئة الافتراضية:

```powershell
python -m migrations.research_module_v1 upgrade
```

التطبيق المحلي يستعمل أيضاً `Base.metadata.create_all()`، لذلك إنشاء الجداول آمن ومتكرر. التراجع يحذف جداول الوحدة فقط:

```powershell
python -m migrations.research_module_v1 downgrade
```

خذ نسخة احتياطية قبل أي rollback لأنه يحذف بيانات البحوث، ولا يلمس جداول ERP الموجودة.

## Permissions

- `research.view`
- `research.create`
- `research.edit`
- `research.generate`
- `research.approve`
- `research.export`
- `research.print`
- `research.manage_settings`
- `research.view_costs`

حساب Administrator الذي يملك `all` له صلاحية كاملة. يمكن تركيب صلاحيات الأدوار الديناميكية من صفحة المستخدمين.

## Workflow

`DRAFT → OUTLINE_PENDING → OUTLINE_READY → OUTLINE_APPROVED → GENERATING → REVIEW_REQUIRED → APPROVED → EXPORTING → EXPORTED → PRINTED → COMPLETED`

لا يمكن توليد الأقسام قبل موافقة موظف على الخطة، ولا يمكن التصدير أو الطباعة قبل الموافقة النهائية. كل تغيير مهم يسجل نسخة أو حدث حالة.

## Files and privacy

الصور تحفظ افتراضياً في `backend/data/research` خارج مجلد frontend و`uploads` العام. تنزيلها يمر عبر API محمي بالصلاحيات. الأنواع المقبولة: JPEG وPNG وWebP، مع فحص signature والحجم ومسار التخزين.

## POS

عند اختيار “Ouvrir dans le POS” تنشئ الوحدة، إن لزم، خدمة ERP عادية:

- Code: `SRV-RESEARCH`
- Type: `service`
- Pricing: `manual`
- Stock: `0`

السعر المقترح يأتي من الطلب، بينما الحساب النهائي والخصم والضريبة والفاتورة تبقى من مسؤولية منطق POS الحالي.

## Current limitations

- المزود الخارجي غير مفعّل؛ `mock` هو المزود الوحيد المتاح والموصى به للاختبار.
- لا يوجد بحث Web تلقائي، ولا يتم اختلاق مراجع.
- PDF يستعمل محرك jsPDF الموجود مسبقاً ويحوّل المحتوى إلى صفحات صور للحفاظ على العربية؛ DOCX يبقى نصاً قابلاً للتحرير ويدعم RTL.
- صور الطلب تُدار وتُعتمد، لكنها ليست مضمنة بعد داخل DOCX.
- وضع الصفحات الصارم محفوظ في الطلب ويستعمل التقدير؛ الضبط التكراري بعد قياس المستند مرحلة لاحقة.
- لا توجد queue خارجية؛ التنفيذ متزامن ومحدود، وهو مناسب للمزود المحلي فقط.

## Verification

```powershell
$env:PYTHONPATH='backend'
.\.venv\Scripts\python.exe -m unittest discover -s backend\tests -p 'test_*.py'
Set-Location frontend
npm run build
```

## Safe rollout

1. اترك `RESEARCH_MODULE_ENABLED=false` في الإنتاج.
2. شغّل migration والاختبارات على نسخة احتياطية.
3. فعّل الوحدة أولاً لحساب Administrator.
4. امنح `research.*` لموظفين محددين.
5. راقب الجودة والتكلفة قبل إعداد مزود خارجي.
