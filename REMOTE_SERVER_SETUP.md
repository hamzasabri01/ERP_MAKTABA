# تحديث كمبيوتر الاستغلال من GitHub بدون فقدان قاعدة البيانات

هذا هو المسار المعتمد:

- هذا الكمبيوتر: تطوير، اختبار، ثم `git push` إلى GitHub.
- الكمبيوتر الآخر: يستقبل التحديث من GitHub، وله قاعدة بياناته الخاصة.
- لا ننقل قاعدة البيانات بين الجهازين، ولا نفتح ملف SQLite عبر الشبكة.

## أول تثبيت على الكمبيوتر الآخر

افتح PowerShell داخل مجلد التطبيق على الكمبيوتر الآخر، ثم شغل:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

بعد ذلك استعمل سكربت التحديث الآمن دائمًا، ولا تعيد تشغيل `setup.ps1` إلا
لتثبيت جديد تمامًا.

## إرسال تحديث من هذا الكمبيوتر

بعد إنهاء التطوير والاختبارات على هذا الكمبيوتر:

```powershell
git add .
git commit -m "Update application"
git push origin main
```

## استقبال التحديث على الكمبيوتر الآخر

على الكمبيوتر الآخر، من مجلد التطبيق نفسه، انقر مرتين على:

```text
MAJ-GITHUB-SANS-PERTE.cmd
```

أو شغل:

```powershell
powershell -ExecutionPolicy Bypass -File .\update-existing.ps1
```

السكربت يقوم بالآتي:

1. يوقف التطبيق مؤقتًا.
2. يأخذ نسخة SQLite متسقة من `backend\proerp.db`، بما في ذلك بيانات WAL
   الملتزمة.
3. يحفظ `backend\.env`, `backend\company_settings.json`, `backend\uploads`,
   `backend\data`, و`backend\backups`.
4. يجلب آخر نسخة من GitHub عبر `git fetch` ثم يحدّث الكود.
5. يرجع قاعدة البيانات والملفات المحلية إلى مكانها.
6. يثبت dependencies، يبني الواجهة، ويطبّق migrations الإضافية فقط.
7. يتحقق أن عدد السجلات والمجاميع التجارية لم تنقص أو تتغير.
8. يثبت تشغيل Windows التلقائي ويفتح التطبيق في Chrome.

إذا وقع خطأ، يرجع السكربت النسخة السابقة والبيانات السابقة تلقائيًا.
نسخ الأمان محفوظة هنا:

```text
%LOCALAPPDATA%\LibrarySabri\upgrade-backups
```

## التشغيل التلقائي بعد تحديث الكمبيوتر الآخر

بعد نجاح التحديث، يتم تثبيت مهمتين في Windows Task Scheduler:

- `LibrarySabri-Server`: تبدأ مع Windows، تشغل الخادم المحلي على المنفذ `8015`
  وتراقبه. إذا توقف الخادم، تعيد تشغيله.
- `LibrarySabri-OpenChrome`: تعمل عند دخول المستخدم، تنتظر نجاح الاتصال ثم
  تفتح التطبيق في Google Chrome.

العنوان المحلي على الكمبيوتر الآخر:

```text
http://127.0.0.1:8015/erp
```

ومن جهاز آخر في نفس الشبكة، استعمل IP الكمبيوتر الآخر:

```text
http://192.168.1.50:8015/erp
```

## إصلاح التشغيل التلقائي يدويًا

إذا كان الكود محدثًا لكن التشغيل مع Windows لا يعمل، افتح PowerShell كمسؤول
على الكمبيوتر الآخر:

```powershell
.\scripts\install-lan-erp-startup.ps1 -Port 8015 -OpenFirewall
```

لإزالة التشغيل التلقائي دون حذف قاعدة البيانات:

```powershell
.\scripts\uninstall-lan-erp-startup.ps1
```

## مشاكل الاتصال بعد تشغيل Windows

إذا ظهرت رسائل مثل:

```text
Ce site est inaccessible
Le tunnel HTTPS du scanner est temporairement indisponible.
```

فالنسخة الحالية تعالجها عند الإقلاع عبر `LibrarySabri-Server`: ينظف نفق
scanner القديم، يشغل الخادم، ينتظر `/health` وصفحة `/erp`، ثم يحاول تهيئة
نفق scanner. إذا توقف الخادم لاحقًا، يعيد watchdog تشغيله تلقائيًا.

لإصلاح سريع يدويًا على الكمبيوتر الآخر:

```powershell
.\scripts\install-lan-erp-startup.ps1 -Port 8015 -OpenFirewall
Start-ScheduledTask -TaskName LibrarySabri-Server
```

## مهم جدًا

- لا تحذف `backend\proerp.db` من الكمبيوتر الآخر.
- لا تنسخ قاعدة هذا الكمبيوتر فوق قاعدة الكمبيوتر الآخر.
- لا تضع قاعدة SQLite داخل مجلد شبكة مشترك.
- يفضّل أن يكون مجلد التطبيق على الكمبيوتر الآخر خارج OneDrive.
