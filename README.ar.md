# بوت Telegram ثنائي الاتجاه لخدمة العملاء

[中文](README.md) · [English](README.en.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

بوت Telegram ثنائي الاتجاه لخدمة العملاء لا يحتاج إلى قاعدة بيانات أو Google Sheets أو KV أو تخزين دائم للرسائل. يتحدث العميل مع البوت في محادثة خاصة، وتصل رسائله إلى وكلاء الدعم أو المجموعات العادية المحددة، ويمكن للوكيل الرد على العميل باستخدام ميزة الرد الأصلية في Telegram.

## مهم: اختر طريقة نشر واحدة فقط

يحتوي المشروع على **تنفيذين مستقلين تمامًا ويوفران الوظائف نفسها**. لست بحاجة إلى نشرهما معًا:

```text
الخيار A: Telegram → Cloudflare Worker → Telegram Bot API / AI API
الخيار B: Telegram → Google Apps Script Web App → Telegram Bot API / AI API
```

- عند استخدام Cloudflare Workers فقط، لا تحتاج إلى حساب Google أو مشروع Apps Script.
- عند استخدام Google Apps Script فقط، لا تحتاج إلى حساب Cloudflare أو Worker.
- لا يتصل أحد التنفيذين بالآخر، ولا يوجد سر مشترك داخلي أو مغلف موقّع أو عنوان تحويل بينهما.
- الملف `config.js` في الجذر هو ملف إعدادات العمل الوحيد المشترك لأي من الخيارين.

## الميزات

- توزيع `round_robin` دون حفظ حالة، أو إرسال `all` إلى جميع الوجهات.
- قوائم بسيطة من المعرّفات الرقمية أو السلاسل الرقمية أو `@username`.
- عرض اسم العميل واسم المستخدم والمعرّف الرقمي ونوع الرسالة ووقتها ومحتواها.
- دعم النصوص والصور والمستندات والرسائل الصوتية والملصقات ورسائل Telegram المدعومة الأخرى.
- تقسيم الرسائل الطويلة مع الاحتفاظ بمسار الرد الموقّع.
- الرد الأصلي في Telegram والأمر الاحتياطي `/reply معرف_العميل النص`.
- تخصيص رسالة `/start` ولوحة Inline Keyboard أسفل نص الرسالة.
- قواعد كلمات مفتاحية مرتبة، مع إظهار الإجابة والرسالة الأصلية لوكلاء الدعم.
- استدعاء واجهة AI المتوافقة مع OpenAI فقط عندما يرسل العميل `/ai السؤال` صراحةً.
- ملفات Markdown عامة عبر HTTPS مع تخزين مؤقت لمدة ساعة ودون حفظ سجل المحادثة.
- قائمة بيضاء اختيارية للردود داخل المجموعة، وتوقيع اسم الوكيل، وحماية المسارات باستخدام HMAC.
- تعليقات صينية واضحة في الكود الأساسي، ووثائق بست لغات، واختبارات لكلتا بيئتي التشغيل.

## الرعاية والتطوير المخصص

- عنوان التبرع عبر TRC20: `THzYfLHVbEaZ4UXwq5AxuZ9aunxq4m4pQg`
- تطوير بوتات مخصصة: Telegram `@easSearchs`

## بنية المشروع

```text
config.js                    الإعدادات والأسرار المحلية، مستبعد بواسطة .gitignore
config.example.js            قالب إعدادات مع تعليقات كاملة
CloudflareWorkers/           تنفيذ Worker كامل يعمل بشكل مستقل
GoogleScripts/               تنفيذ Apps Script كامل يعمل بشكل مستقل
scripts/sync-config.mjs      يتحقق من الإعدادات وينشئ إعدادات التشغيل
scripts/set-webhook.mjs      يضبط Telegram Webhook لأي من المنصتين
```

## 1. التحضير المشترك

### إنشاء البوت

افتح `@BotFather` في Telegram وأرسل `/newbot` ثم احفظ Bot Token. أضف البوت إلى كل مجموعة دعم. يجب على كل وكيل يستخدم محادثة خاصة فتح البوت وإرسال `/start` أولًا، وإلا لن يسمح Telegram للبوت بمراسلته.

لا يمنع وضع الخصوصية Privacy Mode تلقي الردود على رسائل البوت نفسها. غيّر هذا الوضع عبر BotFather فقط إذا احتجت إلى أوامر إضافية داخل المجموعة.

### التثبيت ونسخ الإعدادات

ثبّت Node.js 20 أو أحدث:

```sh
cp config.example.js config.js
```

في Windows PowerShell:

```powershell
Copy-Item config.example.js config.js
```

### الحصول على المعرّفات الرقمية

اطلب من المستخدم إرسال `/id` إلى البوت، أو أضف البوت مؤقتًا إلى المجموعة المطلوبة وأرسل `/id` هناك. سيعرض البوت معرّف المستخدم ومعرّف المحادثة. تدعم المجموعات العادية والمجموعات الفائقة، ولا تُستخدم آلية المواضيع.

### إنشاء سرّين مستقلين

نفّذ الأمر التالي مرتين:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- ضع القيمة الأولى في `telegram.webhookSecret` للتحقق من Webhook.
- ضع القيمة الثانية في `replies.routeSecret` لتوقيع مسارات ردود الوكلاء.

لا يوجد سر مشترك ثالث بين Worker وApps Script.

## 2. المرجع الكامل لملف config.js

عدّل `config.js` في الجذر. توجد التعليقات الصينية التفصيلية لكل سطر في [config.example.js](config.example.js).

### Telegram وWorker

| الحقل | الوصف |
| --- | --- |
| `telegram.botToken` | الرمز الذي يوفره BotFather. |
| `telegram.webhookSecret` | من 16 إلى 256 حرفًا أو رقمًا أو شرطة سفلية أو شرطة. يفحص Worker ترويسة الطلب، ويفحص Apps Script القيمة `/exec?secret=...`. |
| `telegram.apiBaseUrl` | جذر واجهة Telegram API، وعادةً `https://api.telegram.org`. |
| `worker.requestTimeoutMs` | مهلة Worker لطلبات Telegram وAI والمعرفة بالمللي ثانية؛ يستخدمه Worker فقط. |
| `worker.maxUpdateBytes` | الحد الأقصى لحجم Update بالبايت بترميز UTF-8؛ يستخدمه Worker فقط. |

### التوزيع

| الحقل | الوصف |
| --- | --- |
| `dispatch.mode` | القيمة `round_robin` أو `all`. يستخدم التوزيع الدوري `update_id % عدد الوجهات` ولا يحفظ مؤشرًا. |
| `dispatch.users` | وكلاء الدعم، مثل `[111111111, "@kefu001"]`. |
| `dispatch.groups` | المجموعات العادية، مثل `[-1001234567890, "@my_support_group"]`. |

```js
dispatch: {
  mode: "round_robin",
  users: [111111111, "@kefu001"],
  groups: [-1001234567890, "@my_support_group"]
}
```

تتحول السلاسل الرقمية إلى أرقام، ولا يتأثر اسم المستخدم بحالة الأحرف. يُفضّل استخدام المعرّفات الرقمية للتشغيل طويل الأمد لأن أسماء المستخدمين العامة قد تتغير.

### الترحيب وInline Keyboard

| الحقل | الوصف |
| --- | --- |
| `welcome.text` | نص الترحيب للأمر `/start`. |
| `welcome.buttons` | مصفوفة ثنائية الأبعاد من الصفوف والأزرار. |
| الزر `text` | النص الظاهر على الزر. |
| الزر `callbackData` | بيانات callback بطول 1–64 بايت؛ اخترها أو `url`. |
| الزر `response` | رسالة اختيارية تُرسل إلى العميل بعد الضغط على زر callback. |
| الزر `url` | رابط HTTPS؛ اختره أو `callbackData`. |

```js
welcome: {
  text: "اختر خدمة أو أرسل سؤالك.",
  buttons: [
    [{ text: "مساعدة", callbackData: "help", response: "أرسل سؤالك هنا." }],
    [{ text: "الموقع", url: "https://example.com" }]
  ]
}
```

ينشئ هذا `reply_markup.inline_keyboard`، وليس Reply Keyboard بجانب حقل الإدخال.

### الردود التلقائية بالكلمات المفتاحية

| الحقل | الوصف |
| --- | --- |
| `autoReply.enabled` | تفعيل القواعد الثابتة. |
| `autoReply.rules` | قواعد مرتبة، وتُستخدم أول قاعدة مطابقة. |
| القاعدة `keywords` | مصفوفة غير فارغة؛ يكفي تطابق أي كلمة فيها. |
| القاعدة `reply` | الإجابة المرسلة إلى العميل مع نسخة لوكلاء الدعم. |

مطابقة الإنجليزية لا تفرّق بين الأحرف الكبيرة والصغيرة وتستخدم السلاسل الجزئية. الرسالة العادية غير المطابقة تذهب إلى الوكلاء فقط ولا تستدعي AI تلقائيًا.

### AI وملفات Markdown عبر الإنترنت

| الحقل | الوصف |
| --- | --- |
| `ai.enabled` | تفعيل طلبات `/ai` الصريحة. |
| `ai.apiBaseUrl` | جذر واجهة متوافقة مع OpenAI، مثل `https://api.openai.com/v1`. |
| `ai.apiKey` | مفتاح مزود AI. |
| `ai.model` | اسم النموذج. |
| `ai.systemPrompt` | التوجيه الخاص بالنظام. |
| `ai.knowledgeUrls` | عناوين HTTPS عامة لملفات Markdown. |
| `ai.maxKnowledgeChars` | الحد الأقصى لمجموع أحرف المعرفة في الطلب الواحد. |
| `ai.maxOutputTokens` | الحد الأقصى لرموز الإخراج، من 1 إلى 4096. |
| `ai.temperature` | درجة العينة، من 0 إلى 2. |

يُقرأ 10 ملفات كحد أقصى و50000 حرف لكل ملف، مع منع إعادة التوجيه. يستخدم Apps Script خدمة `CacheService` لمدة ساعة. يحتفظ Worker بالمحتوى في ذاكرة المثيل الحالي لمدة ساعة، ثم يعيد تنزيله بعد إعادة تدوير المثيل. عند فشل المعرفة أو AI يتلقى العميل تنبيهًا، ويستمر إرسال السؤال الأصلي إلى الوكلاء.

### الردود والعرض

| الحقل | الوصف |
| --- | --- |
| `replies.groupPolicy` | `all_members` أو `whitelist`. |
| `replies.allowedUserIds` | المعرّفات الرقمية للوكلاء المسموح لهم بالرد في وضع القائمة البيضاء. |
| `replies.showOperatorName` | عرض اسم الوكيل للعميل. عند `false` يخفي `copyMessage` مصدر الرد. |
| `replies.linkToOriginal` | ربط الرد برسالة العميل الأصلية، وإعادة المحاولة دون ربط إذا حُذفت. |
| `replies.routeSecret` | سر HMAC للمسار، بطول 16 حرفًا على الأقل. |
| `presentation.timeZone` | منطقة زمنية وفق IANA، مثل `Asia/Shanghai`. |
| `presentation.showLanguage` | عرض لغة Telegram الخاصة بالعميل. |
| `presentation.showTimestamp` | عرض وقت رسالة العميل. |

### نصوص الرسائل

| الحقل | الاستخدام |
| --- | --- |
| `messages.customerHelp` | أمر `/help` للعميل والأوامر غير المعروفة. |
| `messages.aiHelp` | استخدام `/ai` دون سؤال. |
| `messages.aiUnavailable` | عدم توفر AI أو المعرفة. |
| `messages.invalidButton` | callback غير صالح أو منتهي. |
| `messages.adminHelp` | مساعدة الوكيل. |
| `messages.unsupported` | نوع رسالة غير مدعوم. |
| `messages.deliveryFailed` | فشل التسليم إلى جميع الوجهات. |
| `messages.routeNotFound` | مسار غير صالح أو رسالة من بوت مختلف. |
| `messages.unauthorized` | عدم وجود إذن لرد الوكيل. |
| `messages.replyFailed` | فشل الرد على العميل. |
| `messages.replySent` | نجاح قناة `/reply` الاحتياطية. |
| `messages.invalidReplyCommand` | صيغة `/reply` غير صالحة. |

## 3. الخيار A: Cloudflare Workers فقط

لا تحتاج إلى مشروع Apps Script.

### التثبيت والمصادقة والنشر

```sh
npm install --prefix CloudflareWorkers
npm exec --prefix CloudflareWorkers -- wrangler login
npm run sync:config
npm run deploy:worker
```

يمكن تغيير اسم Worker في `CloudflareWorkers/wrangler.jsonc`. يكفي نطاق workers.dev الفرعي المجاني. انسخ العنوان الناتج `https://NAME.SUBDOMAIN.workers.dev`.

### ضبط Webhook

```sh
npm run webhook:set -- https://NAME.SUBDOMAIN.workers.dev
```

يضيف البرنامج `/webhook` ويضبط `telegram.webhookSecret` بوصفه Telegram Secret Token. عنوان فحص الصحة:

```text
https://NAME.SUBDOMAIN.workers.dev/health
```

يمكن اختياريًا استخدام `wrangler secret put` مع `TELEGRAM_BOT_TOKEN` و`TELEGRAM_WEBHOOK_SECRET` و`REPLIES_ROUTE_SECRET` و`AI_API_KEY`. تتجاوز هذه القيم الأسرار المنشأة، لكنها غير مطلوبة للتشغيل المستقل.

## 4. الخيار B: Google Apps Script فقط

لا تحتاج إلى حساب Cloudflare أو Wrangler أو Worker.

### تثبيت clasp والمصادقة

```sh
npm install --prefix GoogleScripts
npm exec --prefix GoogleScripts -- clasp login
```

### إنشاء المشروع ورفعه

أنشئ مشروعًا فارغًا في `https://script.google.com/`. انسخ Script ID من إعدادات المشروع أو عنوان المتصفح، ثم أنشئ `GoogleScripts/.clasp.json`:

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "."
}
```

ارفع التنفيذ المستقل:

```sh
npm run sync:config
npm run push:gas
```

لا تعدّل `GoogleScripts/config.generated.js` يدويًا.

### نشر Web App

في محرر Apps Script اختر **نشر → نشر جديد → تطبيق ويب**:

- التنفيذ بصفتي: **أنا**.
- من لديه حق الوصول: **أي شخص**.
- انسخ عنوان النشر المنتهي بـ `/exec`، وليس عنوان الاختبار `/dev`.

### ضبط Webhook

```sh
npm run webhook:set -- https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

لا يستطيع Apps Script قراءة ترويسة Telegram Secret Token، لذلك يضيف البرنامج `?secret=...` إلى `/exec`. يتحقق `doPost` منها باستخدام `telegram.webhookSecret` نفسه. لا تنشر عنوان Webhook الكامل.

## 5. الاستخدام واختبارات القبول

1. أرسل `/start` بوصفك عميلًا وتحقق من نص الترحيب وInline Keyboard.
2. أرسل نصًا وصورة وملصقًا، وتحقق من وصول هوية العميل والمحتوى إلى الوجهات المحددة.
3. رد على بطاقة معلومات البوت أو نص يحمل مسارًا أو caption لوسائط، وتحقق من وصول الرد إلى العميل.
4. اختبر `/reply معرف_العميل النص` في محادثة الوكيل.
5. أرسل `/id` وقارن المعرّفات الرقمية مع `config.js`.
6. اختبر كلمة مفتاحية معدّة؛ يجب أن يرى العميل والوكلاء الإجابة.
7. أرسل `/ai كيف أثبت؟` وتحقق من الإجابة والنسخة المرسلة للوكيل. يجب ألا تستدعي الرسائل العادية AI.
8. عند استخدام القائمة البيضاء، اختبر عضوًا مسموحًا وآخر غير مسموح.

```text
/start                 رسالة ترحيب العميل
/help                  مساعدة العميل أو الوكيل
/ai السؤال             طلب AI صريح
/id                    عرض معرّف المستخدم والمحادثة
/reply معرف_العميل النص رد الوكيل الاحتياطي
```

## 6. التحديث والاختبارات واستكشاف الأخطاء

بعد تغيير الإعدادات:

```sh
npm run sync:config
npm run test:worker
npm run test:gas
npm run build:worker
```

حدّث المنصة المختارة فقط:

- Worker: نفّذ `npm run deploy:worker`.
- Apps Script: نفّذ `npm run push:gas`، ثم عدّل Web App ضمن **إدارة عمليات النشر**، وأنشئ إصدارًا جديدًا وانشره. يبقى عنوان `/exec` كما هو عادةً، لذلك لا يلزم إعادة ضبط Webhook.

استكشاف الأخطاء:

- **Webhook 401/unauthorized**: أعد تنفيذ `webhook:set` وتحقق من `webhookSecret` المنشور.
- **البوت لا يرسل الرسائل**: تحقق من Bot Token والسجلات ومعلومات Telegram Webhook. يجب أن يرسل الوكيل الخاص `/start` أولًا.
- **لا تصل الرسائل إلى المجموعة**: تحقق من عضوية البوت ومعرّف المجموعة السالب واسم `@username` العام.
- **رد الوكيل غير صالح**: رد على رسالة بوت تحتوي `R.customerId.messageId.signature`؛ لا يمكن استخدام رسائل البوتات الأخرى.
- **فشل AI**: تحقق من عنوان API والمفتاح والنموذج وعناوين المعرفة HTTPS وإمكانية الوصول العام. يستمر التوزيع إلى الوكلاء.
- **لا تظهر تغييرات Apps Script**: تحقق من Script ID وانشر إصدارًا جديدًا من Web App.

لا تُحفظ رسائل العملاء أو المحادثات أو مؤشرات التوزيع أو روابط الردود بشكل دائم. احمِ `config.js` وملفات الإعدادات المنشأة وعنوان Apps Script Webhook الكامل.
